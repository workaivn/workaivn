function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))];
}

function calculateExecutionLevels(units = []) {
  const list = Array.isArray(units) ? units : [];
  const byId = new Map(list.map(unit => [unit.id, unit]));
  const memo = new Map();

  const levelOf = (id) => {
    if (memo.has(id)) return memo.get(id);
    const unit = byId.get(id);
    const deps = unique(unit?.prerequisites || unit?.dependencies || []).filter(dep => byId.has(dep));
    const level = deps.length === 0 ? 0 : 1 + Math.max(...deps.map(dep => levelOf(dep)));
    memo.set(id, level);
    return level;
  };

  for (const id of byId.keys()) levelOf(id);
  const groups = [];
  for (const unit of list) {
    const level = memo.get(unit.id) || 0;
    if (!groups[level]) groups[level] = [];
    groups[level].push(unit);
  }
  return groups.filter(Boolean);
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
  const levels = calculateExecutionLevels(typeof executionGraph.allUnits === 'function' ? executionGraph.allUnits() : readyUnits);
  const parallelGroups = levels.length > 0 ? levels : groupParallelExecutionUnits(readyUnits);
  return { readyUnits, levels, parallelGroups };
}
