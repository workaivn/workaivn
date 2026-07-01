import { classifyFailure } from "./repairKnowledge.js";
import { unique, scoreToConfidence } from "./utils.js";
import { EXECUTION_TASK_KIND, EXECUTION_TASK_STATUS } from "./types.js";

function createTask(id, kind, tool, toolArgs, reason, dependsOn, source, evidence, confidence) {
  return {
    id,
    kind,
    tool,
    toolArgs: toolArgs || {},
    reason,
    dependsOn: unique(dependsOn || []),
    expectedOutput: {},
    validation: {},
    retryPolicy: { maxAttempts: 2, backoff: "deterministic" },
    status: EXECUTION_TASK_STATUS.PENDING,
    priority: 75,
    risk: "medium",
    source,
    evidence,
    confidence,
    critical: true
  };
}

export function planRetry({ failure = {}, plan = {}, workspaceState = {}, scope = {} } = {}) {
  const classification = classifyFailure(failure);
  const targetPath = String(failure.path || failure.file || failure.targetPath || "").trim();
  const validationTaskIds = (Array.isArray(plan.tasks) ? plan.tasks : []).filter(task => task.tool === "RUN_TERMINAL" || task.tool === "VALIDATE").map(task => task.id);
  const readTaskId = targetPath ? `retry:read:${targetPath}` : "retry:read:package.json";
  const repairTaskId = targetPath ? `retry:repair:${targetPath}` : `retry:repair:${classification.repairType}`;
  const tasks = [];

  if (classification.tool === "VALIDATE" && classification.args?.skipped) {
    tasks.push(createTask(
      repairTaskId,
      EXECUTION_TASK_KIND.RECOVER,
      "VALIDATE",
      classification.args,
      classification.reason,
      validationTaskIds,
      "failure-memory",
      [{ type: "failure", value: failure }],
      classification.confidence
    ));
    return { classification, tasks, scope };
  }

  if (targetPath || classification.action === "patch_package_json") {
    tasks.push(createTask(
      readTaskId,
      EXECUTION_TASK_KIND.RECOVER,
      "READ_FILE",
      { path: targetPath || "package.json" },
      `Read failed target before retrying ${classification.repairType}`,
      [],
      "failure-memory",
      [{ type: "failure", value: failure }],
      scoreToConfidence(classification.confidence)
    ));
  }

  const patchTool = classification.tool === "RUN_TERMINAL" ? "RUN_TERMINAL" : classification.tool;
  tasks.push(createTask(
    repairTaskId,
    EXECUTION_TASK_KIND.RECOVER,
    patchTool,
    classification.args,
    classification.reason,
    targetPath ? [readTaskId] : [],
    "repair-knowledge",
    [{ type: "failure", value: failure }, { type: "classification", value: classification }],
    classification.confidence
  ));

  const retryCommand = String(classification.retryCommand || failure.retryCommand || "").trim();
  if (retryCommand) {
    tasks.push(createTask(
      `retry:validate:${retryCommand}`,
      EXECUTION_TASK_KIND.VALIDATE,
      "RUN_TERMINAL",
      { command: retryCommand },
      `Retry validation: ${retryCommand}`,
      [repairTaskId],
      "retry-validation",
      [{ type: "retryCommand", value: retryCommand }],
      0.8
    ));
  }

  return { classification, tasks, scope };
}

export function summarizeRetryPlan(plan = {}) {
  return {
    retryCount: Array.isArray(plan.tasks) ? plan.tasks.length : 0,
    repairTypes: unique((Array.isArray(plan.tasks) ? plan.tasks : []).map(task => String(task.reason || "").toLowerCase()).filter(Boolean))
  };
}
