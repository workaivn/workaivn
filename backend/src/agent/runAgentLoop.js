import { askAI } from "../services/aiRouter.js";
import { executeTool } from "./toolExecutor.js";
import {
  getDiffSummary,
  getGitSnapshot,
  getWorkspaceRoot
} from "./workspace.js";

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

function summarizeToolResult(result) {
  if (!result || typeof result !== "object") return result;

  const summary = { ...result };
  if (typeof summary.content === "string") {
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

async function defaultGenerateResponse({ messages, plan }) {
  return askAI({ messages, mode: "agent", plan });
}

export async function runAgentLoop({
  messages = [],
  plan = "free",
  activeFiles = [],
  workspaceId = "",
  workspaceRoot = "",
  maxSteps = 12,
  onEvent = () => {},
  generateResponse = defaultGenerateResponse
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
  const events = [];
  const toolCalls = [];
  const changedFiles = new Set();
  const inspectedFiles = new Set();
  const baseline = resolvedWorkspaceRoot
    ? await getGitSnapshot(resolvedWorkspaceRoot)
    : { changedFiles: [] };
  let finalText = "";
  let validationFailed = false;

  const systemPrompt = `You are the WorkAI VN Coding Agent.

You must execute the coding task by using tools against the real workspace.
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
- Use exact relative paths.
- Make real edits with WRITE_FILE or APPLY_PATCH.
- Prefer APPLY_PATCH for focused edits.
- Do not claim completion without a persisted file change.
- Do not repeat a failed tool call without changing its arguments.
- Use RUN_TERMINAL for focused verification after edits when useful.
- Keep changes scoped to the objective.`;

  conversation.unshift({ role: "system", content: systemPrompt });
  conversation.push({
    role: "system",
    content: resolvedWorkspaceRoot
      ? `Workspace root is configured. All tool paths must be relative to it. Objective: ${objective}`
      : "This run uses uploaded in-memory files. Tool paths must match uploaded file paths."
  });

  function recordEvent(type, details = {}) {
    const event = createEvent(type, details);
    events.push(event);
    history.push(event);
    onEvent(event);
    return event;
  }

  for (let step = 0; step < maxSteps; step += 1) {
    recordEvent("thinking", { step });

    let parsed;
    let rawResponse;
    try {
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
        error: error.message,
        final: "Agent stopped because the model returned an invalid execution response.",
        history,
        events,
        toolCalls,
        changedFiles: [...changedFiles],
        diffSummary: { stat: "", numstat: "" }
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

        recordEvent("error", {
          step,
          message: retryError.message,
          rawResponse: String(retryResponse ?? rawResponse ?? "").slice(0, 2000)
        });
        return {
          success: false,
          error: retryError.message,
          final: "Agent stopped because the model returned an invalid execution response after one retry.",
          history,
          events,
          toolCalls,
          changedFiles: [...changedFiles],
          diffSummary: { stat: "", numstat: "" }
        };
      }
    }

    if (parsed.done) {
      if (changedFiles.size === 0) {
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

      finalText = parsed.final || "Coding task completed with persisted file changes.";
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
    recordEvent("tool_started", { step, tool: toolName, args });
    const startedAt = new Date();
    const result = await executeTool(toolName, args, toolContext);
    const completedAt = new Date();
    const toolCall = {
      step,
      tool: toolName,
      args,
      success: result?.success !== false,
      result: summarizeToolResult(result),
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
        result: summarizeToolResult(validation),
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

  const success = changedFileList.length > 0 && !validationFailed;
  if (!finalText) {
    finalText = success
      ? "Agent applied persisted file changes and finished at the execution step limit."
      : "Agent did not produce validated persisted file changes.";
  }

  recordEvent(success ? "completed" : "failed", {
    changedFiles: changedFileList,
    validationFailed
  });

  return {
    success,
    final: finalText,
    error: success
      ? null
      : validationFailed
        ? "One or more changed files failed validation."
        : "No persisted file changes were detected.",
    history,
    events,
    toolCalls,
    changedFiles: changedFileList,
    diffSummary,
    workspaceRoot: resolvedWorkspaceRoot || null,
    workspaceId: workspaceId || null
  };
}
