import { resolveCapabilityStatuses } from './capabilityStatusResolver.js';
import { buildSatisfiedCapabilityGraph } from './satisfiedCapabilityGraph.js';
import { buildMissingCapabilityGraph } from './missingCapabilityGraph.js';
import { analyzeCapabilityGap } from './capabilityGapAnalyzer.js';
import { validateCapabilityCoverage } from './capabilityCoverageValidator.js';

export function analyzeCapabilitySatisfaction({
  requirements = [],
  workspaceCapabilities = [],
  planningContext = {},
  projectScanSnapshot = {},
  objective = ''
} = {}) {
  console.log('[CAPABILITY_SATISFACTION_START]', {
    requirementCount: Array.isArray(requirements) ? requirements.length : 0,
    workspaceCapabilityCount: Array.isArray(workspaceCapabilities) ? workspaceCapabilities.length : 0,
    workspaceEmpty: Array.isArray(projectScanSnapshot?.discoveredFiles) ? projectScanSnapshot.discoveredFiles.length === 0 : true
  });

  const statuses = resolveCapabilityStatuses({
    requirements,
    workspaceCapabilities,
    planningContext,
    projectScanSnapshot,
    objective
  });

  for (const status of statuses) {
    const payload = {
      requirementId: status.requirementId,
      capability: status.capability,
      status: status.status,
      confidence: status.confidence,
      evidenceCount: Array.isArray(status.evidence) ? status.evidence.length : 0,
      initializationEligible: status.initializationEligible === true,
      plannerAction: status.plannerAction || null
    };
    if (status.status === 'SATISFIED') {
      console.log('[CAPABILITY_SATISFIED]', payload);
    } else if (status.status === 'PARTIALLY_SATISFIED') {
      console.log('[CAPABILITY_PARTIAL]', payload);
    } else if (status.status === 'BLOCKED') {
      console.log('[CAPABILITY_BLOCKED]', payload);
    } else {
      console.log('[CAPABILITY_MISSING]', payload);
    }
  }

  const satisfiedGraph = buildSatisfiedCapabilityGraph(statuses);
  const missingGraph = buildMissingCapabilityGraph(statuses);
  const capabilityGap = analyzeCapabilityGap({ statuses });
  const coverageValidation = validateCapabilityCoverage({
    statuses,
    coverage: capabilityGap.coverage
  });

  const initializationCapabilities = missingGraph.nodes
    .filter(node => node.initializationEligible === true)
    .map(node => node.capability);

  if (!coverageValidation.valid) {
    console.log('[CAPABILITY_SATISFACTION_FAIL]', {
      errorCount: coverageValidation.errors.length,
      errors: coverageValidation.errors
    });
  }

  console.log('[CAPABILITY_COVERAGE]', capabilityGap);
  console.log('[CAPABILITY_SATISFACTION_COMPLETE]', {
    requirementCount: statuses.length,
    satisfiedCount: satisfiedGraph.nodes.length,
    missingCount: missingGraph.nodes.length,
    coverage: capabilityGap.coverage
  });

  return {
    statuses,
    satisfiedCapabilities: statuses.filter(status => status.status === 'SATISFIED'),
    missingCapabilities: statuses.filter(status => ['MISSING', 'PARTIALLY_SATISFIED', 'BLOCKED'].includes(status.status)),
    blockedCapabilities: statuses.filter(status => status.status === 'BLOCKED'),
    satisfiedCapabilityGraph: satisfiedGraph.satisfiedCapabilityGraph,
    missingCapabilityGraph: missingGraph.missingCapabilityGraph,
    capabilityGapGraph: {
      ...capabilityGap,
      nodes: missingGraph.nodes,
      edges: missingGraph.edges
    },
    capabilityCoverage: capabilityGap,
    initializationCapabilities,
    validation: coverageValidation
  };
}
