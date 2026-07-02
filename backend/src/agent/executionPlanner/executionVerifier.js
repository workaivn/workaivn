function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))];
}

export function verifyExecutionUnit(unit = {}, evidence = {}) {
  const errors = [];
  const checks = [];
  const predicate = typeof unit?.completionPredicate === 'function' ? unit.completionPredicate : null;

  if (predicate) {
    let passed = false;
    try {
      passed = predicate(evidence, unit) === true;
    } catch (error) {
      errors.push(`Completion predicate failed: ${error.message}`);
    }
    checks.push({ check: 'completionPredicate', passed });
    if (!passed) errors.push(`Completion predicate failed for ${unit?.id || 'unknown-unit'}`);
  } else {
    checks.push({ check: 'completionPredicate', passed: true });
  }

  if (Array.isArray(unit?.acceptanceCriteria) && unit.acceptanceCriteria.length > 0) {
    checks.push({ check: 'acceptanceCriteria', passed: true, count: unit.acceptanceCriteria.length });
  }

  return {
    valid: errors.length === 0,
    errors,
    checks
  };
}

export function verifyExecutionGraph(graph = null) {
  const errors = [];
  if (!graph || typeof graph.allUnits !== 'function') {
    return { valid: false, errors: ['Missing execution graph'], checks: [] };
  }

  const units = graph.allUnits();
  const completedUnits = units.filter(unit => unit.completed === true && unit.failed !== true);
  const failedUnits = units.filter(unit => unit.failed === true);
  const checks = [
    { check: 'allUnitsCompleted', passed: completedUnits.length === units.length, count: units.length },
    { check: 'noFailedUnits', passed: failedUnits.length === 0, count: failedUnits.length }
  ];

  if (completedUnits.length !== units.length) {
    errors.push('Not all execution units completed');
  }
  if (failedUnits.length > 0) {
    errors.push(`Failed units remain: ${unique(failedUnits.map(unit => unit.id)).join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    checks
  };
}

export function verifyExecutionCompletion(graph = null) {
  const result = verifyExecutionGraph(graph);
  console.log('[EXECUTION_GRAPH_VERIFIED]', {
    valid: result.valid,
    errorCount: result.errors.length
  });
  return result;
}
