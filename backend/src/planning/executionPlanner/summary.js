import { hasTerminalStatus, unique } from "./utils.js";

export function summarizeExecutionPlan(plan = {}) {
  const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
  const summary = {
    taskCount: tasks.length,
    completedCount: tasks.filter(task => hasTerminalStatus(task.status)).length,
    pendingCount: tasks.filter(task => String(task.status || "").toUpperCase() === "PENDING").length,
    readyCount: tasks.filter(task => String(task.status || "").toUpperCase() === "READY").length,
    runningCount: tasks.filter(task => String(task.status || "").toUpperCase() === "RUNNING").length,
    blockedCount: tasks.filter(task => String(task.status || "").toUpperCase() === "BLOCKED").length,
    failedCount: tasks.filter(task => String(task.status || "").toUpperCase() === "FAILED").length,
    skippedCount: tasks.filter(task => String(task.status || "").toUpperCase() === "SKIPPED").length,
    criticalCount: tasks.filter(task => task.critical !== false && task.tool !== "FINAL").length,
    validationCount: tasks.filter(task => task.tool === "RUN_TERMINAL" || task.tool === "VALIDATE").length,
    targetFiles: unique(tasks.map(task => String(task.toolArgs?.path || task.toolArgs?.file || task.toolArgs?.target || "").trim()).filter(Boolean))
  };
  summary.complete = summary.failedCount === 0 && summary.blockedCount === 0 && summary.pendingCount === 0 && summary.readyCount === 0 && summary.runningCount === 0;
  return summary;
}
