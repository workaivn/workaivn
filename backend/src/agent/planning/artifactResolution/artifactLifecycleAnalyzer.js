export function analyzeArtifactLifecycle({
  artifactNodes = []
} = {}) {
  const artifactLifecycle = {};

  for (const artifact of Array.isArray(artifactNodes) ? artifactNodes : []) {
    let lifecycle = 'NEW';
    const selected = String(artifact?.selected || '').toLowerCase();
    const decision = String(artifact?.plannerDecision || '').toUpperCase();
    if (decision === 'SATISFIED' || selected === 'reuse') lifecycle = 'EXISTING';
    else if (selected === 'patch' || decision === 'PARTIAL') lifecycle = 'MODIFIED';
    else if (selected === 'create' || decision === 'MISSING') lifecycle = 'GENERATED';
    else if (decision === 'DUPLICATE') lifecycle = 'DEPRECATED';
    artifact.lifecycle = lifecycle;
    artifactLifecycle[artifact.id] = lifecycle;
  }

  console.log('[ARTIFACT_LIFECYCLE_ANALYZED]', {
    artifactCount: Array.isArray(artifactNodes) ? artifactNodes.length : 0
  });

  return {
    artifactLifecycle
  };
}

