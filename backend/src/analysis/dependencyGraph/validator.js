function validateDependencyGraph(graph = {}) {
  const issues = [];
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const nodeIds = new Set();

  for (const node of nodes) {
    if (!node?.id) {
      issues.push({ type: "missing_node_id" });
      continue;
    }
    if (nodeIds.has(node.id)) {
      issues.push({ type: "duplicate_node_id", id: node.id });
    }
    nodeIds.add(node.id);
  }

  for (const edge of edges) {
    if (!edge?.from || !edge?.to) {
      issues.push({ type: "invalid_edge" });
      continue;
    }
    if (!nodeIds.has(edge.from)) issues.push({ type: "missing_edge_source", id: edge.from });
    if (!nodeIds.has(edge.to) && !String(edge.to).startsWith("package:") && !String(edge.to).startsWith("asset:")) {
      issues.push({ type: "missing_edge_target", id: edge.to });
    }
  }

  return { ok: issues.length === 0, issues };
}

export { validateDependencyGraph };

