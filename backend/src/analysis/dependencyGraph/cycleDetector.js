function detectCycles(nodes = [], edges = []) {
  const nodeIds = new Set((Array.isArray(nodes) ? nodes : []).map(node => node.id).filter(Boolean));
  const adjacency = new Map();
  for (const node of nodeIds) adjacency.set(node, []);
  for (const edge of Array.isArray(edges) ? edges : []) {
    if (!edge?.from || !edge?.to) continue;
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from).push(edge.to);
  }

  const visiting = new Set();
  const visited = new Set();
  const cycles = [];
  const cycleNodes = new Set();

  function dfs(nodeId, stack = []) {
    if (visiting.has(nodeId)) {
      const start = stack.indexOf(nodeId);
      if (start >= 0) {
        const cycle = stack.slice(start).concat(nodeId);
        cycles.push(cycle);
        for (const id of cycle) cycleNodes.add(id);
      }
      return;
    }
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    visiting.add(nodeId);
    stack.push(nodeId);
    for (const next of adjacency.get(nodeId) || []) {
      if (nodeIds.has(next)) dfs(next, stack);
    }
    stack.pop();
    visiting.delete(nodeId);
  }

  for (const id of nodeIds) dfs(id, []);

  return { cycles, cycleNodes: [...cycleNodes] };
}

export { detectCycles };

