import { normalizePath, unique } from "./fileGraph.js";
import { DEPENDENCY_EDGE_TYPES, DEPENDENCY_NODE_TYPES } from "./types.js";

function buildComponentDependencyEdges(componentTree = null, workspaceFiles = []) {
  const nodes = [];
  const edges = [];
  const componentMap = new Map();

  for (const node of Array.isArray(componentTree?.components) ? componentTree.components : []) {
    const file = normalizePath(node.path || node.filePath || "");
    if (!file) continue;
    componentMap.set(node.id || file, file);
    nodes.push({
      id: file,
      name: node.name || file,
      path: file,
      framework: node.framework || null,
      type: DEPENDENCY_NODE_TYPES.COMPONENT,
      route: node.route || null,
      dependencies: unique([...(node.children || []), ...(node.imports || [])]).map(String),
      dependents: [],
      dependencyCount: unique([...(node.children || []), ...(node.imports || [])]).length,
      dependentCount: 0,
      fanIn: 0,
      fanOut: unique([...(node.children || []), ...(node.imports || [])]).length,
      criticalScore: 0,
      impactScore: 0,
      reuseScore: 0,
      changeFrequency: 0,
      unused: !!node.unused,
      circular: !!node.circular,
      shared: !!node.shared
    });
  }

  for (const node of Array.isArray(componentTree?.components) ? componentTree.components : []) {
    const from = normalizePath(node.path || node.filePath || "");
    if (!from) continue;
    for (const childId of unique(node.children || [])) {
      const child = Array.isArray(componentTree?.components) ? componentTree.components.find(item => item.id === childId) : null;
      const to = normalizePath(child?.path || child?.filePath || "");
      if (!to) continue;
      edges.push({ from, to, type: DEPENDENCY_EDGE_TYPES.COMPONENT, reason: "component-tree" });
    }
  }

  return { nodes, edges };
}

export { buildComponentDependencyEdges };

