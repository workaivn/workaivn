function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))];
}

export function validateExecutionDependencies(units = []) {
  const errors = [];
  const seen = new Set();
  const graph = new Map();

  for (const unit of Array.isArray(units) ? units : []) {
    if (!unit?.id) {
      errors.push('Execution unit missing id');
      continue;
    }
    if (seen.has(unit.id)) {
      errors.push(`Duplicate execution unit id: ${unit.id}`);
      continue;
    }
    seen.add(unit.id);
    graph.set(unit.id, unique(unit.dependencies || unit.prerequisites || []));
  }

  for (const [id, deps] of graph.entries()) {
    for (const dep of deps) {
      if (!graph.has(dep)) {
        errors.push(`Missing dependency "${dep}" for "${id}"`);
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  const visit = (id) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      errors.push(`Cycle detected: ${[...stack, id].join(' -> ')}`);
      return;
    }
    visiting.add(id);
    stack.push(id);
    for (const dep of graph.get(id) || []) {
      visit(dep);
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  };

  for (const id of graph.keys()) {
    visit(id);
  }

  return { valid: errors.length === 0, errors };
}

export function resolveExecutionOrder(units = []) {
  const list = Array.isArray(units) ? [...units] : [];
  const byId = new Map(list.map(unit => [unit.id, unit]));
  const resolved = [];
  const visited = new Set();
  const visiting = new Set();

  const visit = (unit) => {
    if (!unit || visited.has(unit.id)) return;
    if (visiting.has(unit.id)) {
      throw new Error(`Execution dependency cycle: ${unit.id}`);
    }
    visiting.add(unit.id);
    for (const depId of unique(unit.dependencies || unit.prerequisites || [])) {
      const dep = byId.get(depId);
      if (dep) visit(dep);
    }
    visiting.delete(unit.id);
    visited.add(unit.id);
    resolved.push(unit);
  };

  for (const unit of list) visit(unit);
  return resolved;
}
