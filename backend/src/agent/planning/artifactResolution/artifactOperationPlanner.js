function normalizeOperation(value = '') {
  return String(value || '').trim().toUpperCase();
}

function operationReason(artifact = {}) {
  const decision = normalizeOperation(artifact?.plannerDecision || '');
  if (decision === 'SATISFIED') return 'capability already satisfied by workspace artifact';
  if (decision === 'PARTIAL') return 'workspace artifact partially satisfies capability';
  if (decision === 'MISSING') return 'capability missing in workspace';
  if (decision === 'DUPLICATE') return 'duplicate artifact candidates require consolidation';
  if (decision === 'OBSOLETE') return 'artifact is obsolete';
  if (decision === 'OVERLOADED') return 'artifact is overloaded';
  return 'planner deterministic artifact decision';
}

function planOperationForArtifact(artifact = {}) {
  const decision = normalizeOperation(artifact?.plannerDecision || '');
  if (decision === 'SATISFIED') return 'REUSE';
  if (decision === 'PARTIAL') return 'PATCH';
  if (decision === 'DUPLICATE') return 'MERGE';
  if (decision === 'OVERLOADED') return 'SPLIT';
  if (decision === 'OBSOLETE') return 'REMOVE';
  if (decision === 'MISSING') return 'CREATE';
  const selected = normalizeOperation(artifact?.selected || '');
  if (selected === 'REUSE' || selected === 'PATCH' || selected === 'CREATE') return selected;
  return 'REUSE';
}

export function planArtifactOperations({
  artifactNodes = []
} = {}) {
  const artifactOperations = {};
  const operationPlan = [];

  for (const artifact of Array.isArray(artifactNodes) ? artifactNodes : []) {
    const operation = planOperationForArtifact(artifact);
    const reason = operationReason(artifact);
    artifact.operation = operation;
    artifactOperations[artifact.id] = {
      operation,
      reason
    };
    operationPlan.push({
      artifactId: artifact.id,
      capability: artifact.capability,
      artifact: artifact.artifact,
      role: artifact.role,
      operation,
      reason,
      confidence: artifact.confidence
    });

    console.log('[ARTIFACT_OPERATION_PLANNED]', {
      artifactId: artifact.id,
      capability: artifact.capability,
      operation,
      reason
    });

    if (operation === 'REUSE') {
      console.log('[ARTIFACT_REUSED]', {
        artifactId: artifact.id,
        artifact: artifact.artifact,
        capability: artifact.capability
      });
    } else if (operation === 'PATCH') {
      console.log('[ARTIFACT_PATCH_PLANNED]', {
        artifactId: artifact.id,
        artifact: artifact.artifact,
        capability: artifact.capability
      });
    } else if (operation === 'CREATE') {
      console.log('[ARTIFACT_CREATE_PLANNED]', {
        artifactId: artifact.id,
        artifact: artifact.artifact,
        capability: artifact.capability
      });
    } else if (operation === 'MERGE') {
      console.log('[ARTIFACT_MERGE_PLANNED]', {
        artifactId: artifact.id,
        artifact: artifact.artifact,
        capability: artifact.capability
      });
    } else if (operation === 'SPLIT') {
      console.log('[ARTIFACT_SPLIT_PLANNED]', {
        artifactId: artifact.id,
        artifact: artifact.artifact,
        capability: artifact.capability
      });
    } else if (operation === 'REMOVE') {
      console.log('[ARTIFACT_REMOVE_PLANNED]', {
        artifactId: artifact.id,
        artifact: artifact.artifact,
        capability: artifact.capability
      });
    }
  }

  return {
    artifactOperations,
    operationPlan
  };
}

