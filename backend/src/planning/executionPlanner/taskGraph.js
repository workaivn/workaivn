import { EXECUTION_TASK_STATUS } from "./types.js";
import { hasTerminalStatus, unique } from "./utils.js";

function normalizeDeps(task = {}) {
  return unique((Array.isArray(task.dependsOn) ? task.dependsOn : Array.isArray(task.dependencies) ? task.dependencies : [])
    .map(dep => String(dep || "").trim())
    .filter(Boolean));
}

export function buildTaskGraph(tasks = []) {
  const nodes = (Array.isArray(tasks) ? tasks : []).map(task => ({
    ...task,
    dependsOn: normalizeDeps(task)
  }));
  const edges = [];
  for (const task of nodes) {
    for (const dep of task.dependsOn) {
      edges.push({ from: dep, to: task.id, reason: task.reason || "" });
    }
  }
  return { nodes, edges };
}

export function validateTaskGraph(graph = {}) {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const errors = [];
  const ids = new Set();

  for (const task of nodes) {
    if (!task?.id) {
      errors.push({ type: "missing_task_id", task });
      continue;
    }
    if (ids.has(task.id)) {
      errors.push({ type: "duplicate_task_id", taskId: task.id });
    }
    ids.add(task.id);
  }

  for (const task of nodes) {
    for (const dep of Array.isArray(task.dependsOn) ? task.dependsOn : []) {
      if (!ids.has(dep)) {
        errors.push({ type: "missing_dependency", taskId: task.id, dependencyId: dep });
      }
    }
  }

  const adjacency = new Map(nodes.map(task => [task.id, Array.isArray(task.dependsOn) ? [...task.dependsOn] : []]));
  const state = new Map();
  const visit = (id, trail = []) => {
    const current = state.get(id);
    if (current === "gray") {
      errors.push({ type: "cycle", path: [...trail, id] });
      return;
    }
    if (current === "black") return;
    state.set(id, "gray");
    for (const dep of adjacency.get(id) || []) {
      visit(dep, [...trail, id]);
    }
    state.set(id, "black");
  };
  for (const task of nodes) visit(task.id);

  return {
    valid: errors.length === 0,
    errors
  };
}

export function resolveTaskOrder(tasks = []) {
  const nodes = (Array.isArray(tasks) ? tasks : []).map(task => ({ ...task, dependsOn: normalizeDeps(task) }));
  const byId = new Map(nodes.map(task => [task.id, task]));
  const incoming = new Map(nodes.map(task => [task.id, 0]));
  const outgoing = new Map(nodes.map(task => [task.id, []]));
  for (const task of nodes) {
    for (const dep of task.dependsOn) {
      if (!byId.has(dep)) continue;
      incoming.set(task.id, (incoming.get(task.id) || 0) + 1);
      outgoing.get(dep).push(task.id);
    }
  }

  const ready = nodes.filter(task => (incoming.get(task.id) || 0) === 0);
  ready.sort((a, b) => (Number(b.priority || 0) - Number(a.priority || 0)) || String(a.id).localeCompare(String(b.id)));
  const ordered = [];
  while (ready.length > 0) {
    const task = ready.shift();
    ordered.push(task);
    for (const childId of outgoing.get(task.id) || []) {
      incoming.set(childId, (incoming.get(childId) || 0) - 1);
      if ((incoming.get(childId) || 0) === 0) {
        ready.push(byId.get(childId));
        ready.sort((a, b) => (Number(b.priority || 0) - Number(a.priority || 0)) || String(a.id).localeCompare(String(b.id)));
      }
    }
  }

  if (ordered.length !== nodes.length) {
    return nodes;
  }
  return ordered;
}

export function updateTaskStatus(task = {}, status = EXECUTION_TASK_STATUS.PENDING) {
  if (task && typeof task === "object") {
    task.status = status;
  }
  return task;
}

export function isGraphTerminal(tasks = []) {
  return (Array.isArray(tasks) ? tasks : []).every(task => hasTerminalStatus(task?.status));
}
