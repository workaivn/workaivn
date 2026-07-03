import { buildArtifactGraph } from './artifactGraphBuilder.js';
import { analyzeArtifactOwnership } from './artifactOwnershipResolver.js';
import { analyzeArtifactLifecycle } from './artifactLifecycleAnalyzer.js';
import { resolveArtifactConflicts } from './artifactConflictResolver.js';
import { planArtifactOperations } from './artifactOperationPlanner.js';
import { approvePlannerArtifacts } from './plannerArtifactApproval.js';

export function resolveArtifacts({
  mappedCapabilities = [],
  requirements = [],
  workspaceCapabilities = [],
  planningContext = {},
  projectScanSnapshot = {},
  objective = '',
  planningStrategyGraph = null,
  constraintGraph = null,
  satisfactionAnalysis = null
} = {}) {
  const graphResult = buildArtifactGraph({
    mappedCapabilities,
    requirements,
    planningContext,
    projectScanSnapshot,
    objective,
    planningStrategyGraph,
    constraintGraph
  });

  const conflictResult = resolveArtifactConflicts({
    artifactNodes: graphResult.artifactNodes
  });
  const artifactNodes = conflictResult.resolvedArtifacts;

  const ownershipResult = analyzeArtifactOwnership({ artifactNodes });
  const lifecycleResult = analyzeArtifactLifecycle({ artifactNodes });
  const operationResult = planArtifactOperations({ artifactNodes });
  const approvalResult = approvePlannerArtifacts({
    artifactNodes,
    artifactGraph: graphResult.artifactGraph,
    artifactOwnership: ownershipResult.artifactOwnership,
    artifactLifecycle: lifecycleResult.artifactLifecycle,
    operationPlan: operationResult.operationPlan,
    planningContext,
    objective,
    satisfactionAnalysis
  });

  const executionCandidates = approvalResult.plannerApprovedArtifacts.map(artifact => ({
    id: artifact.artifactId,
    name: artifact.capability,
    purpose: artifact.capability,
    artifactKind: artifact.role,
    suggestedPath: artifact.artifact,
    suggestedOperation: artifact.operation.toLowerCase(),
    origin: artifact.operation === 'CREATE' ? 'objective' : 'workspace',
    authoritySource: artifact.operation === 'CREATE' || artifact.operation === 'PATCH'
      ? 'VERIFIED_ARTIFACT_MAPPING'
      : 'VERIFIED_PLANNING_CONTEXT',
    confidence: artifact.confidence,
    evidence: artifact.evidence,
    dependencies: [],
    validationHints: [],
    plannerVerified: true,
    plannerApproved: true,
    operation: artifact.operation,
    role: artifact.role
  })).filter(candidate => ['CREATE', 'PATCH'].includes(String(candidate.operation || '').toUpperCase()));

  console.log('[ARTIFACT_RESOLUTION_COMPLETE]', {
    artifactCount: artifactNodes.length,
    plannerApprovedCount: approvalResult.plannerApprovedArtifacts.length,
    executionCandidateCount: executionCandidates.length,
    satisfiedCapabilityCount: Array.isArray(satisfactionAnalysis?.satisfiedCapabilities) ? satisfactionAnalysis.satisfiedCapabilities.length : 0,
    missingCapabilityCount: Array.isArray(satisfactionAnalysis?.missingCapabilities) ? satisfactionAnalysis.missingCapabilities.length : 0
  });

  return {
    artifactGraph: graphResult.artifactGraph,
    artifactNodes,
    artifactEdges: graphResult.artifactEdges,
    artifactOwnership: ownershipResult.artifactOwnership,
    artifactLifecycle: lifecycleResult.artifactLifecycle,
    artifactOperations: operationResult.artifactOperations,
    operationPlan: operationResult.operationPlan,
    plannerApprovedArtifacts: approvalResult.plannerApprovedArtifacts,
    rejectedArtifacts: approvalResult.rejectedArtifacts,
    approvedArtifactIds: approvalResult.approvedArtifactIds,
    executionCandidates,
    satisfactionAnalysis
  };
}
