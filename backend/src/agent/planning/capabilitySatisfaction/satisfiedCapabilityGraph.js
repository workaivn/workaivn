import { stringifyCapabilityEvidence } from '../../../planner/workspaceCapability/capabilityEvidence.js';

export function buildSatisfiedCapabilityGraph(statuses = []) {
  const nodes = [];
  const edges = [];

  for (const status of Array.isArray(statuses) ? statuses : []) {
    if (status?.status !== 'SATISFIED') continue;
    nodes.push({
      id: `satisfied:${status.requirementId || status.capability}`,
      capability: status.capability,
      artifact: Array.isArray(status.workspaceArtifacts) && status.workspaceArtifacts[0]
        ? status.workspaceArtifacts[0].file || status.workspaceArtifacts[0].path || null
        : null,
      evidence: stringifyCapabilityEvidence(status.evidence || []),
      ownership: Array.isArray(status.workspaceArtifacts) ? status.workspaceArtifacts[0]?.ownership || null : null,
      confidence: status.confidence ?? 0.5,
      requirementId: status.requirementId || null
    });
  }

  console.log('[SATISFIED_CAPABILITY_GRAPH_CREATED]', {
    nodeCount: nodes.length,
    edgeCount: edges.length
  });

  return {
    satisfiedCapabilityGraph: {
      nodes,
      edges
    },
    nodes,
    edges
  };
}
