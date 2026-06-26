# Ollama Agent Loop READ_FILE Fix Report

**Problem:** The Ollama provider (qwen2.5-coder:7b) repeatedly calls `READ_FILE package.json` many times in the agent loop and never produces a final summary. The run gets stuck in a read-repeat cycle until `maxSteps` is exhausted.

---

## Root Cause

1. **No duplicate tool call detection** — The agent loop executed every tool call the model produced, even if it was identical (same tool + same args) to a previous call. Ollama models, especially smaller quantized models, are prone to repeating the same action.

2. **No READ_FILE content cache** — Each `READ_FILE` call executed the filesystem read again, even if the same file was just read. The model received the full content each time, but kept requesting it because there was no explicit instruction to stop.

3. **Weak system prompt guidance** — The existing prompt only said "Do not repeat a failed tool call without changing its arguments." It did NOT say "If you already read a file, don't read it again" — so the model felt free to call `READ_FILE` repeatedly on the same path.

4. **`summarizeToolResult` stripped file content** — For non-READ_FILE tools with a `content` field, the function deleted it and replaced with a 1000-char preview. This wasn't directly causing the loop (the model message used the raw `result` via `compactResult`), but it meant continuation runs lost the cached content.

---

## Changes Made

**File:** `backend/src/agent/runAgentLoop.js`

### 1. READ_FILE content cache (line 182–194)

```javascript
const readFileCache = new Map();
```

A `Map<string, string>` keyed by normalized file path (`path/to/file.js`), populated on every successful `READ_FILE` execution. Pre-populated from `initialToolCalls` during continuation runs.

### 2. Duplicate tool call counter (line 183–184)

```javascript
const toolCallCounts = new Map();
const MAX_DUPLICATE_TOOL_CALLS = 2;
```

Tracks `(toolName + JSON.stringify(args))` → count. On the 3rd identical call (count >= 2), the call is blocked.

### 3. System prompt strengthened (lines 239–240)

```diff
 - Do not repeat a failed tool call without changing its arguments.
+- After READ_FILE succeeds, you have the file content. Do not call READ_FILE on the same path again.
+- If you already read a file, use that content in your final answer. Do not repeat identical tool calls.
```

Gives explicit instruction to Ollama (and all providers) not to re-read files.

### 4. Duplicate detection before tool execution (lines 449–468)

```javascript
// Count (tool, args) pair
const callKey = `${toolName}:${JSON.stringify(args)}`;
const duplicateCount = toolCallCounts.get(callKey) || 0;
toolCallCounts.set(callKey, duplicateCount + 1);

// General guard: block on 3rd+ identical call
if (duplicateCount >= MAX_DUPLICATE_TOOL_CALLS) {
  const message = `Duplicate tool call prevented. You already called ${toolName} with these arguments ${duplicateCount + 1} times. Use the existing result.`;
  recordEvent("validation", { step, tool: toolName, args, message });
  conversation.push({ role: "system", content: message });
  continue;
}

// READ_FILE cache: return cached content on 2nd call
const readFilePath = toolName === "READ_FILE" && args.path
  ? String(args.path).replace(/\\/g, "/") : null;
if (readFilePath && readFileCache.has(readFilePath)) {
  const cachedContent = readFileCache.get(readFilePath);
  const message = `You already read "${readFilePath}". Here is its content again:\n\n${cachedContent.slice(0, 12000)}\n\nUse this content. Do not call READ_FILE on this path again.`;
  conversation.push({ role: "system", content: message });
  continue;
}
```

- **1st call**: duplicateCount=0 → passes guard, cache miss → executes normally
- **2nd call**: duplicateCount=1 → passes guard (1 < 2), cache hit → returns cached content with warning, skips execution
- **3rd call**: duplicateCount=2 → BLOCKED by general guard → "validation" event emitted → system message to stop

### 5. READ_FILE content cached after execution (lines 499–505)

```javascript
if (toolName === "READ_FILE" && result?.success && result.file) {
  inspectedFiles.add(result.file);
  if (result.content) {
    const normalized = String(result.file).replace(/\\/g, "/");
    readFileCache.set(normalized, result.content);
  }
}
```

Normalizes the path and stores content for cache lookups.

### 6. `summarizeToolResult` preserves content for READ_FILE (line 118)

```diff
-function summarizeToolResult(result) {
+function summarizeToolResult(result, toolName) {
   const summary = { ...result };
-  if (typeof summary.content === "string") {
+  if (typeof summary.content === "string" && toolName !== "READ_FILE") {
```

Keeps the full file content in stored tool call results so continuation runs can re-populate the cache.

---

## Flow for "Read package.json and summarize scripts" (test case)

| Step | Before Fix | After Fix |
|------|-----------|-----------|
| 1 | Model calls READ_FILE package.json → executes → content returned | Same |
| 2 | Model calls READ_FILE package.json again → executes → content returned again | Model calls READ_FILE package.json → cache hit → cached content returned + "Do not read again" warning |
| 3 | Model calls READ_FILE package.json again → executes again → infinite loop | Model calls READ_FILE package.json → **BLOCKED** by duplicate guard → "validation" event → stop message |
| 4 | ... repeats until maxSteps | Model reads stop message → produces final summary → `done: true` |
| End | `needs_revision` (no file changes, no final) | `completed` with summary |

---

## Files Changed

| File | Change |
|------|--------|
| `backend/src/agent/runAgentLoop.js` | Duplicate detection, READ_FILE cache, system prompt, `summarizeToolResult` preservation |

## Provider Compatibility

- **OpenAI/Gemini**: Unaffected — the duplicate detection runs for ALL providers but only triggers when the same (tool, args) pair appears 3+ times. Well-behaved models never hit this.
- **Ollama**: Benefits most — the duplicate guard + cache + prompt changes break the read-repeat cycle.
- **Anthropic/OpenRouter**: Unaffected — same reasoning as OpenAI/Gemini.

## Testing

1. Run prompt "Read package.json and summarize scripts. Do not modify files." with Ollama agent
2. Verify `READ_FILE package.json` executes exactly once (or twice at most, with 2nd returning cached content)
3. Verify model produces final summary with `done: true`
4. Verify run status is `completed`
5. Verify no files were changed
6. Run same prompt with OpenAI/Gemini agent — verify behavior is unchanged
