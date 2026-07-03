import crypto from 'node:crypto';

function normalizePath(value = '') {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/$/, '')
    .trim();
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function approvePlannerArtifacts({
  artifactNodes = [],
  artifactGraph = null,
  artifactOwnership = {},
  artifactLifecycle = {},
  operationPlan = [],
  planningContext = {},
  objective = ''
} = {}) {
  const plannerApprovedArtifacts = [];
  const rejectedArtifacts = [];
  const approvedArtifactIds = new Set();

  for (const artifact of Array.isArray(artifactNodes) ? artifactNodes : []) {
    const path = normalizePath(artifact?.artifact || '');
    const operation = String(artifact?.operation || '').toUpperCase();
    const ownership = artifactOwnership[artifact.id] || artifact.ownership || null;
    const lifecycle = artifactLifecycle[artifact.id] || artifact.lifecycle || null;
    const evidence = Array.isArray(artifact.evidence) ? artifact.evidence : [];
    const approved = Boolean(path) && evidence.length > 0 && Boolean(ownership) && Boolean(lifecycle) && operation !== '';
    const artifactHash = crypto.createHash('sha256').update(stableStringify({
      artifactId: artifact.id || null,
      artifact: path,
      capability: artifact.capability || null,
      role: artifact.role || null,
      operation,
      confidence: artifact.confidence ?? null,
      evidence,
      ownership,
      lifecycle,
      plannerDecision: artifact.plannerDecision || null,
      sourceCapabilityId: artifact.sourceCapabilityId || null
    })).digest('hex');
    const approvedArtifact = {
      artifact: path,
      capability: artifact.capability,
      role: artifact.role,
      operation,
      confidence: artifact.confidence,
      evidence,
      ownership,
      lifecycle,
      plannerDecision: artifact.plannerDecision,
      plannerApproved: approved === true,
      artifactId: artifact.id,
      artifactHash,
      workspaceCapabilityId: artifact.sourceCapabilityId || null,
      semanticGoalId: artifact.requirementId || artifact.semanticGoalId || null,
      requirementId: artifact.requirementId || null,
      planningStrategyId: artifact.planningStrategyId || null,
      constraintId: artifact.constraintId || null,
      authoritySource: artifact.authoritySource || null,
      requestedOperation: operation,
      requestedKind: artifact.requestedKind || null,
      executionCapability: artifact.executionCapability || artifact.capability || null,
      executionParameters: artifact.executionParameters && typeof artifact.executionParameters === 'object'
        ? { ...artifact.executionParameters }
        : { artifact: path, operation, role: artifact.role || null },
      dependencies: Array.isArray(artifact.dependencies) ? [...artifact.dependencies] : [],
      reason: approved ? 'evidence, ownership, lifecycle, and operation validated' : 'planner approval failed'
    };

    if (approved) {
      plannerApprovedArtifacts.push(approvedArtifact);
      approvedArtifactIds.add(artifact.id);
      console.log('[PLANNER_ARTIFACT_APPROVED]', {
        artifactId: artifact.id,
        capability: artifact.capability,
        artifact: path,
        operation
      });
    } else {
      rejectedArtifacts.push(approvedArtifact);
    }
  }

  return {
    plannerApprovedArtifacts,
    rejectedArtifacts,
    approvedArtifactIds
  };
}
