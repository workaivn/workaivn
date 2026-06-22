import { askAI } from "../services/aiRouter.js";
import { executeTool } from "./toolExecutor.js";
import {
  getDiffSummary,
  getGitSnapshot,
  getWorkspaceRoot
} from "./workspace.js";

const WRITE_TOOLS = new Set(["WRITE_FILE", "APPLY_PATCH"]);

function parseAgentResponse(response) {
  const cleaned = String(response || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start === -1 || end === -1) {
    throw new Error("AI returned no JSON object");
  }

  return JSON.parse(cleaned.slice(start, end + 1));
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
      parsed = parseAgentResponse(rawResponse);
    } catch (error) {
      recordEvent("error", {
        step,
        message: error.message,
        rawResponse: String(rawResponse || "").slice(0, 2000)
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
    workspaceRoot: resolvedWorkspaceRoot || null
  };
}
