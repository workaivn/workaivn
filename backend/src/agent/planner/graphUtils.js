export function hasCycle(nodesMap) {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  for (const id of nodesMap.keys()) color.set(id, WHITE);

  function dfs(nodeId) {
    if (color.get(nodeId) === GRAY) return true;
    if (color.get(nodeId) === BLACK) return false;
    color.set(nodeId, GRAY);
    const node = nodesMap.get(nodeId);
    if (node) {
      for (const childId of node.children) {
        if (dfs(childId)) return true;
      }
    }
    color.set(nodeId, BLACK);
    return false;
  }

  for (const id of nodesMap.keys()) {
    if (color.get(id) === WHITE) {
      if (dfs(id)) return true;
    }
  }
  return false;
}

export function getGraphValidationErrors(nodesMap) {
  const errors = [];
  const allIds = new Set(nodesMap.keys());

  for (const [id, node] of nodesMap) {
    for (const depId of node.dependencies) {
      if (!allIds.has(depId)) {
        errors.push(`Node "${id}" references missing dependency "${depId}"`);
      }
    }
    for (const parentId of node.parents) {
      if (!allIds.has(parentId)) {
        errors.push(`Node "${id}" has missing parent "${parentId}"`);
      }
    }
    for (const childId of node.children) {
      if (!allIds.has(childId)) {
        errors.push(`Node "${id}" has missing child "${childId}"`);
      }
    }
  }

  if (hasCycle(nodesMap)) {
    errors.push('Graph contains a cycle');
  }

  let rootCount = 0;
  for (const node of nodesMap.values()) {
    if (node.parents.size === 0) rootCount++;
  }
  if (rootCount === 0 && nodesMap.size > 0) {
    errors.push('Graph has no root nodes (every node has at least one parent)');
  }

  let leafCount = 0;
  for (const node of nodesMap.values()) {
    if (node.children.size === 0) leafCount++;
  }
  if (leafCount === 0 && nodesMap.size > 0) {
    errors.push('Graph has no leaf nodes (every node has at least one child)');
  }

  if (nodesMap.size === 0) {
    errors.push('Graph has no nodes');
  }

  return errors;
}
