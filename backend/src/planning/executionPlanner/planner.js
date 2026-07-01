import crypto from "node:crypto";
import { detectWorkspaceState } from "../../agent/projectIntelligence/index.js";
import { buildTaskGraph, resolveTaskOrder } from "./taskGraph.js";
import { validateExecutionPlan } from "./validator.js";
import { planValidationCommands } from "./validationPlanner.js";
import { analyzeRisk } from "./riskAnalyzer.js";
import { guardScope, buildFinalizationRules, canFinalizeExecution } from "./finalizationGuard.js";
import { planRetry, summarizeRetryPlan } from "./retryPlanner.js";
import { buildExecutionTasks } from "./taskBuilder.js";
import { resolveExecutionDependencies } from "./dependencyResolver.js";
import { serializeExecutionPlan, loadExecutionPlan } from "./serializer.js";
import { EXECUTION_LOG_EVENTS, EXECUTION_PLAN_VERSION } from "./types.js";
import { unique, toPosix } from "./utils.js";

function logEvent(eventName, payload = {}) {
  console.log(`[${eventName}]`, payload);
}

function normalizePlanTask(task = {}) {
  return {
    ...task,
    dependsOn: unique((Array.isArray(task.dependsOn) ? task.dependsOn : []).map(value => String(value || "").trim()).filter(Boolean))
  };
}

function collectSummary(plan = {}, validationPlan = {}, risk = {}, workspaceState = {}) {
  const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
  const statusCounts = {};
  for (const task of tasks) {
    const status = String(task.status || "PENDING").toUpperCase();
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }
  const criticalTasks = tasks.filter(task => task.critical !== false && task.tool !== "FINAL");
  const writeTargets = tasks
    .filter(task => ["WRITE_FILE", "APPLY_PATCH"].includes(task.tool))
    .map(task => toPosix(task.toolArgs?.path || task.toolArgs?.file || task.toolArgs?.target || ""));

  return {
    taskCount: tasks.length,
    criticalTaskCount: criticalTasks.length,
    implementationTaskCount: tasks.filter(task => ["WRITE_FILE", "APPLY_PATCH"].includes(task.tool)).length,
    readTaskCount: tasks.filter(task => task.tool === "READ_FILE").length,
    validationTaskCount: tasks.filter(task => task.tool === "RUN_TERMINAL" || task.tool === "VALIDATE").length,
    statusCounts,
    targetFiles: unique(writeTargets.filter(Boolean)),
    workspaceRoot: workspaceState?.workspaceRoot || "",
    validationStrategy: validationPlan.strategy || "file-existence",
    riskLevel: risk.riskLevel || "unknown"
  };
}

export async function buildExecutionPlan(input = {}) {
  const workspaceRoot = String(input.workspaceRoot || input.workspaceState?.workspaceRoot || "").trim();
  logEvent(EXECUTION_LOG_EVENTS.START, { workspaceRoot: workspaceRoot || null });

  const workspaceState = input.workspaceState || (workspaceRoot ? await detectWorkspaceState(workspaceRoot).catch(() => null) : null) || {};
  let validationPlan = planValidationCommands({
    prompt: String(input.prompt || input.objective || ""),
    blueprint: input.blueprint || input.featureBlueprint || null,
    workspaceState,
    tasks: [],
    knowledgeGraph: input.knowledgeGraph || null,
    impactAnalysis: input.impactAnalysis || null,
    existingPlannerState: input.existingPlannerState || null,
    toolAvailability: input.toolAvailability || workspaceState.toolAvailability || {}
  });

  let taskBuild = buildExecutionTasks({
    ...input,
    workspaceState,
    validationPlan
  });

  if (validationPlan.commands.length === 0 && validationPlan.checks.length === 0) {
    validationPlan = planValidationCommands({
      prompt: String(input.prompt || input.objective || ""),
      blueprint: input.blueprint || input.featureBlueprint || null,
      workspaceState,
      tasks: taskBuild.tasks,
      knowledgeGraph: input.knowledgeGraph || null,
      impactAnalysis: input.impactAnalysis || null,
      existingPlannerState: input.existingPlannerState || null,
      toolAvailability: input.toolAvailability || workspaceState.toolAvailability || {}
    });
    taskBuild = buildExecutionTasks({
      ...input,
      workspaceState,
      validationPlan
    });
  }

  const normalizedTasks = taskBuild.tasks.map(normalizePlanTask);
  const graph = buildTaskGraph(normalizedTasks);
  const validation = validateExecutionPlan({ tasks: graph.nodes });
  logEvent(EXECUTION_LOG_EVENTS.DAG_VALIDATED, { valid: validation.valid, errorCount: validation.errors.length });
  if (!validation.valid) {
    console.log("[EXECUTION_DAG_VALIDATION_ERRORS]", validation.errors);
  }

  const risk = analyzeRisk({
    tasks: graph.nodes,
    blueprint: input.blueprint || input.featureBlueprint || null,
    dependencyGraph: input.dependencyGraph || null,
    impactAnalysis: input.impactAnalysis || null,
    knowledgeGraph: input.knowledgeGraph || null,
    workspaceState
  });
  logEvent(EXECUTION_LOG_EVENTS.RISK_ANALYZED, { riskLevel: risk.riskLevel, reasons: risk.reasons, confidence: risk.confidence });

  const scopedPlan = guardScope({
    ...input,
    workspaceState,
    tasks: graph.nodes,
    validation: validationPlan
  }, {
    allowedPaths: [
      ...(Array.isArray(taskBuild.allowedPaths) ? taskBuild.allowedPaths : []),
      ...(Array.isArray(input.scope?.allowedPaths) ? input.scope.allowedPaths : [])
    ],
    evidencePaths: [
      ...(Array.isArray(input.scope?.evidencePaths) ? input.scope.evidencePaths : []),
      ...(Array.isArray(taskBuild.evidence) ? taskBuild.evidence.map(item => item.path || item.targetPath || item.file || item.name || "") : [])
    ]
  });
  logEvent(EXECUTION_LOG_EVENTS.SCOPE_GUARD_APPLIED, { blockedCount: Array.isArray(scopedPlan.blockedTasks) ? scopedPlan.blockedTasks.length : 0 });

  const dependencyResolved = resolveExecutionDependencies(scopedPlan.tasks, { workspaceState });

  const retryPlans = [];
  for (const failure of Array.isArray(input.failureMemory) ? input.failureMemory : (input.failureMemory ? [input.failureMemory] : [])) {
    const retryPlan = planRetry({
      failure,
      plan: scopedPlan,
      workspaceState,
      scope: input.scope || {}
    });
    if (retryPlan.tasks.length > 0) {
      retryPlans.push(retryPlan);
    }
  }
  if (retryPlans.length > 0) {
    logEvent(EXECUTION_LOG_EVENTS.RETRY_PLANNED, { retryCount: retryPlans.length });
  }

  const allTasks = unique([
    ...dependencyResolved.tasks,
    ...retryPlans.flatMap(plan => plan.tasks)
  ].map(task => JSON.stringify(task))).map(text => JSON.parse(text)).map(normalizePlanTask);
  const orderedTasks = resolveTaskOrder(allTasks);
  const orderedGraph = buildTaskGraph(orderedTasks);
  const guardedOrderedPlan = guardScope({
    ...input,
    workspaceState,
    tasks: orderedGraph.nodes,
    validation: validationPlan
  }, {
    allowedPaths: [
      ...(Array.isArray(taskBuild.allowedPaths) ? taskBuild.allowedPaths : []),
      ...(Array.isArray(input.scope?.allowedPaths) ? input.scope.allowedPaths : [])
    ],
    evidencePaths: [
      ...(Array.isArray(input.scope?.evidencePaths) ? input.scope.evidencePaths : []),
      ...(Array.isArray(taskBuild.evidence) ? taskBuild.evidence.map(item => item.path || item.targetPath || item.file || item.name || "") : [])
    ]
  });
  const finalRules = buildFinalizationRules({ tasks: orderedGraph.nodes, validation: validationPlan });
  const validationEntries = guardedOrderedPlan.tasks
    .filter(task => task.tool === "RUN_TERMINAL" || task.tool === "VALIDATE")
    .map(task => ({
      taskId: task.id,
      type: task.tool === "RUN_TERMINAL" ? "command" : "check",
      required: task.validation?.required !== false,
      command: task.tool === "RUN_TERMINAL" ? String(task.toolArgs?.command || "").trim() : null,
      check: task.tool === "VALIDATE" ? task.toolArgs || null : null
    }));
  const finalization = canFinalizeExecution({ tasks: guardedOrderedPlan.tasks, validation: validationEntries });
  if (!finalization.canFinalize) {
    logEvent(EXECUTION_LOG_EVENTS.FINALIZATION_BLOCKED, {
      unfinishedTaskIds: finalization.unfinished.map(task => task.id),
      finalTaskId: finalization.finalTask?.id || null
    });
  }
  const summary = collectSummary({ tasks: guardedOrderedPlan.tasks }, validationPlan, risk, workspaceState);
  const confidence = {
    overall: Math.min(0.95, Math.max(0.5, risk.confidence || 0.5)),
    evidence: taskBuild.evidence.length > 0 ? 0.9 : 0.6,
    validation: validationPlan.commands.length > 0 || validationPlan.checks.length > 0 ? 0.85 : 0.55
  };

  const plan = {
    version: EXECUTION_PLAN_VERSION,
    planId: input.planId || `execution-plan:${crypto.randomUUID()}`,
    workspaceId: workspaceRoot || input.workspaceId || "",
    prompt: String(input.prompt || input.objective || ""),
    tasks: guardedOrderedPlan.tasks,
    dependencies: orderedGraph.edges,
    validation: [
      ...validationEntries,
      ...validationPlan.skipped.map(check => ({ type: "skipped", ...check }))
    ],
    finalizationRules: finalRules,
    riskLevel: risk.riskLevel || "unknown",
    summary,
    confidence,
    validationPlan,
    scope: scopedPlan.scope || input.scope || {},
    blockedTasks: scopedPlan.blockedTasks || []
  };

  const structuralValidation = validateExecutionPlan(plan);
  plan.validationResult = structuralValidation;
  plan.summary.validationValid = structuralValidation.valid;
  plan.summary.finalizable = finalization.canFinalize;
  plan.summary.retryCount = retryPlans.length;

  if (input.persist !== false && plan.workspaceId) {
    await serializeExecutionPlan(plan, { workspaceId: plan.workspaceId }).catch(() => null);
    logEvent(EXECUTION_LOG_EVENTS.PLAN_SERIALIZED, { workspaceId: plan.workspaceId, planId: plan.planId });
  }

  logEvent(EXECUTION_LOG_EVENTS.PLAN_COMPLETE, {
    planId: plan.planId,
    taskCount: plan.tasks.length,
    riskLevel: plan.riskLevel
  });

  return plan;
}

export { buildTaskGraph, resolveTaskOrder } from "./taskGraph.js";
export { validateTaskGraph, validateExecutionPlan } from "./validator.js";
export { planValidationCommands } from "./validationPlanner.js";
export { analyzeRisk } from "./riskAnalyzer.js";
export { guardScope, canFinalizeExecution, buildFinalizationRules } from "./finalizationGuard.js";
export { planRetry } from "./retryPlanner.js";
export { serializeExecutionPlan, loadExecutionPlan } from "./serializer.js";
export { updateTaskStatus } from "./taskGraph.js";
export { summarizeExecutionPlan } from "./summary.js";
