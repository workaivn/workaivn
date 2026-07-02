import AiProvider from "../../models/AiProvider.js";
import mongoose from "mongoose";
import AiAgent from "../../models/AiAgent.js";
import AgentTask from "../../models/AgentTask.js";
import AgentRun from "../../models/AgentRun.js";
import AgentPromptTemplate from "../../models/AgentPromptTemplate.js";
import { providerRegistry } from "../../services/adapters/index.js";
import { createProviderRouter } from "../../agent/providers/index.js";
import { getDiffSummary } from "../../agent/workspace.js";
import { resolveWorkspacePathSafe } from "../../agent/workspace.js";
import { runAgentLoop } from "../../agent/runAgentLoop.js";
import { sanitizeRunPayload } from "../../agent/runPayload.js";
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
  if (message instanceof FallbackError) return true;
  if (message && typeof message === "object" && String(message.name || "").toLowerCase() === "fallbackerror") return true;
  const lower = String(message ?? "").toLowerCase();
  return FALLBACK_ERROR_KEYWORDS.some(kw => lower.includes(kw));
}

const FATAL_ERROR_CODES = new Set(["NO_CREDIT", "MODEL_NOT_FOUND"]);

export class FallbackError extends Error {
  constructor(message = "Fallback error") {
    super(message);
    this.name = "FallbackError";
    this.code = "FALLBACK_ERROR";
  }
}

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

function buildProviderRequestFromAgent(agent = {}) {
  const providerId = agent.providerId?.code || agent.providerId?.id || agent.providerId || agent.providerCode || null;
  return {
    providerId: providerId ? String(providerId) : null,
    model: agent.modelName || agent.model || null,
    providers: [agent].filter(Boolean)
  };
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
  const providerRouter = createProviderRouter({
    adapterRegistry: providerRegistry,
    allowFallback: false
  });

  while (fallbackAgents.length > 0) {
    const current = fallbackAgents[0];

    // Skip unconfigured providers through the router health path
    const selection = await providerRouter.selectProvider({
      ...buildProviderRequestFromAgent(current),
      providers: [current]
    });
    if (!selection.provider || !selection.adapter) {
      const configError = selection.providerErrors?.[0]?.error?.message || selection.providerErrors?.[0]?.error?.type || "not_configured";
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
      const response = await providerRouter.generate({
        ...buildProviderRequestFromAgent(current),
        messages,
        temperature: 0,
        maxTokens: current.maxTokens,
        purpose: "code_generation"
      });

      if (!response.success) {
        const errMsg = response.error?.message || response.error?.type || "Unknown provider error";
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

      const text = response.normalizedText || response.text || "";

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
  const providerRouter = createProviderRouter({
    adapterRegistry: providerRegistry,
    allowFallback: false
  });

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
  // Reset fields to prevent stale data from previous runs
  run.outputText = "";
  run.errorMessage = null;
  run.changedFiles = [];
  run.toolCalls = [];
  run.executionEvents = [];
  run.diffSummary = { stat: "", numstat: "" };
  run.plannerMetrics = {};
  await run.save();

  if (process.env.DEBUG_AGENT === "true" || process.env.WORKAI_AGENT_DEBUG === "true") {
    console.log("[RUN START]", {
      runId: String(run._id),
      provider: effectiveAgent.providerId.code,
      model: effectiveAgent.modelName,
      workspaceRoot: workspace.rootPath,
      originalPrompt: run.inputPrompt,
      promptLength: (run.inputPrompt || "").length,
      timestamp: new Date().toISOString()
    });
  }

  const autoAttempts = [];

  // Determine task type early
  const criteria = run.acceptanceCriteria?.objective
    ? run.acceptanceCriteria
    : buildAcceptanceCriteria(run.inputPrompt || task?.inputPrompt || "");
  const taskType = String(criteria.taskType || "CODING").toUpperCase();

  // Run startup logs and provider reset notices
  console.log("[AgentRun] new run started");
  if (isAutoMode) {
    console.log("[AgentRun] provider priority reset");
    const first = fallbackAgents?.[0];
    if (first) {
      console.log("[AgentRun] selected provider=%s model=%s", first.providerId?.code || "?", first.modelName || "?");
      if (first.providerId?.code === "ollama") {
        // Warn if Ollama is first while other configured providers exist
        let hasConfiguredHigher = false;
        for (const a of fallbackAgents) {
          if (a.providerId?.code !== "ollama") {
            try {
              if (await providerRegistry.isConfigured(a.providerId.code)) {
                hasConfiguredHigher = true; break;
              }
            } catch { /* ignore */ }
          }
        }
        if (hasConfiguredHigher) {
          console.warn("[AgentRun][WARN] Ollama selected before higher-priority providers were attempted");
        }
      }
    }
  } else {
    console.log("[AgentRun] selected provider=%s model=%s", agent.providerId.code, agent.modelName);
  }

  // Final-only answer mode for QA and CHAT: do not run Coding Agent loop or auto fallback
  if (criteria.taskMode === "qa" || taskType === "CHAT") {
    // Deterministic one-liner extraction: Reply with exactly one line: X
    const directMatch = /reply\s+with\s+exactly\s+one\s+line\s*:\s*([\s\S]+)/i.exec(run.inputPrompt || "");
    let finalText = "";
    if (directMatch && directMatch[1]) {
      finalText = String(directMatch[1]).split(/\r?\n/)[0].trim();
    } else {
      // Single provider call (no auto fallback storm), plain answer mode
      const response = await providerRouter.generate({
        ...buildProviderRequestFromAgent(effectiveAgent),
        messages: [{ role: "user", content: run.inputPrompt }],
        temperature: 0,
        maxTokens: effectiveAgent.maxTokens,
        purpose: "final_summary"
      });
      if (!response.success) {
        // On provider failure for CHAT, return needs_revision with error
        run.status = "error";
        run.outputText = "";
        run.errorMessage = response.error || "Provider error";
        run.qualityGate = {
          passed: false,
          score: 0,
          failures: [run.errorMessage],
          feedback: run.errorMessage
        };
        run.completedAt = new Date();
        await run.save();
        return { success: false, error: run.errorMessage, run };
      }
      finalText = String(response.normalizedText || response.text || "").trim();
    }

    run.status = "completed";
    run.outputText = finalText;
    run.rawResponse = { success: true, error: null };
    run.errorMessage = null;
    run.changedFiles = [];
    run.toolCalls = [];
    run.executionEvents = [];
    run.diffSummary = { stat: "", numstat: "" };
    run.plannerMetrics = {};
    run.qualityGate = {
      passed: !!finalText,
      score: finalText ? 100 : 0,
      failures: finalText ? [] : ["No final text"],
      feedback: finalText ? "Quality gate passed." : "No final text"
    };
    run.executionSummary = {
      changedFileCount: 0,
      toolCallCount: 0,
      eventCount: 0,
      final: finalText,
      qualityScore: run.qualityGate.score
    };
    run.completedAt = new Date();
    await run.save();
    if (process.env.DEBUG_AGENT === "true" || process.env.WORKAI_AGENT_DEBUG === "true") {
      const toolCalls = run.toolCalls || [];
      const filesRead = [...new Set(
        toolCalls.filter(c => c.tool === "READ_FILE" && c.success !== false).map(c => c.args?.path || c.result?.file).filter(Boolean)
      )];
      const patches = toolCalls.filter(c => c.tool === "APPLY_PATCH");
      const terminals = toolCalls.filter(c => c.tool === "RUN_TERMINAL");
      console.log("[RESPONSE TO FRONTEND]", {
        runId: String(run._id),
        status: run.status,
        filesRead: filesRead.length,
        filesChanged: (run.changedFiles || []).length,
        patchesApplied: patches.length,
        terminalCommands: terminals.length,
        finalPreview: String(run.outputText || "").slice(0, 1000),
        qualityGate: { score: run.qualityGate?.score || 0, failures: run.qualityGate?.failures || [] }
      });
    }
    return { success: true, error: null, run };
  }

  // Per-intent policy
  function buildRunPolicy(criteria, providerCode) {
    const mode = criteria.taskMode || (criteria.taskType === "CHAT" ? "qa" : (criteria.taskType === "CODING" ? "coding" : "read_only"));
    const isProject = criteria.taskClass === "product_build";
    if (mode === "qa") return { maxSteps: 1, runTimeoutMs: 60000, modelCallTimeoutMs: 60000, toolTimeoutMs: 120000 };
    if (isProject) return { maxSteps: 50, runTimeoutMs: 3600000, modelCallTimeoutMs: 180000, toolTimeoutMs: 300000 };
    if (mode === "coding") return { maxSteps: 30, runTimeoutMs: 3600000, modelCallTimeoutMs: 180000, toolTimeoutMs: 300000 };
    return { maxSteps: 4, runTimeoutMs: 180000, modelCallTimeoutMs: 90000, toolTimeoutMs: 120000 };
  }
  const policy = buildRunPolicy(criteria, agent.providerId.code);
  // Flag local model mode for simplified single-action prompts
  policy.localModelMode = ["koboldcpp", "llamacpp", "ollama"].includes(String(agent.providerId.code));
  run.maxSteps = policy.maxSteps;

  const result = await runAgentLoop({
    enableToolOptimizer: true,
    messages: [
      { role: "system", content: agent.systemPrompt },
      ...(continuationFeedback
        ? [{ role: "system", content: `Previous quality gate feedback:\n${continuationFeedback}` }]
        : []),
      { role: "user", content: run.inputPrompt }
    ],
    workspaceId: workspace.id,
    workspaceRoot: run.workspaceRoot,
    maxSteps: policy.maxSteps,
    acceptanceCriteria: criteria?.objective ? criteria : null,
    initialChangedFiles: continueRun ? run.changedFiles || [] : [],
    initialToolCalls: continueRun ? run.toolCalls || [] : [],
    initialEvents: continueRun ? run.executionEvents || [] : [],
    abortSignal,
    policy,
    onEvent: (event) => {
      onEvent(event);
    },
    generateResponse: async ({ messages, maxTokens, maxTokensCapOverride, purpose }) => {
      if (isAutoMode) {
        // Always pass a fresh list per response to prevent cross-run leakage
        return autoGenerateResponse(messages, [...fallbackAgents], autoAttempts);
      }
      if (DEBUG()) {
        console.log("[AgentRun] calling provider adapter.run provider=%s model=%s messages=%d",
          effectiveAgent.providerId.code, effectiveAgent.modelName, messages.length);
      }
      const response = await providerRouter.generate({
        ...buildProviderRequestFromAgent(effectiveAgent),
        messages,
        temperature: 0,
        maxTokens: Number(maxTokens || effectiveAgent.maxTokens || 0) || effectiveAgent.maxTokens,
        maxTokensCapOverride,
        purpose,
        timeoutMs: policy.modelCallTimeoutMs
      });

      if (!response.success) {
        const error = response?.error || response;
        console.error(
          "[AgentRun] provider error:",
          error?.raw?.response?.data || error?.raw?.response?.status || error?.message || error
        );
        throw new Error(response.error?.message || response.error?.type || "AI provider execution failed");
      }

      const text = response.normalizedText || response.text || "";
      if (DEBUG()) console.log("[AgentRun] provider OK outputLength=%d", text.length);
      return text;
    }
  });

  if (DEBUG()) {
    console.log("[AgentRun] runAgentLoop done status=%s success=%s qualityGate=%s",
      result.status, result.success, result.qualityGate?.passed ?? "N/A");
  }

  // Sanitize changed files to ensure they are inside the workspace root only
  let sanitizedChanged = Array.isArray(result.changedFiles) ? result.changedFiles : [];
  if (workspace?.rootPath) {
    const filtered = [];
    for (const f of sanitizedChanged) {
      try {
        await resolveWorkspacePathSafe(workspace.rootPath, f);
        filtered.push(f);
      } catch {
        // drop
      }
    }
    sanitizedChanged = filtered;
  }

  let sanitizedValidated = Array.isArray(result.validatedFiles) ? result.validatedFiles : [];
  if (workspace?.rootPath) {
    const filtered = [];
    for (const f of sanitizedValidated) {
      try {
        await resolveWorkspacePathSafe(workspace.rootPath, f);
        filtered.push(f);
      } catch {
        // drop
      }
    }
    sanitizedValidated = filtered;
  }

  let sanitizedVerifiedExisting = Array.isArray(result.verifiedExistingFiles) ? result.verifiedExistingFiles : [];
  if (workspace?.rootPath) {
    const filtered = [];
    for (const f of sanitizedVerifiedExisting) {
      try {
        await resolveWorkspacePathSafe(workspace.rootPath, f);
        filtered.push(f);
      } catch {
        // drop
      }
    }
    sanitizedVerifiedExisting = filtered;
  }

  let sanitizedPlannerReadFiles = Array.isArray(result.plannerReadFiles) ? result.plannerReadFiles : [];
  if (workspace?.rootPath) {
    const filtered = [];
    for (const f of sanitizedPlannerReadFiles) {
      try {
        await resolveWorkspacePathSafe(workspace.rootPath, f);
        filtered.push(f);
      } catch {
        // drop
      }
    }
    sanitizedPlannerReadFiles = filtered;
  }

  // Recompute diff summary strictly from sanitized files within workspace
  let sanitizedDiff = result.diffSummary || {};
  if (workspace?.rootPath) {
    sanitizedDiff = await getDiffSummary(workspace.rootPath, sanitizedChanged);
  }

  // Respect needs_continue status for timeouts/continuations
  const completionResult = deriveRunCompletionResult(result);
  const sanitizedResult = sanitizeRunPayload(result, { field: 'run.result' });
  run.status = result.status === "error"
    ? "error"
    : (result.status === "needs_continue"
      ? "needs_continue"
      : completionResult.finalStatus);
  run.outputText = String(sanitizedResult.final || "");
  run.stopReason = result.stopReason || run.stopReason || null;
  run.rawResponse = sanitizeRunPayload({
    success: result.success,
    error: result.error || null
  }, { field: 'run.rawResponse' });
  run.errorMessage = run.status !== "completed"
    ? result.error || "Agent implementation needs revision"
    : null;
  run.changedFiles = sanitizeRunPayload(sanitizedChanged, { field: 'run.changedFiles' }) || [];
  run.plannedFiles = sanitizeRunPayload(result.plannedFiles || result.runFileMetadata?.plannedFiles || [], { field: 'run.plannedFiles' }) || [];
  run.generatedFiles = sanitizeRunPayload(result.generatedFiles || result.runFileMetadata?.generatedFiles || [], { field: 'run.generatedFiles' }) || [];
  run.validationRejectedFiles = sanitizeRunPayload(result.validationRejectedFiles || result.runFileMetadata?.validationRejectedFiles || [], { field: 'run.validationRejectedFiles' }) || [];
  run.committedFiles = sanitizeRunPayload(result.committedFiles || result.runFileMetadata?.committedFiles || [], { field: 'run.committedFiles' }) || [];
  run.failedFiles = sanitizeRunPayload(result.failedFiles || result.runFileMetadata?.failedFiles || [], { field: 'run.failedFiles' }) || [];
  run.validatedFiles = sanitizeRunPayload(sanitizedValidated, { field: 'run.validatedFiles' }) || [];
  run.verifiedExistingFiles = sanitizeRunPayload(sanitizedVerifiedExisting, { field: 'run.verifiedExistingFiles' }) || [];
  run.plannerReadFiles = sanitizeRunPayload(sanitizedPlannerReadFiles, { field: 'run.plannerReadFiles' }) || [];
  run.toolCalls = sanitizeRunPayload(result.toolCalls || [], { field: 'run.toolCalls' }) || [];
  run.executionEvents = sanitizeRunPayload(result.events || [], { field: 'run.executionEvents' }) || [];
  run.diffSummary = sanitizeRunPayload(sanitizedDiff, { field: 'run.diffSummary' }) || {};
  run.plannerMetrics = sanitizeRunPayload(result.plannerMetrics || {}, { field: 'run.plannerMetrics' }) || {};
  run.plannerDebugSnapshot = sanitizeRunPayload(result.plannerDebugSnapshot || null, { field: 'run.plannerDebugSnapshot' }) || null;
  run.qualityGate = sanitizeRunPayload(result.qualityGate || {}, { field: 'run.qualityGate' }) || {};
  run.acceptanceCriteria = sanitizeRunPayload(result.acceptanceCriteria || {}, { field: 'run.acceptanceCriteria' }) || {};
  run.currentStep = result.history?.length || 0;
  run.currentTool = "";
  run.executionSummary = {
    changedFileCount: run.changedFiles.length,
    committedFileCount: run.committedFiles.length,
    generatedFileCount: run.generatedFiles.length,
    validationRejectedFileCount: run.validationRejectedFiles.length,
    validatedFileCount: run.validatedFiles.length,
    verifiedExistingFileCount: run.verifiedExistingFiles.length,
    plannerReadFileCount: run.plannerReadFiles.length,
    toolCallCount: run.toolCalls.length,
    eventCount: run.executionEvents.length,
    final: String(sanitizedResult.final || ""),
    qualityScore: result.qualityGate?.score || 0,
    plannedFiles: sanitizeRunPayload(result.plannedFiles || result.runFileMetadata?.plannedFiles || [], { field: 'run.executionSummary.plannedFiles' }) || [],
    generatedFiles: sanitizeRunPayload(result.generatedFiles || result.runFileMetadata?.generatedFiles || [], { field: 'run.executionSummary.generatedFiles' }) || [],
    validationRejectedFiles: sanitizeRunPayload(result.validationRejectedFiles || result.runFileMetadata?.validationRejectedFiles || [], { field: 'run.executionSummary.validationRejectedFiles' }) || [],
    committedFiles: sanitizeRunPayload(result.committedFiles || result.runFileMetadata?.committedFiles || [], { field: 'run.executionSummary.committedFiles' }) || [],
    failedFiles: sanitizeRunPayload(result.failedFiles || result.runFileMetadata?.failedFiles || [], { field: 'run.executionSummary.failedFiles' }) || [],
    originalPlannerTasks: sanitizeRunPayload(result.plannerDebugSnapshot?.originalPlannerTasks || null, { field: 'run.executionSummary.originalPlannerTasks' }) || [],
    originalTaskGraph: sanitizeRunPayload(result.plannerDebugSnapshot?.originalTaskGraph || null, { field: 'run.executionSummary.originalTaskGraph' }) || null,
    initialPlannerGraphSnapshot: sanitizeRunPayload(result.plannerDebugSnapshot?.initialPlannerGraphSnapshot || null, { field: 'run.executionSummary.initialPlannerGraphSnapshot' }) || null
  };
  if (isAutoMode && autoAttempts.length > 0) {
    run.autoFailover = { attempts: autoAttempts };
  }
  run.completedAt = new Date();
  await run.save();
  console.log('[RUN_COMPLETION]', {
    savedStatus: completionResult.savedStatus,
    savedSuccess: completionResult.savedSuccess
  });

  return {
    success: completionResult.savedSuccess,
    error: run.errorMessage,
    run
  };
}

function taskStatusForRun(run) {
  if (run.status === "completed") return "completed";
  if (run.status === "error") return "error";
  return "needs_revision";
}

export function deriveRunCompletionResult(result = {}) {
  const qualityGatePassed = result.qualityGate?.passed === true;
  const completionResult = result.completionResult || {
    plannerCompleted: result.status === "completed",
    validationPassed: qualityGatePassed,
    qualityGatePassed,
    finalStatus: qualityGatePassed ? "completed" : "needs_revision",
    success: result.status === "completed" && qualityGatePassed
  };
  return {
    ...completionResult,
    savedStatus: completionResult.finalStatus,
    savedSuccess: completionResult.success
  };
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
 * Get recent AgentRun records, optionally scoped to a task.
 * Read-only list view used by the planner debug UI.
 */
export async function getAgentRuns(req, res) {
  try {
    const { taskId } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const match = {};
    if (taskId) {
      match.taskId = mongoose.Types.ObjectId.isValid(taskId)
        ? new mongoose.Types.ObjectId(taskId)
        : taskId;
    }

    const runs = await AgentRun.aggregate([
      { $match: match },
      { $sort: { _id: -1 } },
      { $limit: limit },
      {
        $project: {
          _id: 1,
          taskId: 1,
          status: 1,
          createdAt: 1,
          updatedAt: 1,
          hasPlannerDebugSnapshot: {
            $cond: [{ $ifNull: ["$plannerDebugSnapshot", false] }, true, false]
          }
        }
      }
    ]).allowDiskUse(true);

    return res.json({
      success: true,
      data: runs.map(run => ({
        id: run._id?.toString?.() || String(run._id || ""),
        taskId: run.taskId?.toString?.() || String(run.taskId || ""),
        status: run.status || "pending",
        success: run.status === "completed",
        createdAt: run.createdAt || null,
        updatedAt: run.updatedAt || null,
        hasPlannerDebugSnapshot: !!run.hasPlannerDebugSnapshot
      }))
    });
  } catch (error) {
    console.error("getAgentRuns error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch agent runs",
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
            const sanitizedEvent = sanitizeRunPayload(event, { field: 'run.executionEvents' });
            const update = { $push: { executionEvents: sanitizedEvent }, $set: {} };
            if (sanitizedEvent.step !== undefined) update.$set.currentStep = sanitizedEvent.step;
            if (sanitizedEvent.tool) update.$set.currentTool = sanitizedEvent.tool;
            // Persist snapshots for UI between steps
            if (sanitizedEvent.type === "debug" && sanitizedEvent.section === "RUN_STATE") {
              if (Array.isArray(sanitizedEvent.filesRead)) update.$set.filesRead = sanitizedEvent.filesRead;
              if (Array.isArray(sanitizedEvent.filesChanged)) update.$set.changedFiles = sanitizedEvent.filesChanged;
              update.$set.patchesApplied = sanitizedEvent.patchesApplied ?? undefined;
              update.$set.terminalCommands = sanitizedEvent.terminalCommands ?? undefined;
              update.$set.outputText = sanitizedEvent.finalTextPreview ? String(sanitizedEvent.finalTextPreview) : undefined;
            }
            if (sanitizedEvent.type === "debug" && sanitizedEvent.section === "MODEL_RAW_RESPONSE" && sanitizedEvent.preview) {
              update.$set.lastModelResponsePreview = sanitizedEvent.preview;
            }
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

    if (!["needs_revision", "error", "needs_continue"].includes(run.status)) {
      return res.status(400).json({
        success: false,
        message: "Only failed, needs_revision, or needs_continue runs can be continued"
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
    const { runId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(runId)) {
      return res.status(400).json({ success: false, error: "Invalid runId" });
    }

    const run = await AgentRun.findById(runId)
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

    const writeOrPatch = (call) => call && call.success !== false && (call.tool === "WRITE_FILE" || call.tool === "APPLY_PATCH");
    const derivedChanged = [...new Set(
      toolCalls
        .filter(writeOrPatch)
        .map(call => call.result?.file || call.args?.file || call.args?.path)
        .filter(Boolean)
    )];
    const filesChanged = (Array.isArray(run.changedFiles) && run.changedFiles.length) ? run.changedFiles : derivedChanged;
    const committedFiles = (Array.isArray(run.committedFiles) && run.committedFiles.length) ? run.committedFiles : filesChanged;
    const patchesApplied = committedFiles
      .map(file => ({
        file,
        ok: true,
        blocked: false,
        blockedByPolicy: false,
        reason: null,
        tool: "WRITE_FILE",
        committed: true
      }))
      .filter(item => !!item.file);
    const validationRejectedFiles = Array.isArray(run.validationRejectedFiles) ? run.validationRejectedFiles : [];
    const generatedFiles = Array.isArray(run.generatedFiles) ? run.generatedFiles : [];
    const failedFiles = Array.isArray(run.failedFiles) ? run.failedFiles : [];
    const plannedFiles = Array.isArray(run.plannedFiles) ? run.plannedFiles : [];
    // Blocked tool attempts (including blocked write/patch) for separate UI rendering
    const blockedTools = toolCalls
      .filter(call => call?.result?.blocked === true)
      .map(call => {
        const file = call.result?.file || call.args?.file || call.args?.path || null;
        const reason = call.result?.reason || call.result?.error || "Blocked";
        const intentMode = call.result?.intentMode || null;
        const forbiddenTool = call.result?.forbiddenTool || call.tool;
        const args = call.args ? JSON.stringify(call.args) : null;
        try {
          console.log("[PATCH_UI_SOURCE]", { source: "api_get_run:blockedTools", file, iteration: (call.step ?? null) });
        } catch {}
        return { tool: call.tool, file, args, reason, intentMode, forbiddenTool };
      });
    const terminalCommands = toolCalls
      .filter(call => call.tool === "RUN_TERMINAL" && !call?.result?.blocked)
      .map(call => ({ command: call.args?.command || "", ok: call.success !== false }));

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
        maxSteps: run.maxSteps || null,
        startedAt: run.startedAt || null,
        completedAt: run.completedAt || null,
        stopReason: run.stopReason || null,
        filesRead,
        changedFiles: filesChanged,
        filesChanged, // alias for frontend convenience
        patchesApplied,
        plannedFiles,
        generatedFiles,
        validationRejectedFiles,
        committedFiles,
        failedFiles,
        terminalCommands,
        toolCalls,
        executionEvents,
        plannerMetrics: run.plannerMetrics || {},
        plannerDebugSnapshot: run.plannerDebugSnapshot || null,
        errors,
        qualityGate: run.qualityGate || {},
        outputText: run.outputText || "",
        diffSummary: run.diffSummary || {},
        autoFailover: run.autoFailover || null,
        patchesApplied,
        blockedTools
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
