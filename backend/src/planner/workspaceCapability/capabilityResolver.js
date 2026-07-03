import { scanWorkspaceCapabilities } from './workspaceCapabilityScanner.js';
import { mapRequirementsToCapabilities } from './capabilityMapper.js';
import { resolveCapabilityConflicts } from './capabilityConflictResolver.js';
import { buildArtifactCandidatesFromCapabilities } from './artifactCandidateBuilder.js';
import { stringifyCapabilityEvidence } from './capabilityEvidence.js';
import { analyzeCapabilitySatisfaction } from '../../agent/planning/capabilitySatisfaction/capabilitySatisfactionAnalyzer.js';

export function resolveWorkspaceCapabilities({
  requirements = [],
  projectScanSnapshot = {},
  planningContext = {},
  objective = '',
  planningStrategyGraph = null,
  constraintGraph = null
} = {}) {
  const scanResult = Array.isArray(planningContext?.workspaceCapabilities) && planningContext.workspaceCapabilities.length > 0
    ? {
        workspaceCapabilities: planningContext.workspaceCapabilities,
        capabilityEvidence: Array.isArray(planningContext?.capabilityEvidence) ? planningContext.capabilityEvidence : []
      }
    : scanWorkspaceCapabilities({
        projectScanSnapshot,
        planningContext,
        objective
      });

  const mappingResult = mapRequirementsToCapabilities({
    requirements,
    workspaceCapabilities: scanResult.workspaceCapabilities,
    projectScanSnapshot,
    planningContext,
    objective,
    planningStrategyGraph,
    constraintGraph
  });

  const satisfactionResult = analyzeCapabilitySatisfaction({
    requirements,
    workspaceCapabilities: scanResult.workspaceCapabilities,
    planningContext,
    projectScanSnapshot,
    objective
  });

  const conflictResult = resolveCapabilityConflicts({
    mappedCapabilities: mappingResult.mappedCapabilities
  });

  const artifactResult = buildArtifactCandidatesFromCapabilities({
    resolvedCapabilities: conflictResult.resolvedCapabilities,
    satisfactionAnalysis: satisfactionResult,
    planningContext,
    projectScanSnapshot,
    objective
  });

  const capabilityEvidence = stringifyCapabilityEvidence([
    ...(Array.isArray(scanResult.capabilityEvidence) ? scanResult.capabilityEvidence : []),
    ...(Array.isArray(mappingResult.capabilityEvidence) ? mappingResult.capabilityEvidence : [])
  ]);

  console.log('[CAPABILITY_MAPPING_COMPLETE]', {
    scannedCapabilities: scanResult.workspaceCapabilities.length,
    mappedCapabilities: conflictResult.resolvedCapabilities.length,
    artifactCandidates: artifactResult.artifactCandidates.length,
    plannerApprovedArtifacts: artifactResult.plannerApprovedArtifacts.length,
    satisfiedCapabilities: satisfactionResult.satisfiedCapabilities.length,
    missingCapabilities: satisfactionResult.missingCapabilities.length,
    coverage: satisfactionResult.capabilityCoverage.coverage
  });

  return {
    workspaceCapabilities: scanResult.workspaceCapabilities,
    capabilityEvidence,
    mappedCapabilities: conflictResult.resolvedCapabilities,
    capabilityConflicts: conflictResult.conflicts,
    artifactCandidates: artifactResult.artifactCandidates,
    plannerApprovedArtifacts: artifactResult.plannerApprovedArtifacts,
    executionCandidates: artifactResult.executionCandidates,
    satisfiedCapabilities: satisfactionResult.satisfiedCapabilities,
    missingCapabilities: satisfactionResult.missingCapabilities,
    blockedCapabilities: satisfactionResult.blockedCapabilities,
    capabilityCoverage: satisfactionResult.capabilityCoverage,
    capabilityGapGraph: satisfactionResult.capabilityGapGraph,
    satisfiedCapabilityGraph: satisfactionResult.satisfiedCapabilityGraph,
    missingCapabilityGraph: satisfactionResult.missingCapabilityGraph,
    initializationCapabilities: satisfactionResult.initializationCapabilities,
    capabilitySatisfaction: satisfactionResult,
    scanResult,
    mappingResult
  };
}
