import { hasTerminalStatus, unique } from "./utils.js";

export function guardScope(plan = {}, scope = {}) {
  const allowed = new Set(unique([
    ...(Array.isArray(scope.allowedPaths) ? scope.allowedPaths : []),
    ...(Array.isArray(scope.evidencePaths) ? scope.evidencePaths : []),
    ...(Array.isArray(plan.summary?.targetFiles) ? plan.summary.targetFiles : [])
  ].map(value => String(value || "").replace(/\\/g, "/").trim().toLowerCase()).filter(Boolean)));
  const blocked = [];

  const matchesAllowedPrefix = value => {
    const normalized = String(value || "").replace(/\\/g, "/").trim().toLowerCase();
    if (!normalized) return true;
    if (normalized === "." || normalized === "./") return true;
    if (allowed.has(normalized)) return true;
    for (const candidate of allowed) {
      if (candidate.endsWith("/")) {
        if (normalized.startsWith(candidate)) return true;
      } else if (normalized.startsWith(`${candidate}/`)) {
        return true;
      }
    }
    return false;
  };

  for (const task of Array.isArray(plan.tasks) ? plan.tasks : []) {
    const target = String(task?.toolArgs?.path || task?.toolArgs?.file || task?.toolArgs?.target || "").trim();
    if (!target) continue;
    if (["LIST_FILES", "SEARCH_FILES", "VALIDATE", "FINAL"].includes(task.tool)) continue;
    if (!matchesAllowedPrefix(target)) {
      task.status = "BLOCKED";
      task.scopeBlocked = true;
      task.reason = task.reason || "out of scope";
      blocked.push({ id: task.id, path: target, kind: task.kind, tool: task.tool, status: task.status, dependencies: unique(task.dependsOn || []) });
    }
  }

  if (blocked.length > 0) {
    console.log("[EXECUTION_SCOPE_GUARD_APPLIED]", { blockedCount: blocked.length, blocked });
  } else {
    console.log("[EXECUTION_SCOPE_GUARD_APPLIED]", { blockedCount: 0 });
  }

  return {
    ...plan,
    blockedTasks: blocked,
    scope
  };
}

export function canFinalizeExecution(plan = {}) {
  const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
  const criticalTasks = tasks.filter(task => task?.critical !== false && task?.tool !== "FINAL" && task?.kind !== "finalize");
  const finalTask = tasks.find(task => task?.tool === "FINAL" || String(task?.kind || "").toLowerCase() === "finalize");
  const unfinished = criticalTasks.filter(task => !hasTerminalStatus(task.status));
  const validationPending = (Array.isArray(plan.validation) ? plan.validation : []).some(entry => entry?.required !== false && entry?.taskId ? !hasTerminalStatus(tasks.find(task => task.id === entry.taskId)?.status) : false);

  return {
    canFinalize: unfinished.length === 0 && !validationPending && (!finalTask || hasTerminalStatus(finalTask.status) || finalTask.status === "READY" || finalTask.status === "PENDING"),
    unfinished,
    finalTask
  };
}

export function buildFinalizationRules(plan = {}) {
  const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
  const validationTasks = tasks.filter(task => task.tool === "VALIDATE" || task.tool === "RUN_TERMINAL");
  return [
    { type: "all-critical-terminal", requiredStatuses: ["DONE", "SKIPPED"], appliesTo: "critical_tasks" },
    ...(validationTasks.length > 0 ? [{ type: "validation-evidence-required", taskIds: validationTasks.map(task => task.id) }] : []),
    { type: "no-finalization-on-unfinished-graph", required: true }
  ];
}
