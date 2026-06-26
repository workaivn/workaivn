# Ollama Invalid JSON Repair Report

## Problem
Ollama (qwen2.5-coder:7b) sometimes returns malformed JSON with:
- Unquoted string values: `"key": unquoted value`
- Text before/after JSON: `Some reasoning... {"tool": "READ", ...} extra text`
- Trailing commas: `"done": false,}` or `"args": {"path": "x",}`
- Multiple JSON objects in the same response
- Pure plain text (no JSON at all)

This caused `JSON.parse` to fail, triggering a retry or returning an error.

## Changes Made

### File: `backend/src/agent/runAgentLoop.js`

#### 1. `extractLastJsonObject(text)` — New function
Scans backwards from end of text to find the **last** balanced `{...}` object. Catches cases where the model appends text AFTER valid JSON.

#### 2. `tryParseWithRepair(raw)` — New function
Attempts to salvage malformed JSON in order:
1. Strip text before first `{` / after last `}`
2. Remove markdown code fences
3. Remove trailing commas before `}` or `]`
4. Quote unquoted string values after colons (preserving `true`/`false`/`null`/numbers)
5. Log `[AgentJSON] repaired invalid JSON successfully` on success

#### 3. `parseAgentResponse(response)` — Updated
- Falls back to `tryParseWithRepair` when all strict parse attempts fail
- Falls back to `extractLastJsonObject` for multiple-object responses
- Logs `[AgentJSON] repaired invalid JSON successfully`

#### 4. Retry handler — Updated
After a retry also produces non-JSON, instead of returning an error:
- If response is plain text (no `{`), wraps as `{ done: true, final: response }` with `success: true`
- Logs `[AgentJSON] wrapping plain text as final response after retry`

### File: `backend/src/agent/runAgentLoop.test.js`
- Updated test "runAgentLoop returns an error instead of throwing after invalid JSON retry" → renamed to "runAgentLoop retries and salvages plain text as final response"
- Asserts `success: true` and `final: "still not json"` instead of error

## How It Works
1. Strict `JSON.parse` always tried first — no change for valid JSON
2. `extractFirstJsonObject` (pre-existing) handles text around JSON — no change
3. `tryParseWithRepair` catches broken JSON (unquoted strings, trailing commas) — **new fallback**
4. `extractLastJsonObject` catches multiple-object responses — **new fallback**
5. Retry handler salvages pure plain text gracefully — **new fallback**

## Testing
- `runAgentLoop` test suite: 6/6 pass
- `qualityGate` test suite: 3/3 pass
- Syntax check: clean
