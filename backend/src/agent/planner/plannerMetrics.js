import { matchValidationCommand } from "../validationCommandMatcher.js";

const SUCCESS_STATES = new Set(["SUCCESS", "RECOVERED", "SKIPPED"]);
const FAILED_STATES = new Set(["FAILED", "RECOVERY_FAILED"]);

function extractTaskPath(taskLike) {
  if (!taskLike || typeof taskLike !== "object") return null;
  const args = taskLike.toolArgs || taskLike.args || {};
  const result = taskLike.result || {};
  return args.path || args.file || args.target || result.file || null;
}

function recomputeTaskCounters(metrics) {
  const states = Object.values(metrics._taskStateById);
  const kinds = Object.values(metrics._taskKindById);
  metrics.plannerTasksTotal = Object.keys(metrics._taskStateById).length;
  metrics.plannerTasksReady = states.filter((state) => state === "READY").length;
  metrics.plannerTasksRunning = states.filter((state) => state === "RUNNING").length;
  metrics.plannerTasksCompleted = states.filter((state) => SUCCESS_STATES.has(state)).length;
  metrics.plannerTasksFailed = states.filter((state) => FAILED_STATES.has(state)).length;
  metrics.plannerRecoveryTasks = kinds.filter((kind) => kind === "RECOVERY").length;
}

function setTaskTracking(metrics, task, nextState = null) {
  if (!task?.id) return;
  metrics._taskKindById[task.id] = String(task.kind || metrics._taskKindById[task.id] || "CODING").toUpperCase();
  if (nextState) {
    metrics._taskStateById[task.id] = String(nextState).toUpperCase();
  } else if (task.status) {
    metrics._taskStateById[task.id] = String(task.status).toUpperCase();
  } else if (!metrics._taskStateById[task.id]) {
    metrics._taskStateById[task.id] = "PENDING";
  }
}

export function createPlannerMetrics() {
  return {
    plannerTasksTotal: 0,
    plannerTasksReady: 0,
    plannerTasksRunning: 0,
    plannerTasksCompleted: 0,
    plannerTasksFailed: 0,
    plannerRecoveryTasks: 0,
    plannerRetries: 0,
    plannerLoopCount: 0,
    plannerStuckCount: 0,
    validationCommandsRun: 0,
    validationCommandsPassed: 0,
    validationCommandsFailed: 0,
    finalizerStatus: null,
    lastPlannerTaskType: null,
    lastPlannerTaskTool: null,
    lastPlannerTaskPath: null,
    lastValidationCommand: null,
    lastValidationExitCode: null,
    _taskStateById: {},
    _taskKindById: {},
    _taskAttemptsById: {}
  };
}

export function syncPlannerMetricsFromPlanner(metrics, planner) {
  if (!metrics || !planner?.graph?.allNodes) return metrics;
  const nodes = planner.graph.allNodes();
  metrics._taskStateById = {};
  metrics._taskKindById = {};
  for (const task of nodes) {
    setTaskTracking(metrics, task, task.status || "PENDING");
    const attempts = Number(task?.attempts || 0);
    const prevAttempts = Number(metrics._taskAttemptsById[task.id] || 0);
    if (attempts > prevAttempts) {
      metrics._taskAttemptsById[task.id] = attempts;
    }
  }
  recomputeTaskCounters(metrics);
  return metrics;
}

export function updatePlannerMetricsFromTask(metrics, task, result = {}) {
  if (!metrics) return metrics;
  const event = String(result?.event || "").toLowerCase();

  if (event === "loop") {
    metrics.plannerLoopCount += 1;
    return metrics;
  }

  if (!task) return metrics;

  const normalizedKind = String(task.kind || result.kind || "").toUpperCase() || null;
  const normalizedTool = String(task.tool || result.tool || "").toUpperCase() || null;
  const normalizedPath = extractTaskPath({ ...task, ...result });
  if (normalizedKind) metrics.lastPlannerTaskType = normalizedKind;
  if (normalizedTool) metrics.lastPlannerTaskTool = normalizedTool;
  if (normalizedPath) metrics.lastPlannerTaskPath = normalizedPath;

  let nextState = task.status || null;
  if (event === "created") nextState = task.status || "PENDING";
  if (event === "selected") nextState = task.status || metrics._taskStateById[task.id] || "READY";
  if (event === "started") nextState = "RUNNING";
  if (event === "completed") nextState = task.status || "SUCCESS";
  if (event === "failed") nextState = task.status || "FAILED";
  if (event === "stuck") {
    metrics.plannerStuckCount += 1;
    nextState = task.status || metrics._taskStateById[task.id] || "READY";
  }

  setTaskTracking(metrics, { ...task, kind: normalizedKind }, nextState);
  const attempts = Number(result?.attempts ?? task?.attempts ?? 0);
  const prevAttempts = Number(metrics._taskAttemptsById[task.id] || 0);
  if (attempts > prevAttempts) {
    metrics.plannerRetries += Math.max(0, attempts - 1) - Math.max(0, prevAttempts - 1);
    metrics._taskAttemptsById[task.id] = attempts;
  }
  recomputeTaskCounters(metrics);
  return metrics;
}

export function updatePlannerMetricsFromToolCall(metrics, toolCall, options = {}) {
  if (!metrics || !toolCall || String(toolCall.tool || "").toUpperCase() !== "RUN_TERMINAL") {
    return metrics;
  }
  const command = String(toolCall.args?.command || toolCall.result?.command || "").trim();
  const validationSummary = matchValidationCommand({
    requiredCommands: Array.isArray(options.requiredCommands) ? options.requiredCommands : [],
    terminalCommands: [toolCall]
  });
  const isValidation = options.isValidation === true || validationSummary.validationRan;
  if (!isValidation) return metrics;

  const exitCode = toolCall.result?.exitCode ?? null;
  const success = toolCall.success === true && (exitCode === 0 || exitCode === null);
  metrics.validationCommandsRun += 1;
  metrics.lastValidationCommand = command || null;
  metrics.lastValidationExitCode = exitCode;
  if (success) {
    metrics.validationCommandsPassed += 1;
  } else {
    metrics.validationCommandsFailed += 1;
  }
  return metrics;
}

export function summarizePlannerMetrics(metrics) {
  const summary = {
    plannerTasksTotal: Number(metrics?.plannerTasksTotal || 0),
    plannerTasksReady: Number(metrics?.plannerTasksReady || 0),
    plannerTasksRunning: Number(metrics?.plannerTasksRunning || 0),
    plannerTasksCompleted: Number(metrics?.plannerTasksCompleted || 0),
    plannerTasksFailed: Number(metrics?.plannerTasksFailed || 0),
    plannerRecoveryTasks: Number(metrics?.plannerRecoveryTasks || 0),
    plannerRetries: Number(metrics?.plannerRetries || 0),
    plannerLoopCount: Number(metrics?.plannerLoopCount || 0),
    plannerStuckCount: Number(metrics?.plannerStuckCount || 0),
    validationCommandsRun: Number(metrics?.validationCommandsRun || 0),
    validationCommandsPassed: Number(metrics?.validationCommandsPassed || 0),
    validationCommandsFailed: Number(metrics?.validationCommandsFailed || 0),
    finalizerStatus: metrics?.finalizerStatus || null,
    lastPlannerTaskType: metrics?.lastPlannerTaskType || null,
    lastPlannerTaskTool: metrics?.lastPlannerTaskTool || null,
    lastPlannerTaskPath: metrics?.lastPlannerTaskPath || null,
    lastValidationCommand: metrics?.lastValidationCommand || null,
    lastValidationExitCode: metrics?.lastValidationExitCode ?? null
  };
  return JSON.parse(JSON.stringify(summary));
}
