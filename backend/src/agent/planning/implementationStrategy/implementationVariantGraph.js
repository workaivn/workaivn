function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
}

function containsForbiddenExecutionDetails(value = '') {
  const text = String(value || '');
  return /\b(?:execution unit|tool call|run_terminal|write_file|apply_patch|patch_file|read_file)\b/i.test(text);
}

export function buildImplementationVariantGraph({
  implementationStrategies = [],
  selectedImplementation = null
} = {}) {
  const nodes = [];
  const edges = [];
  const selectedVariantId = selectedImplementation?.selectedVariant?.id || null;

  for (const strategy of Array.isArray(implementationStrategies) ? implementationStrategies : []) {
    if (!strategy) continue;
    nodes.push({
      id: strategy.id,
      type: 'IMPLEMENTATION_STRATEGY',
      strategy: strategy.strategy,
      requirementId: strategy.requirementId || null,
      capability: strategy.capability || null,
      confidence: strategy.confidence ?? 0.5,
      evidence: Array.isArray(strategy.evidence) ? strategy.evidence : [],
      plannerApproved: strategy.plannerApproved === true
    });
    for (const variant of Array.isArray(strategy.variants) ? strategy.variants : []) {
      if (!variant) continue;
      nodes.push({
        id: variant.id,
        type: 'IMPLEMENTATION_VARIANT',
        variant: variant.variant,
        variantKey: variant.variantKey,
        frameworkKey: variant.frameworkKey,
        hostFrameworkKey: variant.hostFrameworkKey || null,
        confidence: variant.confidence ?? 0.5,
        evidence: Array.isArray(variant.evidence) ? variant.evidence : [],
        plannerApproved: variant.plannerApproved === true
      });
      edges.push({
        from: strategy.id,
        to: variant.id,
        relation: 'has_variant'
      });
      if (selectedVariantId && selectedVariantId === variant.id) {
        edges.push({
          from: variant.id,
          to: 'implementation:selected',
          relation: 'selected'
        });
      }
    }
  }

  const graph = {
    nodes,
    edges: unique(edges.map(edge => `${edge.from}|${edge.to}|${edge.relation}`)).map(key => {
      const [from, to, relation] = key.split('|');
      return { from, to, relation };
    }),
    selectedVariantId,
    source: 'implementation_strategy_resolution'
  };

  return graph;
}

export function validateImplementationVariantGraph(graph = {}) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const errors = [];
  const serialized = JSON.stringify(graph || {});

  if (containsForbiddenExecutionDetails(serialized)) {
    errors.push('Implementation variant graph must not contain execution details');
  }

  for (const node of nodes) {
    if (containsForbiddenExecutionDetails(JSON.stringify(node || {}))) {
      errors.push(`Implementation node ${node.id || 'unknown'} contains execution details`);
    }
    if ((node.type === 'IMPLEMENTATION_VARIANT' || node.type === 'IMPLEMENTATION_STRATEGY') && Array.isArray(node.evidence) && node.evidence.length === 0) {
      errors.push(`Implementation node ${node.id || 'unknown'} must carry evidence`);
    }
  }

  if (nodes.length > 0 && !graph.selectedVariantId) {
    errors.push('Implementation variant graph must identify the selected variant');
  }

  for (const edge of edges) {
    if (!edge.from || !edge.to) {
      errors.push('Implementation graph edges must have endpoints');
      break;
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
