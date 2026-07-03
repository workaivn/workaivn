export function buildMissingCapabilityGraph(statuses = []) {
  const nodes = [];
  const edges = [];

  for (const status of Array.isArray(statuses) ? statuses : []) {
    if (!['MISSING', 'PARTIALLY_SATISFIED', 'BLOCKED'].includes(status?.status)) continue;
    nodes.push({
      id: `missing:${status.requirementId || status.capability}`,
      capability: status.capability,
      requirementId: status.requirementId || null,
      status: status.status,
      reason: status.reason || null,
      initializationEligible: status.initializationEligible === true,
      plannerRecommendation: status.plannerRecommendation || 'NONE',
      confidence: status.confidence ?? 0.5,
      evidence: Array.isArray(status.evidence) ? [...status.evidence] : [],
      plannerAction: status.plannerAction || 'NONE'
    });
    for (const dependency of Array.isArray(status?.requirement?.dependencies) ? status.requirement.dependencies : []) {
      edges.push({
        from: dependency,
        to: `missing:${status.requirementId || status.capability}`,
        relation: 'depends_on'
      });
    }
  }

  console.log('[MISSING_CAPABILITY_GRAPH_CREATED]', {
    nodeCount: nodes.length,
    edgeCount: edges.length
  });

  return {
    missingCapabilityGraph: {
      nodes,
      edges
    },
    nodes,
    edges
  };
}
