import AiProvider from "../../models/AiProvider.js";
import AiAgent from "../../models/AiAgent.js";
import AgentTask from "../../models/AgentTask.js";
import AgentRun from "../../models/AgentRun.js";
import AgentPromptTemplate from "../../models/AgentPromptTemplate.js";
import { providerRegistry } from "../../services/adapters/index.js";
import { runAgentLoop } from "../../agent/runAgentLoop.js";
import { buildAcceptanceCriteria } from "../../agent/acceptanceCriteria.js";
import { getWorkspaceByPublicId } from "../workspace/workspace.service.js";
import { isRemoteWorkspaceMode } from "../../agent/workspace.js";

const DEBUG = () => process.env.DEBUG_AGENT === "true";

const activeRuns = new Map();

const FALLBACK_ERROR_KEYWORDS = [
  "network", "timeout", "timed out", "etimedout", "econnrefused", "econnreset",
  "quota", "rate limit", "rate_limit", "429", "401", "403", "404", "408", "409",
  "400", "500", "502", "503", "504",
  "unauthorized", "forbidden", "authentication", "api key", "api_key",
  "not configured", "not set", "model", "does not exist", "no access",
  "access denied", "empty response", "empty", "no response",
  "invalid model", "model not found", "not found", "conflict",
  "server error", "internal server error", "bad request"
];

function isFallbackError(message) {
  const lower = String(message ?? "").toLowerCase();
  return FALLBACK_ERROR_KEYWORDS.some(kw => lower.includes(kw));
}

const FATAL_ERROR_CODES = new Set(["NO_CREDIT", "MODEL_NOT_FOUND"]);

function classifyProviderError(message) {
  const lower = String(message ?? "").toLowerCase();
  if (lower.includes("402") || /insufficient.*credit|no.*credit|payment.*required/i.test(lower)) return "NO_CREDIT";
  if (lower.includes("404") || /model.*not found|does not exist|not found for/i.test(lower)) return "MODEL_NOT_FOUND";
  if (lower.includes("401") || lower.includes("403") || /unauthorized|forbidden|api.key|api_key|invalid.*key/i.test(lower)) return "BAD_KEY_OR_NO_ACCESS";
  if (lower.includes("429") || /rate.?limit/i.test(lower)) return "RATE_LIMIT";
  return "UNKNOWN";
}

function normalizeTaskType(value) {
  const upper = String(value || "CODING").toUpperCase();
  if (["CODING", "ANALYSIS", "SEARCH", "CHAT"].includes(upper)) return upper;
  return "CODING";
}

export { isFallbackError, autoGenerateResponse };

async function getAutoFallbackAgents() {
  const agents = await AiAgent.find({
    isActive: true,
    agentType: "coding",
    code: { $ne: "auto_coding" }
  }).populate("providerId").sort({ priority: 1 });

  return agents.filter(a => a.providerId && a.providerId.code !== "manual_external");
}

const MAX_INVALID_JSON_RETRIES = 2;

async function autoGenerateResponse(messages, fallbackAgents, attemptsRef) {
  let invalidJsonCount = 0;

  while (fallbackAgents.length > 0) {
    const current = fallbackAgents[0];
    const currentAdapter = providerRegistry.getAdapter(current.providerId.code);

    // Skip unconfigured providers
    if (!(await currentAdapter.isConfigured())) {
      const configError = currentAdapter.getConfigError();
      console.log("[AutoAgent] %s not configured: %s", current.name, configError);
      attemptsRef.push({
        provider: current.name,
        model: current.modelName,
        status: "skipped",
        error: configError,
        timestamp: new Date()
      });
      fallbackAgents.shift();
      invalidJsonCount = 0;
      console.log("[AutoAgent] fallback to %s", fallbackAgents[0]?.name ?? "(none)");
      continue;
    }

    try {
      console.log("[AutoAgent] trying %s (%s)", current.name, current.modelName);
      const response = await currentAdapter.run({
        modelName: current.modelName,
        messages,
        temperature: 0,
        maxTokens: current.maxTokens
      });

      if (!response.success) {
        const errMsg = response.error || "Unknown provider error";
        const health = classifyProviderError(errMsg);
        console.log("[AutoAgent] failed: %s - %s [%s]", current.name, errMsg, health);
        attemptsRef.push({
          provider: current.name,
          model: current.modelName,
          status: "failed",
          error: `${errMsg} [${health}]`,
          timestamp: new Date()
        });
        fallbackAgents.shift();
        invalidJsonCount = 0;
        console.log("[AutoAgent] fallback to %s", fallbackAgents[0]?.name ?? "(none)");
        continue;
      }

      const text = response.outputText || "";

      // Empty response check
      if (!text.trim()) {
        const errMsg = "Empty response from provider";
        console.log("[AutoAgent] failed: %s - %s", current.name, errMsg);
        attemptsRef.push({
          provider: current.name,
          model: current.modelName,
          status: "failed",
          error: errMsg,
          timestamp: new Date()
        });
        fallbackAgents.shift();
        invalidJsonCount = 0;
        console.log("[AutoAgent] fallback to %s", fallbackAgents[0]?.name ?? "(none)");
        continue;
      }

      // Lenient JSON check — if it contains {…} try strict parse; if malformed, switch provider
      const hasObject = text.includes("{") && text.includes("}");
      if (hasObject) {
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start !== -1 && end > start) {
          try {
            JSON.parse(text.slice(start, end + 1));
          } catch {
            console.log("[AutoAgent] failed: %s - malformed JSON", current.name);
            attemptsRef.push({
              provider: current.name,
              model: current.modelName,
              status: "failed",
              error: "Malformed JSON response",
              timestamp: new Date()
            });
            fallbackAgents.shift();
            invalidJsonCount = 0;
            console.log("[AutoAgent] fallback to %s", fallbackAgents[0]?.name ?? "(none)");
            continue;
          }
        }
      } else {
        // No JSON object at all — check for fatal errors before retrying
        const health = classifyProviderError(text);
        if (FATAL_ERROR_CODES.has(health)) {
          console.log("[AutoAgent] failed: %s - fatal error [%s] — skipping immediately", current.name, health);
          attemptsRef.push({
            provider: current.name,
            model: current.modelName,
            status: "failed",
            error: `${health}: Non-JSON response with fatal error pattern`,
            timestamp: new Date()
          });
          fallbackAgents.shift();
          invalidJsonCount = 0;
          console.log("[AutoAgent] fallback to %s", fallbackAgents[0]?.name ?? "(none)");
          continue;
        }
        invalidJsonCount++;
        console.log("[AutoAgent] %s returned non-JSON (attempt %d/%d)",
          current.name, invalidJsonCount, MAX_INVALID_JSON_RETRIES);
        if (invalidJsonCount >= MAX_INVALID_JSON_RETRIES) {
          console.log("[AutoAgent] failed: %s - no JSON after %d attempts", current.name, MAX_INVALID_JSON_RETRIES);
          attemptsRef.push({
            provider: current.name,
            model: current.modelName,
            status: "failed",
            error: "No valid JSON after retries",
            timestamp: new Date()
          });
          fallbackAgents.shift();
          invalidJsonCount = 0;
          console.log("[AutoAgent] fallback to %s", fallbackAgents[0]?.name ?? "(none)");
          continue;
        }
        // Retry same provider (messages unchanged)
        continue;
      }

      attemptsRef.push({
        provider: current.name,
        model: current.modelName,
        status: "success",
        timestamp: new Date()
      });
      return text;
    } catch (error) {
      const errMsg = error.message || "Unknown error";
      console.log("[AutoAgent] failed: %s - %s", current.name, errMsg);
      attemptsRef.push({
        provider: current.name,
        model: current.modelName,
        status: "failed",
        error: errMsg,
        timestamp: new Date()
      });
      fallbackAgents.shift();
      invalidJsonCount = 0;
      console.log("[AutoAgent] fallback to %s", fallbackAgents[0]?.name ?? "(none)");
    }
  }

  // All providers exhausted — build detailed error
  const summary = attemptsRef.map(a =>
    `  ${a.status === "success" ? "✓" : a.status === "skipped" ? "-" : "✗"} ${a.provider} (${a.model}): ${a.status}${a.error ? " - " + a.error : ""}`
  ).join("\n");
  const detailed = `All AI providers failed:\n${summary}`;
  console.log("[AutoAgent] %s", detailed);
  throw new Error(detailed);
}

async function executeAgentRun({
  task,
  agent,
  run,
  workspace,
  continueRun = false,
  continuationFeedback = "",
  abortSignal = null,
  onEvent = () => {},
  fallbackAgents = null
}) {
  const isAutoMode = Array.isArray(fallbackAgents) && fallbackAgents.length > 0;
  let effectiveAgent = agent;

  if (isAutoMode) {
    effectiveAgent = fallbackAgents[0];
  }

  const adapter = providerRegistry.getAdapter(effectiveAgent.providerId.code);

  if (DEBUG()) {
    console.log("[AgentRun] executeAgentRun agent=%s (%s) provider=%s model=%s",
      effectiveAgent.name, effectiveAgent.code, effectiveAgent.providerId.code, effectiveAgent.modelName);
    console.log("[AgentRun] workspace id=%s rootPath=%s sourceType=%s",
      workspace.id, workspace.rootPath, workspace.sourceType);
    console.log("[AgentRun] run=%s task=%s continue=%s autoMode=%s",
      run._id, task._id, continueRun, isAutoMode);
  }

  if (!isAutoMode && (effectiveAgent.providerId.type === "manual" || effectiveAgent.providerId.code === "manual_external")) {
    const error = "Manual external agents cannot execute Coding Agent tools or persist workspace changes";
    run.status = "error";
    run.errorMessage = error;
    run.executionEvents = [{
      type: "failed",
      message: error,
      time: new Date()
    }];
    run.completedAt = new Date();
    await run.save();
    return { success: false, error, run };
  }

  const isConfigured = isAutoMode ? true : await adapter.isConfigured();

  if (!isConfigured) {
    const error = adapter.getConfigError();
    run.status = "error";
    run.errorMessage = error;
    await run.save();
    return { success: false, error, run };
  }

  run.status = "running";
  run.startedAt = new Date();
  run.completedAt = null;
  run.workspaceId = workspace.id;
  run.workspaceRoot = workspace.rootPath;
  await run.save();

  const autoAttempts = [];

  const result = await runAgentLoop({
    messages: [
      { role: "system", content: agent.systemPrompt },
      ...(continuationFeedback
        ? [{ role: "system", content: `Previous quality gate feedback:\n${continuationFeedback}` }]
        : []),
      { role: "user", content: run.inputPrompt }
    ],
    workspaceId: workspace.id,
    workspaceRoot: run.workspaceRoot,
    maxSteps: 20,
    acceptanceCriteria: run.acceptanceCriteria?.objective
      ? run.acceptanceCriteria
      : null,
    initialChangedFiles: continueRun ? run.changedFiles || [] : [],
    initialToolCalls: continueRun ? run.toolCalls || [] : [],
    initialEvents: continueRun ? run.executionEvents || [] : [],
    abortSignal,
    onEvent: (event) => {
      onEvent(event);
    },
    generateResponse: async ({ messages }) => {
      if (isAutoMode) {
        return autoGenerateResponse(messages, fallbackAgents, autoAttempts);
      }
      if (DEBUG()) {
        console.log("[AgentRun] calling provider adapter.run provider=%s model=%s messages=%d",
          effectiveAgent.providerId.code, effectiveAgent.modelName, messages.length);
      }
      const response = await adapter.run({
        modelName: effectiveAgent.modelName,
        messages,
        temperature: 0,
        maxTokens: effectiveAgent.maxTokens
      });

      if (!response.success) {
        if (DEBUG()) console.log("[AgentRun] provider error: %s", response.error);
        throw new Error(response.error || "AI provider execution failed");
      }

      if (DEBUG()) console.log("[AgentRun] provider OK outputLength=%d", response.outputText?.length ?? 0);
      return response.outputText;
    }
  });

  if (DEBUG()) {
    console.log("[AgentRun] runAgentLoop done status=%s success=%s qualityGate=%s",
      result.status, result.success, result.qualityGate?.passed ?? "N/A");
  }

  run.status = result.status === "error"
    ? "error"
    : result.qualityGate?.passed === true
      ? "completed"
      : "needs_revision";
  run.outputText = result.final || "";
  run.rawResponse = {
    success: result.success,
    error: result.error || null
  };
  run.errorMessage = run.status !== "completed"
    ? result.error || "Agent implementation needs revision"
    : null;
  run.changedFiles = result.changedFiles || [];
  run.toolCalls = result.toolCalls || [];
  run.executionEvents = result.events || [];
  run.diffSummary = result.diffSummary || {};
  run.qualityGate = result.qualityGate || {};
  run.acceptanceCriteria = result.acceptanceCriteria || {};
  run.currentStep = result.history?.length || 0;
  run.currentTool = "";
  run.executionSummary = {
    changedFileCount: run.changedFiles.length,
    toolCallCount: run.toolCalls.length,
    eventCount: run.executionEvents.length,
    final: result.final || "",
    qualityScore: result.qualityGate?.score || 0
  };
  if (isAutoMode && autoAttempts.length > 0) {
    run.autoFailover = { attempts: autoAttempts };
  }
  run.completedAt = new Date();
  await run.save();

  return {
    success: run.status === "completed" && run.qualityGate?.passed === true,
    error: run.errorMessage,
    run
  };
}

function taskStatusForRun(run) {
  if (run.status === "completed") return "completed";
  if (run.status === "error") return "error";
  return "needs_revision";
}

/**
 * Get all AI Providers with configuration status
 */
export async function getProviders(req, res) {
  try {
    const providers = await AiProvider.find({ isActive: true });

    const result = await Promise.all(
      providers.map(async (p) => ({
        _id: p._id,
        name: p.name,
        code: p.code,
        type: p.type,
        isActive: p.isActive,
        isConfigured: await providerRegistry.isConfigured(p.code),
        configError: providerRegistry.getConfigError(p.code),
        createdAt: p.createdAt
      }))
    );

    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error("getProviders error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch providers",
      error: error.message
    });
  }
}

/**
 * Get all AI Agents
 */
export async function getAgents(req, res) {
  try {
    const { agentType, providerCode } = req.query;

    const filter = { isActive: true };

    if (agentType) {
      filter.agentType = agentType;
    }

    if (providerCode) {
      const provider = await AiProvider.findOne({ code: providerCode });
      if (provider) {
        filter.providerId = provider._id;
      }
    }

    const agents = await AiAgent.find(filter)
      .populate("providerId", "code name type")
      .sort({ createdAt: -1 });

    return res.json({
      success: true,
      data: agents
    });
  } catch (error) {
    console.error("getAgents error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch agents",
      error: error.message
    });
  }
}

/**
 * Get all Agent Tasks
 */
export async function getTasks(req, res) {
  try {
    const { status, taskType } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);

    const filter = {};
    if (status) filter.status = status;
    if (taskType) filter.taskType = taskType;

    const tasks = await AgentTask.find(filter)
      .populate("selectedAgentId", "name code modelName")
      .sort({ createdAt: -1 })
      .limit(limit);

    return res.json({
      success: true,
      data: tasks
    });
  } catch (error) {
    console.error("getTasks error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch tasks",
      error: error.message
    });
  }
}

/**
 * Get task detail with runs
 */
export async function getTaskDetail(req, res) {
  try {
    const { taskId } = req.params;

    const task = await AgentTask.findById(taskId)
      .populate("selectedAgentId", "name code modelName")
      .populate("createdBy", "email");

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found"
      });
    }

    const runs = await AgentRun.find({ taskId })
      .populate("agentId", "name code modelName")
      .sort({ createdAt: -1 });

    return res.json({
      success: true,
      data: {
        task,
        runs
      }
    });
  } catch (error) {
    console.error("getTaskDetail error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch task detail",
      error: error.message
    });
  }
}

/**
 * Create new Agent Task
 */
export async function createTask(req, res) {
  try {
    const { title, inputPrompt, taskType, normalizedPrompt } = req.body;

    if (!title || !inputPrompt || !taskType) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: title, inputPrompt, taskType"
      });
    }

    const task = new AgentTask({
      title,
      inputPrompt,
      normalizedPrompt: normalizedPrompt || inputPrompt,
      taskType: normalizeTaskType(taskType),
      status: "draft"
    });

    await task.save();

    return res.status(201).json({
      success: true,
      data: task
    });
  } catch (error) {
    console.error("createTask error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create task",
      error: error.message
    });
  }
}

/**
 * Run Agent Task with selected agent
 */
export async function runTask(req, res) {
  let run = null;
  let task = null;
  try {
    const { taskId } = req.params;
    const { agentId, workspaceId } = req.body;

    if (!workspaceId) {
      return res.status(400).json({
        success: false,
        message: "Please create or select a workspace first."
      });
    }

    if (!agentId) {
      return res.status(400).json({
        success: false,
        message: "Missing required field: agentId"
      });
    }

    // Get task
    task = await AgentTask.findById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found"
      });
    }

    // Get agent
    const agent = await AiAgent.findById(agentId).populate("providerId");
    if (!agent) {
      return res.status(404).json({
        success: false,
        message: "Agent not found"
      });
    }
    const workspace = await getWorkspaceByPublicId(workspaceId);

    // Create run
    run = new AgentRun({
      taskId,
      agentId,
      providerCode: agent.providerId.code,
      modelName: agent.modelName,
      inputPrompt: task.normalizedPrompt || task.inputPrompt,
      workspaceId: workspace.id,
      workspaceRoot: workspace.rootPath,
      status: "pending"
    });

    await run.save();

    task.status = "running";
    task.selectedAgentId = agent._id;
    task.workspaceId = workspace.id;
    await task.save();

    const result = await executeAgentRun({ task, agent, run, workspace });
    task.status = taskStatusForRun(result.run);
    await task.save();

    return res.status(result.success ? 200 : 422).json({
      success: result.success,
      data: result.run,
      message: result.success ? "Task completed with file changes" : result.error
    });
  } catch (error) {
    console.error("runTask error:", error);
    if (run) {
      run.status = "error";
      run.errorMessage = error.message;
      run.completedAt = new Date();
      await run.save().catch(() => {});
    }
    if (task) {
      task.status = "error";
      await task.save().catch(() => {});
    }
    return res.status(500).json({
      success: false,
      message: "Failed to run task",
      error: error.message
    });
  }
}

/**
 * Get Agent Runs for a task
 */
export async function getTaskRuns(req, res) {
  try {
    const { taskId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);

    const runs = await AgentRun.find({ taskId })
      .populate("agentId", "name code modelName")
      .sort({ createdAt: -1 })
      .limit(limit);

    return res.json({
      success: true,
      data: runs
    });
  } catch (error) {
    console.error("getTaskRuns error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch runs",
      error: error.message
    });
  }
}

/**
 * Get all Prompt Templates
 */
export async function getPromptTemplates(req, res) {
  try {
    const { taskType } = req.query;

    const filter = { isActive: true };
    if (taskType) {
      filter.taskType = taskType;
    }

    const templates = await AgentPromptTemplate.find(filter).sort({ createdAt: -1 });

    return res.json({
      success: true,
      data: templates
    });
  } catch (error) {
    console.error("getPromptTemplates error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch templates",
      error: error.message
    });
  }
}

/**
 * Create new Prompt Template
 */
export async function createPromptTemplate(req, res) {
  try {
    const { title, description, taskType, content, variables } = req.body;

    if (!title || !taskType || !content) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: title, taskType, content"
      });
    }

    const template = new AgentPromptTemplate({
      title,
      description,
      taskType,
      content,
      variables: variables || [],
      isActive: true
    });

    await template.save();

    return res.status(201).json({
      success: true,
      data: template
    });
  } catch (error) {
    console.error("createPromptTemplate error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create template",
      error: error.message
    });
  }
}

/**
 * Run task with multiple agents in parallel
 */
export async function runTaskMultiple(req, res) {
  let task = null;
  try {
    const { taskId } = req.params;
    const { agentIds, workspaceId } = req.body;

    if (!workspaceId) {
      return res.status(400).json({
        success: false,
        message: "Please create or select a workspace first."
      });
    }

    if (!agentIds || !Array.isArray(agentIds) || agentIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Missing required field: agentIds (non-empty array)"
      });
    }

    if (agentIds.length > 5) {
      return res.status(400).json({
        success: false,
        message: "Maximum 5 agents can run at once"
      });
    }

    // Get task
    task = await AgentTask.findById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found"
      });
    }
    const workspace = await getWorkspaceByPublicId(workspaceId);

    // Update task status
    task.status = "running";
    task.workspaceId = workspace.id;
    await task.save();

    // Create runs for all agents
    const runs = [];
    for (const agentId of agentIds) {
      const agent = await AiAgent.findById(agentId).populate("providerId");
      if (!agent) continue;

      const run = new AgentRun({
        taskId,
        agentId,
        providerCode: agent.providerId.code,
        modelName: agent.modelName,
        inputPrompt: task.normalizedPrompt || task.inputPrompt,
        workspaceId: workspace.id,
        workspaceRoot: workspace.rootPath,
        status: "pending"
      });

      await run.save();
      runs.push(run);
    }

    // Execute sequentially because all coding agents write to the same checkout.
    const completedRuns = [];
    for (const run of runs) {
      try {
        const agent = await AiAgent.findById(run.agentId).populate("providerId");
        const result = await executeAgentRun({ task, agent, run, workspace });
        completedRuns.push(result.run);
      } catch (error) {
        run.status = "error";
        run.errorMessage = error.message;
        run.completedAt = new Date();
        await run.save();
        completedRuns.push(run);
      }
    }

    // Update task status based on results
    const allCompleted = completedRuns.length > 0 &&
      completedRuns.every(run => run.status === "completed");
    task.status = allCompleted
      ? "completed"
      : completedRuns.some(item => item.status === "error")
        ? "error"
        : "needs_revision";
    await task.save();

    return res.status(allCompleted ? 200 : 422).json({
      success: allCompleted,
      data: {
        task,
        runs: completedRuns
      },
      message: allCompleted
        ? `Executed ${completedRuns.length} agents with persisted file changes`
        : "One or more agents failed or produced no file changes"
    });
  } catch (error) {
    console.error("runTaskMultiple error:", error);
    if (task) {
      task.status = "error";
      await task.save().catch(() => {});
    }
    return res.status(500).json({
      success: false,
      message: "Failed to run task with multiple agents",
      error: error.message
    });
  }
}

/**
 * Run an ad-hoc Coding Agent prompt in a selected project workspace.
 * Returns immediately with runId. Agent executes in background.
 */
export async function runAgentPrompt(req, res) {
  console.log("[AGENT RUN] received", req.body);
  try {
    const { workspaceId, prompt, agentId } = req.body;

    if (!workspaceId) {
      return res.status(400).json({
        success: false,
        message: "Please create or select a workspace first."
      });
    }

    const normalizedPrompt = String(prompt || "").trim();
    if (!normalizedPrompt) {
      return res.status(400).json({ success: false, message: "prompt is required" });
    }

    const workspace = await getWorkspaceByPublicId(workspaceId);
    const agent = agentId
      ? await AiAgent.findById(agentId).populate("providerId")
      : await AiAgent.findOne({ isActive: true, agentType: "coding" })
          .populate("providerId")
          .sort({ createdAt: 1 });

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: "No coding agent is available"
      });
    }

    const isAutoMode = agent.code === "auto_coding";
    let fallbackAgents = null;

    if (isAutoMode) {
      fallbackAgents = await getAutoFallbackAgents();
      if (fallbackAgents.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No fallback coding agents available for Auto mode"
        });
      }
    }

    const criteria = buildAcceptanceCriteria(normalizedPrompt);
    const taskType = normalizeTaskType(criteria.taskType || "CODING");

    const task = await AgentTask.create({
      title: normalizedPrompt.slice(0, 100),
      inputPrompt: normalizedPrompt,
      normalizedPrompt,
      taskType,
      selectedAgentId: agent._id,
      workspaceId: workspace.id,
      status: "running"
    });

    const run = await AgentRun.create({
      taskId: task._id,
      agentId: agent._id,
      providerCode: isAutoMode ? "auto" : agent.providerId.code,
      modelName: isAutoMode ? "auto" : agent.modelName,
      inputPrompt: normalizedPrompt,
      workspaceId: workspace.id,
      workspaceRoot: workspace.rootPath,
      status: "running",
      startedAt: new Date(),
      acceptanceCriteria: criteria
    });

    const abortController = new AbortController();
    activeRuns.set(String(run._id), abortController);

    res.status(200).json({
      success: true,
      data: {
        runId: run._id,
        status: "running"
      }
    });

    setImmediate(async () => {
      try {
        await executeAgentRun({
          task, agent, run, workspace,
          abortSignal: abortController.signal,
          fallbackAgents: isAutoMode ? [...fallbackAgents] : null,
          onEvent: (event) => {
            if (abortController.signal.aborted) return;
            const update = { $push: { executionEvents: event }, $set: {} };
            if (event.step !== undefined) update.$set.currentStep = event.step;
            if (event.tool) update.$set.currentTool = event.tool;
            if (Object.keys(update.$set).length === 0) delete update.$set;
            AgentRun.findByIdAndUpdate(run._id, update).catch(() => {});
          }
        });
      } catch (err) {
        console.error("Background agent run error:", err.message);
        if (DEBUG()) console.error("[AgentRun] background stack:", err.stack);
        try {
          await AgentRun.findByIdAndUpdate(run._id, {
            $set: {
              status: "error",
              errorMessage: err.message,
              completedAt: new Date()
            }
          });
        } catch (e) { /* ignore cleanup error */ }
        try {
          await AgentTask.findByIdAndUpdate(task._id, { $set: { status: "error" } });
        } catch (e) { /* ignore */ }
      } finally {
        activeRuns.delete(String(run._id));
      }
    });
  } catch (error) {
    console.error("runAgentPrompt error:", error.message);
    if (DEBUG()) console.error("[AgentRun] request stack:", error.stack);
    return res.status(500).json({
      success: false,
      message: "Failed to run Coding Agent",
      error: error.message
    });
  }
}

/**
 * Continue an existing failed or needs_revision run with the same task/workspace.
 */
export async function continueAgentRun(req, res) {
  try {
    const run = await AgentRun.findById(req.params.runId)
      .populate("agentId")
      .populate("taskId");

    if (!run) {
      return res.status(404).json({ success: false, message: "Agent run not found" });
    }

    if (!["needs_revision", "error"].includes(run.status)) {
      return res.status(400).json({
        success: false,
        message: "Only failed or needs_revision runs can be continued"
      });
    }

    const agent = await AiAgent.findById(run.agentId._id).populate("providerId");
    const task = await AgentTask.findById(run.taskId._id);
    const workspace = await getWorkspaceByPublicId(run.workspaceId);

    if (!agent || !task) {
      return res.status(404).json({
        success: false,
        message: "Run agent or task no longer exists"
      });
    }

    task.status = "running";
    await task.save();

    const result = await executeAgentRun({
      task,
      agent,
      run,
      workspace,
      continueRun: true,
      continuationFeedback: run.qualityGate?.feedback || run.errorMessage || ""
    });

    task.status = taskStatusForRun(result.run);
    await task.save();

    return res.status(result.success ? 200 : 422).json({
      success: result.success,
      data: result.run,
      message: result.success
        ? "Agent run completed after continuation"
        : "Agent run still needs revision"
    });
  } catch (error) {
    console.error("continueAgentRun error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to continue agent run",
      error: error.message
    });
  }
}

/**
 * Get current status of an agent run (for polling).
 */
export async function getAgentRun(req, res) {
  try {
    const run = await AgentRun.findById(req.params.runId)
      .populate("agentId", "name code modelName");

    if (!run) {
      return res.status(404).json({ success: false, message: "Run not found" });
    }

    const toolCalls = run.toolCalls || [];
    const executionEvents = run.executionEvents || [];

    const filesRead = [...new Set(
      toolCalls
        .filter(call => call.tool === "READ_FILE" && call.success !== false)
        .map(call => call.args?.path || call.result?.file)
        .filter(Boolean)
    )];

    const errors = [
      run.errorMessage,
      ...executionEvents
        .filter(event => event.type === "error" || event.type === "failed")
        .map(event => event.message)
    ].filter(Boolean);

    return res.json({
      success: true,
      data: {
        id: run._id,
        status: run.status,
        currentStep: run.currentStep || 0,
        currentTool: run.currentTool || "",
        filesRead,
        changedFiles: run.changedFiles || [],
        toolCalls,
        executionEvents,
        errors,
        qualityGate: run.qualityGate || {},
        outputText: run.outputText || "",
        diffSummary: run.diffSummary || {},
        autoFailover: run.autoFailover || null
      }
    });
  } catch (error) {
    console.error("getAgentRun error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
}

/**
 * Cancel a running agent run.
 */
export async function cancelAgentRun(req, res) {
  try {
    const run = await AgentRun.findById(req.params.runId);

    if (!run) {
      return res.status(404).json({ success: false, message: "Run not found" });
    }

    if (["completed", "error", "cancelled"].includes(run.status)) {
      return res.status(400).json({
        success: false,
        message: `Run is already ${run.status}`
      });
    }

    run.status = "cancelled";
    run.completedAt = new Date();
    run.errorMessage = "Cancelled by user";
    await run.save();

    const controller = activeRuns.get(String(run._id));
    if (controller) {
      controller.abort();
      activeRuns.delete(String(run._id));
    }

    return res.json({ success: true, message: "Run cancelled" });
  } catch (error) {
    console.error("cancelAgentRun error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
}

/**
 * Compare outputs from multiple runs
 */
export async function compareRuns(req, res) {
  try {
    const { taskId } = req.params;
    const { runIds } = req.body;

    if (!runIds || !Array.isArray(runIds) || runIds.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Need at least 2 runIds to compare"
      });
    }

    const runs = await AgentRun.find({ _id: { $in: runIds }, taskId })
      .populate("agentId", "name code modelName");

    if (runs.length < 2) {
      return res.status(400).json({
        success: false,
        message: "At least 2 valid runs required for comparison"
      });
    }

    const comparison = {
      taskId,
      runs: runs.map(r => ({
        runId: r._id,
        agentName: r.agentId.name,
        agentCode: r.agentId.code,
        modelName: r.modelName,
        status: r.status,
        outputLength: r.outputText?.length || 0,
        outputPreview: r.outputText?.substring(0, 200) || "",
        completedAt: r.completedAt,
        errorMessage: r.errorMessage
      })),
      completedAt: new Date()
    };

    return res.json({
      success: true,
      data: comparison
    });
  } catch (error) {
    console.error("compareRuns error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to compare runs",
      error: error.message
    });
  }
}

/**
 * Update task details
 */
export async function updateTask(req, res) {
  try {
    const { taskId } = req.params;
    const { title, inputPrompt, taskType, normalizedPrompt } = req.body;

    const task = await AgentTask.findById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found"
      });
    }

    // Update fields if provided
    if (title) task.title = title;
    if (inputPrompt) task.inputPrompt = inputPrompt;
    if (taskType) task.taskType = normalizeTaskType(taskType);
    if (normalizedPrompt) task.normalizedPrompt = normalizedPrompt;

    await task.save();

    return res.json({
      success: true,
      data: task,
      message: "Task updated successfully"
    });
    } catch (error) {
      console.error("updateTask error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update task",
        error: error.message
      });
    }
  }

function cancelActiveRun(runId) {
  const controller = activeRuns.get(String(runId));
  if (controller) {
    controller.abort();
    activeRuns.delete(String(runId));
  }
}

/**
 * Delete a task and all its runs.
 */
export async function deleteTask(req, res) {
  try {
    const { taskId } = req.params;

    const task = await AgentTask.findById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found"
      });
    }

    // Cancel all active runs for this task
    const runs = await AgentRun.find({ taskId });
    for (const run of runs) {
      cancelActiveRun(run._id);
    }

    await AgentRun.deleteMany({ taskId });
    await AgentTask.findByIdAndDelete(taskId);

    console.log(`[TaskCleanup] Deleted task ${taskId} with ${runs.length} runs`);
    return res.json({
      success: true,
      message: "Task and related runs deleted",
      data: { deletedRuns: runs.length }
    });
  } catch (error) {
    console.error("deleteTask error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete task",
      error: error.message
    });
  }
}

/**
 * Delete a single run.
 */
export async function deleteRun(req, res) {
  try {
    const { runId } = req.params;

    const run = await AgentRun.findById(runId);
    if (!run) {
      return res.status(404).json({
        success: false,
        message: "Run not found"
      });
    }

    cancelActiveRun(run._id);
    await AgentRun.findByIdAndDelete(runId);

    console.log(`[TaskCleanup] Deleted run ${runId}`);
    return res.json({
      success: true,
      message: "Run deleted"
    });
  } catch (error) {
    console.error("deleteRun error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete run",
      error: error.message
    });
  }
}
