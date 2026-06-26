const PRIORITY_MAP = {
  RUN_TERMINAL: 100,
  VALIDATE_PATCH: 100,
  WRITE_FILE: 80,
  APPLY_PATCH: 80,
  CREATE_FILE: 80,
  DELETE_FILE: 80,
  FINAL: 10
};

const DEFAULT_PRIORITY = 50;
const READ_FILE_NEEDED_PRIORITY = 60;
const READ_FILE_PRIORITY = 40;

export function getTaskPriority(task) {
  if (task.priority != null) {
    return task.priority;
  }
  const tool = task.tool;
  if (!tool) return DEFAULT_PRIORITY;
  const upper = tool.toUpperCase();
  if (PRIORITY_MAP[upper] !== undefined) return PRIORITY_MAP[upper];
  if (upper === 'READ_FILE') {
    const hasDownstream = task.children && task.children.size > 0;
    return hasDownstream ? READ_FILE_NEEDED_PRIORITY : READ_FILE_PRIORITY;
  }
  return DEFAULT_PRIORITY;
}

export function sortReadyTasksByPriority(tasks) {
  const withIndex = tasks.map((t, i) => ({ task: t, index: i }));
  withIndex.sort((a, b) => {
    const pa = getTaskPriority(a.task);
    const pb = getTaskPriority(b.task);
    if (pa !== pb) return pb - pa;
    const ta = a.task.createdAt || 0;
    const tb = b.task.createdAt || 0;
    if (ta !== tb) return ta - tb;
    return a.index - b.index;
  });
  return withIndex.map(item => item.task);
}

export function pickNextPlannerTask(tasks) {
  if (!tasks || tasks.length === 0) return null;
  const sorted = sortReadyTasksByPriority(tasks);
  return sorted[0];
}
