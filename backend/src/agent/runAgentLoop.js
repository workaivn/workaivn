import { askAI } from "../services/aiRouter.js";
import { executeTool } from "./toolExecutor.js";
import {
  getDiffSummary,
  getGitSnapshot,
  getWorkspaceRoot
} from "./workspace.js";
import {
  acceptanceCriteriaToPrompt,
  buildAcceptanceCriteria
} from "./acceptanceCriteria.js";
import { evaluateQualityGate } from "./qualityGate.js";

const DEBUG = () => process.env.DEBUG_AGENT === "true";

const WRITE_TOOLS = new Set(["WRITE_FILE", "APPLY_PATCH"]);

function parseAgentResponse(response) {
  const raw = String(response ?? "").trim();
  const candidates = [raw];
  const fencedBlocks = raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi);

  for (const match of fencedBlocks) {
    if (match[1]?.trim()) candidates.unshift(match[1].trim());
  }

  let lastError = null;
  for (const candidate of candidates) {
    try {
      const direct = JSON.parse(candidate);
      if (direct && typeof direct === "object" && !Array.isArray(direct)) {
        return direct;
      }
    } catch (error) {
      lastError = error;
    }

    const objectText = extractFirstJsonObject(candidate);
    if (!objectText) continue;

    try {
      return JSON.parse(objectText);
    } catch (error) {
      lastError = error;
    }
  }

  // Attempt repair on the raw text (handles unquoted strings, trailing commas, etc.)
  const repaired = tryParseWithRepair(raw);
  if (repaired) {
    console.log("[AgentJSON] repaired invalid JSON successfully");
    return repaired;
  }

  // Try extracting the last JSON object as fallback
  const repairedLast = extractLastJsonObject(raw);
  if (repairedLast) {
    try {
      return JSON.parse(repairedLast);
    } catch {
      // fall through
    }
  }

  throw new Error(
    lastError
      ? `AI returned invalid JSON object: ${lastError.message}`
      : "AI returned no JSON object"
  );
}

function extractFirstJsonObject(text) {
  const source = String(text ?? "");
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (start === -1) {
      if (char === "{") {
        start = index;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  return null;
}

function extractLastJsonObject(text) {
  const source = String(text ?? "");
  let end = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = source.length - 1; index >= 0; index -= 1) {
    const char = source[index];

    if (end === -1) {
      if (char === "}") {
        end = index;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "}") {
      depth += 1;
    } else if (char === "{") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(index, end + 1);
      }
    }
  }

  return null;
}

function tryParseWithRepair(raw) {
  let text = String(raw ?? "").trim();
  if (!text) return null;

  // Attempt 1: Direct parse on cleaned text (strip non-JSON prefix/suffix)
  let start = text.indexOf("{");
  let end = text.lastIndexOf("}");
  let candidate = (start !== -1 && end !== -1 && end >= start) ? text.slice(start, end + 1) : text;

  // Attempt 2: Try parsing as-is after removing markdown fences
  const noFences = candidate.replace(/^```(?:json)?\s*/gi, "").replace(/\s*```$/g, "");
  const parseAttempts = [noFences, candidate];

  for (const attempt of parseAttempts) {
    try {
      return JSON.parse(attempt);
    } catch {
      // Continue to repair
    }

    // Fix trailing commas before } or ]
    const noTrailingCommas = attempt.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
    try {
      return JSON.parse(noTrailingCommas);
    } catch {
      // Continue
    }

    // Quote unquoted string values after colons
    // Pattern: "key": unquoted_text_here
    const quoted = noTrailingCommas.replace(
      /:\s*([^"{}\[\]\d][^,}\]]*?)(\s*[,}\]])/g,
      (m, val, suffix) => {
        const trimmed = val.trim();
        if (trimmed === "true" || trimmed === "false" || trimmed === "null" || /^-?\d+(\.\d+)?$/.test(trimmed)) {
          return m;
        }
        return `: "${trimmed}"${suffix}`;
      }
    );
    try {
      const result = JSON.parse(quoted);
      console.log("[AgentJSON] repaired invalid JSON successfully");
      return result;
    } catch {
      // Continue to next attempt
    }
  }

  return null;
}

function createEvent(type, details = {}) {
  return {
    type,
    ...details,
    time: new Date()
  };
}

function compactResult(result) {
  const serialized = JSON.stringify(result);
  return serialized.length > 12000
    ? `${serialized.slice(0, 12000)}...`
    : serialized;
}

function summarizeToolResult(result, toolName) {
  if (!result || typeof result !== "object") return result;

  const summary = { ...result };
  if (typeof summary.content === "string" && toolName !== "READ_FILE") {
    summary.contentPreview = summary.content.slice(0, 1000);
    summary.contentLength = summary.content.length;
    delete summary.content;
  }
  if (typeof summary.updated === "string") {
    summary.updatedLength = summary.updated.length;
    delete summary.updated;
  }
  if (Array.isArray(summary.results) && summary.results.length > 20) {
    summary.results = summary.results.slice(0, 20);
    summary.truncated = true;
  }
  if (Array.isArray(summary.files) && summary.files.length > 200) {
    summary.files = summary.files.slice(0, 200);
    summary.truncated = true;
  }

  return summary;
}

function isReadOnlyTask(objective) {
  const lower = objective.toLowerCase();
  const readKeywords = [
    "read", "summarize", "list", "show", "what", "describe",
    "tell", "explain", "do not modify", "without modifying",
    "do not change", "do not edit", "do not write", "do not create",
    "just tell", "just show", "only read", "output the",
    "catalog", "enumerate"
  ];
  return readKeywords.some(kw => lower.includes(kw));
}

function buildReadOnlySummary(toolCalls, readFileCache) {
  const parts = [];
  for (const [filePath, content] of readFileCache) {
    const excerpt = content.length > 2000 ? content.slice(0, 2000) + "\n..." : content;
    parts.push(`--- ${filePath} ---\n${excerpt}`);
  }
  return parts.length
    ? `Read files:\n\n${parts.join("\n\n")}`
    : "Read files summary not available.";
}

async function defaultGenerateResponse({ messages, plan }) {
  return askAI({ messages, mode: "agent", plan });
}

export async function runAgentLoop({
  messages = [],
  plan = "free",
  activeFiles = [],
  workspaceId = "",
  workspaceRoot = "",
  maxSteps = 20,
  acceptanceCriteria = null,
  initialChangedFiles = [],
  initialToolCalls = [],
  initialEvents = [],
  onEvent = () => {},
  generateResponse = defaultGenerateResponse,
  abortSignal = null
}) {
  const resolvedWorkspaceRoot = workspaceRoot
    ? getWorkspaceRoot(workspaceRoot)
    : "";
  const toolContext = {
    activeFiles,
    workspaceId,
    workspaceRoot: resolvedWorkspaceRoot || undefined
  };
  const objective = messages.at(-1)?.content || "";
  const conversation = [...messages];
  const history = [];
  const events = [...initialEvents];
  const toolCalls = [...initialToolCalls];
  const changedFiles = new Set(initialChangedFiles);
  const inspectedFiles = new Set(
    initialToolCalls
      .filter(call => call.tool === "READ_FILE" && call.success)
      .map(call => call.result?.file || call.args?.path)
      .filter(Boolean)
  );
  const criteria = acceptanceCriteria || buildAcceptanceCriteria(objective);
  const baseline = resolvedWorkspaceRoot
    ? await getGitSnapshot(resolvedWorkspaceRoot)
    : { changedFiles: [] };
  const readFileCache = new Map();
  const toolCallCounts = new Map();
  const MAX_DUPLICATE_TOOL_CALLS = 2;
  for (const call of initialToolCalls) {
    if (call.tool === "READ_FILE" && call.success) {
      const path = call.result?.file || call.args?.path;
      if (path) {
        const normalized = String(path).replace(/\\/g, "/");
        if (call.result?.content) readFileCache.set(normalized, call.result.content);
        inspectedFiles.add(normalized);
      }
    }
  }
  let finalText = "";
  let validationFailed = false;
  let qualityGate = null;

  if (DEBUG()) {
    console.log("[runAgentLoop] start workspaceRoot=%s maxSteps=%d plan=%s criteria=%s",
      resolvedWorkspaceRoot || "(none)", maxSteps, plan, criteria ? "yes" : "no");
    console.log("[runAgentLoop] conversation messages=%d initialToolCalls=%d", messages.length, initialToolCalls.length);
  }

  const systemPrompt = `You are the WorkAI VN Coding Agent.

You must execute the coding task by using tools against the real workspace.
You are responsible for a production-quality implementation, not a mockup or code sample.
Return exactly one JSON object per response, with no markdown.

AVAILABLE TOOLS:
- LIST_FILES { "limit": 500 }
- SEARCH_SYMBOL { "query": "exact symbol or route" }
- SEARCH_CODE { "query": "specific identifier or behavior" }
- READ_FILE { "path": "relative/path.js" }
- WRITE_FILE { "path": "relative/path.js", "content": "complete file content" }
- APPLY_PATCH { "file": "relative/path.js", "find": "unique exact text", "replace": "replacement text" }
- RUN_TERMINAL { "command": "safe verification command" }
- VALIDATE_PATCH { "file": "relative/path.js" }

RESPONSE FORMAT:
{ "tool": "READ_FILE", "args": { "path": "src/file.js" }, "reasoning": "short reason", "done": false }

When the task is complete:
{ "done": true, "final": "concise implementation summary" }

RULES:
- Inspect the repository before editing.
- Inspect package.json and existing architecture before broad feature work.
- Use exact relative paths.
- Make real edits with WRITE_FILE or APPLY_PATCH.
- Prefer APPLY_PATCH for focused edits.
- Do not claim completion without a persisted file change.
- Never leave "to be implemented", placeholder flows, fake payment, or incomplete stubs.
- Implement every requested cart, payment, QR, and Sepay flow end-to-end when requested.
- Run a relevant validation command before declaring done.
- A website/app request requires a meaningful implementation across the existing stack, not only index.html and app.js.
- Do not repeat a failed tool call without changing its arguments.
- After READ_FILE succeeds, you have the file content. Do not call READ_FILE on the same path again.
- If you already read a file, use that content in your final answer. Do not repeat identical tool calls.
- Use RUN_TERMINAL for focused verification after edits when useful.
- Keep changes scoped to the objective.`;

  conversation.unshift({ role: "system", content: systemPrompt });
  conversation.push({
    role: "system",
    content: resolvedWorkspaceRoot
      ? `Workspace root is configured. All tool paths must be relative to it. Objective: ${objective}`
      : "This run uses uploaded in-memory files. Tool paths must match uploaded file paths."
  });
  conversation.push({
    role: "system",
    content: acceptanceCriteriaToPrompt(criteria)
  });

  const isReadOnly = isReadOnlyTask(objective);
  if (isReadOnly) {
    conversation.push({
      role: "system",
      content: `READ-ONLY MODE: This task only requires reading files and producing a summary. Do NOT call WRITE_FILE or APPLY_PATCH. After reading the required file(s), return { "done": true, "final": "your summary here" } with a complete summary.`
    });
  }

  function recordEvent(type, details = {}) {
    const event = createEvent(type, details);
    events.push(event);
    history.push(event);
    onEvent(event);
    return event;
  }

  for (let step = 0; step < maxSteps; step += 1) {
    if (abortSignal?.aborted) {
      recordEvent("cancelled", { step, message: "Run was cancelled by user" });
      return {
        success: false,
        status: "cancelled",
        error: "Run was cancelled",
        final: "Agent execution was cancelled.",
        history,
        events,
        toolCalls,
        changedFiles: [...changedFiles],
        diffSummary: { stat: "", numstat: "" },
        acceptanceCriteria: criteria,
        qualityGate: {
          passed: false,
          failures: ["Cancelled by user"],
          feedback: "Run cancelled by user."
        }
      };
    }
    if (DEBUG()) {
      console.log("[runAgentLoop] step %d/%d conversation=%d toolCalls=%d",
        step + 1, maxSteps, conversation.length, toolCalls.length);
    }

    recordEvent("thinking", { step });

    let parsed;
    let rawResponse;
    try {
      if (DEBUG()) console.log("[runAgentLoop] step %d calling generateResponse ...", step);
      rawResponse = await generateResponse({
        messages: conversation,
        plan,
        step,
        objective
      });
    } catch (error) {
      recordEvent("error", {
        step,
        message: error.message,
        rawResponse: ""
      });
      return {
        success: false,
        status: "error",
        error: error.message,
        final: "Agent stopped because the model returned an invalid execution response.",
        history,
        events,
        toolCalls,
        changedFiles: [...changedFiles],
        diffSummary: { stat: "", numstat: "" },
        acceptanceCriteria: criteria,
        qualityGate: {
          passed: false,
          failures: [error.message],
          feedback: error.message
        }
      };
    }

    try {
      parsed = parseAgentResponse(rawResponse);
    } catch (firstParseError) {
      console.error("Coding Agent invalid JSON response:", rawResponse);
      recordEvent("json_parse_retry", {
        step,
        message: firstParseError.message,
        rawResponse: String(rawResponse ?? "").slice(0, 2000)
      });

      const retryMessages = [
        ...conversation,
        { role: "assistant", content: String(rawResponse ?? "") },
        { role: "system", content: "Return only valid JSON object" }
      ];

      let retryResponse;
      try {
        retryResponse = await generateResponse({
          messages: retryMessages,
          plan,
          step,
          objective,
          retry: true
        });
        parsed = parseAgentResponse(retryResponse);
        rawResponse = retryResponse;
      } catch (retryError) {
        if (retryResponse !== undefined) {
          console.error("Coding Agent invalid JSON retry response:", retryResponse);
        } else {
          console.error("Coding Agent JSON retry failed:", retryError);
        }

        // Attempt to salvage plain text as a final response
        const salvageText = String(retryResponse ?? rawResponse ?? "").trim();
        if (salvageText && !salvageText.includes("{")) {
          console.log("[AgentJSON] wrapping plain text as final response after retry");
          finalText = salvageText;
          recordEvent("completion", {
            step,
            message: "Completed with plain text response after retry.",
            finalText
          });
          return {
            success: true,
            status: "completed",
            final: salvageText,
            history,
            events,
            toolCalls,
            changedFiles: [...changedFiles],
            diffSummary: { stat: "", numstat: "" },
            acceptanceCriteria: criteria,
            qualityGate: {
              passed: true,
              failures: [],
              feedback: ""
            }
          };
        }

        recordEvent("error", {
          step,
          message: retryError.message,
          rawResponse: String(retryResponse ?? rawResponse ?? "").slice(0, 2000)
        });
        return {
          success: false,
          status: "error",
          error: retryError.message,
          final: "Agent stopped because the model returned an invalid execution response after one retry.",
          history,
          events,
          toolCalls,
          changedFiles: [...changedFiles],
          diffSummary: { stat: "", numstat: "" },
          acceptanceCriteria: criteria,
          qualityGate: {
            passed: false,
            failures: [retryError.message],
            feedback: retryError.message
          }
        };
      }
    }

    if (parsed.done) {
      if (changedFiles.size === 0) {
        const isReadOnly = isReadOnlyTask(objective);
        const taskType = (criteria.taskType || "coding").toLowerCase();
        const isNonCoding = taskType === "chat" || taskType === "search" || taskType === "analysis";
        if (!isReadOnly && !isNonCoding) {
          const message = "Completion rejected: no persisted file changes were detected.";
          recordEvent("completion_rejected", { step, message });
          conversation.push({
            role: "assistant",
            content: JSON.stringify(parsed)
          });
          conversation.push({
            role: "system",
            content: `${message} Continue by inspecting and editing the workspace with tools.`
          });
          continue;
        }
        // Read-only or non-coding task: allow completion without file changes
      }

      const proposedFinal = parsed.final || (isReadOnly
        ? "Read-only task completed."
        : "Coding task completed with persisted file changes.");
      qualityGate = await evaluateQualityGate({
        acceptanceCriteria: criteria,
        changedFiles: [...changedFiles],
        toolCalls,
        workspaceRoot: resolvedWorkspaceRoot,
        finalText: proposedFinal
      });

      recordEvent("quality_gate", {
        step,
        passed: qualityGate.passed,
        score: qualityGate.score,
        failures: qualityGate.failures
      });

      if (!qualityGate.passed) {
        conversation.push({ role: "assistant", content: JSON.stringify(parsed) });
        conversation.push({
          role: "system",
          content: `${qualityGate.feedback}\nContinue working. Do not return done until every failed check is resolved.`
        });
        continue;
      }

      finalText = proposedFinal;
      break;
    }

    const toolName = String(parsed.tool || "").toUpperCase();
    if (!toolName) {
      conversation.push({
        role: "system",
        content: "Your response must contain either a tool call or done=true."
      });
      continue;
    }

    if (WRITE_TOOLS.has(toolName) && inspectedFiles.size === 0) {
      const message = "Write rejected: inspect at least one relevant file before editing.";
      recordEvent("tool_rejected", { step, tool: toolName, message });
      conversation.push({
        role: "system",
        content: message
      });
      continue;
    }

    const args = parsed.args || {};
    const callKey = `${toolName}:${JSON.stringify(args)}`;
    const duplicateCount = toolCallCounts.get(callKey) || 0;
    toolCallCounts.set(callKey, duplicateCount + 1);

    if (duplicateCount >= MAX_DUPLICATE_TOOL_CALLS) {
      const message = `Duplicate tool call prevented. You already called ${toolName} with these arguments ${duplicateCount + 1} times. Use the existing result.`;
      recordEvent("validation", { step, tool: toolName, args, message });
      if (isReadOnly && inspectedFiles.size > 0 && changedFiles.size === 0 && duplicateCount >= MAX_DUPLICATE_TOOL_CALLS + 1) {
        // Force final — model is stuck in a loop
        const summary = buildReadOnlySummary(toolCalls, readFileCache);
        finalText = parsed.final || `Task completed. ${summary}`;
        recordEvent("completion", { step, message: "Forced final after repeated duplicate tool calls.", finalText });
        break;
      }
      conversation.push({ role: "system", content: message });
      continue;
    }

    const readFilePath = toolName === "READ_FILE" && args.path
      ? String(args.path).replace(/\\/g, "/") : null;
    if (readFilePath && readFileCache.has(readFilePath)) {
      const cachedContent = readFileCache.get(readFilePath);
      const message = `You already read "${readFilePath}". Here is its content again:\n\n${cachedContent.slice(0, 12000)}\n\nUse this content. Do not call READ_FILE on this path again.`;
      const cacheHitCount = toolCallCounts.get(`${toolName}:${JSON.stringify(args)}`) || 0;
      if (isReadOnly && inspectedFiles.size > 0 && changedFiles.size === 0 && cacheHitCount >= MAX_DUPLICATE_TOOL_CALLS + 1) {
        // Force final — model is stuck requesting the same file
        const summary = buildReadOnlySummary(toolCalls, readFileCache);
        finalText = parsed.final || `Task completed. ${summary}`;
        recordEvent("completion", { step, message: "Forced final after repeated READ_FILE of same path.", finalText });
        break;
      }
      conversation.push({ role: "system", content: message });
      continue;
    }

    recordEvent("tool_started", { step, tool: toolName, args });
    if (DEBUG()) console.log("[runAgentLoop] step %d tool=%s args=%j", step, toolName, args);
    const startedAt = new Date();
    const result = await executeTool(toolName, args, toolContext);
    if (DEBUG()) {
      const ms = (new Date() - startedAt);
      console.log("[runAgentLoop] step %d tool=%s done success=%s duration=%dms",
        step, toolName, result?.success !== false, ms);
    }
    const completedAt = new Date();
    const toolCall = {
      step,
      tool: toolName,
      args,
      success: result?.success !== false,
      result: summarizeToolResult(result, toolName),
      startedAt,
      completedAt
    };
    toolCalls.push(toolCall);
    history.push(toolCall);
    recordEvent("tool_completed", {
      step,
      tool: toolName,
      success: toolCall.success,
      file: result?.file,
      error: result?.error || null
    });

    if (toolName === "READ_FILE" && result?.success && result.file) {
      inspectedFiles.add(result.file);
      if (result.content) {
        const normalized = String(result.file).replace(/\\/g, "/");
        readFileCache.set(normalized, result.content);
      }
    }

    if (WRITE_TOOLS.has(toolName) && result?.success && result?.changed && result.file) {
      changedFiles.add(result.file);
      recordEvent("file_changed", { step, tool: toolName, file: result.file });

      const validation = await executeTool(
        "VALIDATE_PATCH",
        { file: result.file },
        toolContext
      );
      const validationCall = {
        step,
        tool: "VALIDATE_PATCH",
        args: { file: result.file },
        success: validation?.success !== false,
        result: summarizeToolResult(validation, "VALIDATE_PATCH"),
        startedAt: new Date(),
        completedAt: new Date()
      };
      toolCalls.push(validationCall);
      history.push(validationCall);
      recordEvent("validation", {
        step,
        file: result.file,
        success: validationCall.success,
        output: validation?.output || validation?.error || ""
      });

      if (!validationCall.success) {
        validationFailed = true;
      }
    }

    conversation.push({
      role: "assistant",
      content: JSON.stringify(parsed)
    });
    conversation.push({
      role: "system",
      content: `TOOL RESULT ${toolName}: ${compactResult(result)}`
    });
  }

  // Graceful completion when maxSteps exhausted but useful observations exist
  if (isReadOnly && !finalText && inspectedFiles.size > 0 && changedFiles.size === 0) {
    const summary = buildReadOnlySummary(toolCalls, readFileCache);
    finalText = `Read-only task completed. ${summary}`;
    if (DEBUG()) console.log("[runAgentLoop] graceful read-only completion at max steps");
  }

  if (resolvedWorkspaceRoot) {
    const after = await getGitSnapshot(resolvedWorkspaceRoot);
    const baselineFiles = new Set(baseline.changedFiles || []);
    for (const file of after.changedFiles || []) {
      if (!baselineFiles.has(file)) changedFiles.add(file);
    }
  }

  const changedFileList = [...changedFiles].sort();
  const diffSummary = resolvedWorkspaceRoot
    ? await getDiffSummary(resolvedWorkspaceRoot, changedFileList)
    : {
        stat: changedFileList.length ? `${changedFileList.length} uploaded file(s) changed` : "",
        numstat: ""
      };

  if (!qualityGate?.passed) {
    qualityGate = await evaluateQualityGate({
      acceptanceCriteria: criteria,
      changedFiles: changedFileList,
      toolCalls,
      workspaceRoot: resolvedWorkspaceRoot,
      finalText
    });
  }

  const hasReadOnlyCompleted = isReadOnly && inspectedFiles.size > 0 && changedFiles.size === 0 && finalText;
  const success = hasReadOnlyCompleted || (qualityGate.passed === true && !validationFailed);
  const status = success ? "completed" : "needs_revision";
  if (!finalText) {
    finalText = success
      ? "Agent implementation passed all acceptance criteria."
      : "Agent reached the execution limit before passing the quality gate.";
  }

  recordEvent(status, {
    changedFiles: changedFileList,
    validationFailed,
    qualityGate
  });

  if (DEBUG()) {
    console.log("[runAgentLoop] final status=%s success=%s changedFiles=%d steps=%d",
      status, success, changedFileList.length, events.filter(e => e.type === "thinking").length);
  }

  return {
    success,
    status,
    final: finalText,
    error: success
      ? null
      : qualityGate.feedback,
    history,
    events,
    toolCalls,
    changedFiles: changedFileList,
    diffSummary,
    qualityGate,
    acceptanceCriteria: criteria,
    workspaceRoot: resolvedWorkspaceRoot || null,
    workspaceId: workspaceId || null
  };
}
