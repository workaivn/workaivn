function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
}

function scoreNode(node = {}, adjacency = {}) {
  const dependencies = Array.isArray(node.dependencies) ? node.dependencies : [];
  const dependents = Array.isArray(adjacency[node.id]?.dependents) ? adjacency[node.id].dependents : [];
  const fanOut = dependencies.length;
  const fanIn = dependents.length;
  const routeBonus = node.route ? 3 : 0;
  const cycleBonus = node.circular ? 5 : 0;
  const buildBonus = node.build ? 2 : 0;
  const runtimeBonus = node.type === "runtime" ? 2 : 0;
  const apiBonus = node.type === "api" ? 2 : 0;
  const dbBonus = node.type === "database" ? 2 : 0;
  const weight = fanIn + fanOut + routeBonus + cycleBonus + buildBonus + runtimeBonus + apiBonus + dbBonus;

  return {
    dependencyCount: fanOut,
    dependentCount: fanIn,
    fanIn,
    fanOut,
    criticalScore: weight + Math.min(fanIn, fanOut),
    impactScore: weight,
    reuseScore: fanIn > 1 ? fanIn - 1 : 0,
    changeFrequency: fanIn + (node.type === "component" ? 1 : 0)
  };
}

function analyzeImpact(nodes = [], edges = []) {
  const adjacency = {};
  for (const node of nodes) {
    adjacency[node.id] = adjacency[node.id] || { dependents: [], dependencies: [] };
  }
  for (const edge of edges) {
    if (!edge?.from || !edge?.to) continue;
    adjacency[edge.from] = adjacency[edge.from] || { dependents: [], dependencies: [] };
    adjacency[edge.to] = adjacency[edge.to] || { dependents: [], dependencies: [] };
    adjacency[edge.from].dependencies.push(edge.to);
    adjacency[edge.to].dependents.push(edge.from);
  }

  for (const node of nodes) {
    const scores = scoreNode(node, adjacency);
    node.dependencyCount = scores.dependencyCount;
    node.dependentCount = scores.dependentCount;
    node.fanIn = scores.fanIn;
    node.fanOut = scores.fanOut;
    node.criticalScore = scores.criticalScore;
    node.impactScore = scores.impactScore;
    node.reuseScore = scores.reuseScore;
    node.changeFrequency = scores.changeFrequency;
    node.dependencies = unique(adjacency[node.id]?.dependencies || node.dependencies || []);
    node.dependents = unique(adjacency[node.id]?.dependents || node.dependents || []);
    node.unused = !node.route && !node.circular && node.dependentCount === 0 && node.type !== "build";
  }

  return nodes;
}

function buildImpactChain(nodes = [], startId = "") {
  const nodeMap = new Map((Array.isArray(nodes) ? nodes : []).map(node => [node.id, node]));
  const start = nodeMap.get(startId);
  if (!start) return [];
  const queue = [start.id];
  const visited = new Set();
  const chain = [];
  while (queue.length > 0) {
    const currentId = queue.shift();
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    const current = nodeMap.get(currentId);
    if (!current) continue;
    chain.push(current);
    for (const nextId of current.dependents || []) {
      if (!visited.has(nextId) && nodeMap.has(nextId)) queue.push(nextId);
    }
  }
  return chain;
}

export { analyzeImpact, buildImpactChain, scoreNode };

