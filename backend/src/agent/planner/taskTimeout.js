export const TIMEOUT_DEFAULTS = {
  READ_FILE: 30000,
  WRITE_FILE: 60000,
  APPLY_PATCH: 60000,
  CREATE_FILE: 60000,
  DELETE_FILE: 60000,
  RUN_TERMINAL: 120000,
  VALIDATE_PATCH: 30000,
  FINAL: 30000,
  RECOVERY: 90000,
  LIST_FILES: 30000,
  SEARCH_CODE: 30000,
  SEARCH_SYMBOL: 30000
};

export const DEFAULT_TIMEOUT_MS = 90000;

export const MAX_ATTEMPTS = {
  READ_FILE: 2,
  WRITE_FILE: 3,
  APPLY_PATCH: 3,
  CREATE_FILE: 3,
  DELETE_FILE: 3,
  RUN_TERMINAL: 2,
  RECOVERY: 3,
  LIST_FILES: 2,
  SEARCH_CODE: 2,
  SEARCH_SYMBOL: 2
};

export const DEFAULT_MAX_ATTEMPTS = 4;

export function getTaskTimeoutMs(task) {
  if (task.timeoutMs != null) return task.timeoutMs;
  if (task.kind === 'RECOVERY') return TIMEOUT_DEFAULTS.RECOVERY;
  const tool = task.tool;
  if (!tool) return DEFAULT_TIMEOUT_MS;
  const upper = tool.toUpperCase();
  if (TIMEOUT_DEFAULTS[upper] !== undefined) return TIMEOUT_DEFAULTS[upper];
  return DEFAULT_TIMEOUT_MS;
}

export function getMaxAttempts(task) {
  if (task.maxAttempts != null) return task.maxAttempts;
  if (task.kind === 'RECOVERY') return MAX_ATTEMPTS.RECOVERY;
  const tool = task.tool;
  if (!tool) return DEFAULT_MAX_ATTEMPTS;
  const upper = tool.toUpperCase();
  if (MAX_ATTEMPTS[upper] !== undefined) return MAX_ATTEMPTS[upper];
  return DEFAULT_MAX_ATTEMPTS;
}

export function markTaskProgress(taskState, reason) {
  const now = Date.now();
  if (!taskState.startedAt) taskState.startedAt = now;
  taskState.lastProgressAt = now;
  taskState.attempts = (taskState.attempts || 0) + 1;
  if (reason) taskState.statusReason = reason;
}

export function markTaskStall(taskState, reason) {
  const now = Date.now();
  if (!taskState.startedAt) taskState.startedAt = now;
  taskState.stallCount = (taskState.stallCount || 0) + 1;
  taskState.lastProgressAt = now;
  taskState.attempts = (taskState.attempts || 0) + 1;
  if (reason) taskState.statusReason = reason;
}

export function shouldStallTask(taskState, now) {
  const attempts = taskState.attempts || 0;
  const maxAttempts = taskState.maxAttempts || DEFAULT_MAX_ATTEMPTS;
  if (attempts >= maxAttempts) return { stalled: true, reason: 'attempt_limit' };
  if (taskState.startedAt) {
    const timeoutMs = taskState.timeoutMs || DEFAULT_TIMEOUT_MS;
    const elapsed = now - taskState.startedAt;
    if (elapsed >= timeoutMs) return { stalled: true, reason: 'timeout', elapsed, timeoutMs };
  }
  return { stalled: false };
}

/**
 * Check if a task has exceeded its wall-clock timeout.
 * Returns { timedOut: true, elapsed, timeoutMs } if timed out,
 * else { timedOut: false }.
 */
export function checkTaskTimeout(task) {
  const startedAt = task.startedAt;
  if (!startedAt) return { timedOut: false };
  const timeoutMs = task.timeoutMs || DEFAULT_TIMEOUT_MS;
  const now = Date.now();
  const elapsed = now - startedAt;
  if (elapsed >= timeoutMs) {
    return { timedOut: true, elapsed, timeoutMs };
  }
  return { timedOut: false };
}

export function buildTaskTimeoutReason(taskState) {
  const parts = [];
  if (taskState.statusReason) parts.push(taskState.statusReason);
  const attempts = taskState.attempts || 0;
  const maxAttempts = taskState.maxAttempts || DEFAULT_MAX_ATTEMPTS;
  const stallCount = taskState.stallCount || 0;
  parts.push(`attempts=${attempts}/${maxAttempts}`);
  if (stallCount > 0) parts.push(`stalls=${stallCount}`);
  if (taskState.startedAt) {
    const elapsed = Date.now() - taskState.startedAt;
    const timeoutMs = taskState.timeoutMs || DEFAULT_TIMEOUT_MS;
    parts.push(`elapsed=${elapsed}ms/timeout=${timeoutMs}ms`);
  }
  return parts.join(' ');
}
