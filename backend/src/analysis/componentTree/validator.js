import { TERMINAL_TASK_STATUSES } from "./types.js";

function buildCycleIssues(nodes = []) {
  const issues = [];
  const nodeMap = new Map((Array.isArray(nodes) ? nodes : []).map(node => [node.id, node]));
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  const cycleNodes = new Set();

  function visit(nodeId) {
    if (visiting.has(nodeId)) {
      const cycleStart = stack.indexOf(nodeId);
      const cycle = stack.slice(cycleStart).concat(nodeId);
      for (const id of cycle) cycleNodes.add(id);
      issues.push({ type: "cycle", nodes: cycle });
      return;
    }
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    visiting.add(nodeId);
    stack.push(nodeId);
    const node = nodeMap.get(nodeId);
    for (const childId of node?.children || []) {
      if (nodeMap.has(childId)) visit(childId);
    }
    stack.pop();
    visiting.delete(nodeId);
  }

  for (const node of nodeMap.values()) visit(node.id);

  return { issues, cycleNodes };
}

function validateComponentTree(tree = {}) {
  const nodes = Array.isArray(tree.components) ? tree.components : [];
  const issues = [];
  const ids = new Set();

  for (const node of nodes) {
    if (!node?.id) issues.push({ type: "missing_id", node });
    else if (ids.has(node.id)) issues.push({ type: "duplicate_id", id: node.id });
    else ids.add(node.id);
    if (!node?.path) issues.push({ type: "missing_path", node });
  }

  const { issues: cycleIssues, cycleNodes } = buildCycleIssues(nodes);
  issues.push(...cycleIssues);

  return {
    ok: issues.length === 0,
    issues,
    cycleNodes: [...cycleNodes],
    terminalStatuses: [...TERMINAL_TASK_STATUSES]
  };
}

export { buildCycleIssues, validateComponentTree };

