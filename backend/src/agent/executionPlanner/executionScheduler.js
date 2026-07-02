function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))];
}

export function getReadyExecutionUnits(executionGraph = null) {
  if (!executionGraph || typeof executionGraph.readyUnits !== 'function') return [];
  return executionGraph.readyUnits();
}

export function groupParallelExecutionUnits(units = []) {
  const groups = [];
  const byDependencyDepth = new Map();

  const depthOf = (unit) => {
    const deps = unique(unit?.prerequisites || unit?.dependencies || []);
    if (deps.length === 0) return 0;
    return 1 + Math.max(...deps.map(dep => byDependencyDepth.get(dep) ?? 0));
  };

  for (const unit of Array.isArray(units) ? units : []) {
    const depth = depthOf(unit);
    byDependencyDepth.set(unit.id, depth);
    if (!groups[depth]) groups[depth] = [];
    groups[depth].push(unit);
  }

  return groups.filter(Boolean);
}

export function scheduleExecutionUnits(executionGraph = null) {
  if (!executionGraph) return { readyUnits: [], parallelGroups: [] };
  const readyUnits = getReadyExecutionUnits(executionGraph);
  if (typeof executionGraph.startUnit === 'function') {
    for (const unit of readyUnits) {
      executionGraph.startUnit(unit.id);
    }
  }
  const parallelGroups = groupParallelExecutionUnits(readyUnits);
  return { readyUnits, parallelGroups };
}
