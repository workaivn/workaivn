function scoreArtifact(artifact = {}) {
  const confidence = Number(artifact?.confidence || 0);
  const ownershipScore = Array.isArray(artifact?.ownership?.scope) ? artifact.ownership.scope.length : 0;
  const lifecycleBonus = artifact?.lifecycle === 'EXISTING' ? 3 : (artifact?.lifecycle === 'MODIFIED' ? 2 : 1);
  return confidence * 10 + ownershipScore + lifecycleBonus;
}

export function resolveArtifactConflicts({
  artifactNodes = []
} = {}) {
  const byCapability = new Map();
  const conflicts = [];

  for (const artifact of Array.isArray(artifactNodes) ? artifactNodes : []) {
    const key = String(artifact?.capability || '').toUpperCase();
    if (!key) continue;
    if (!byCapability.has(key)) {
      byCapability.set(key, []);
    }
    byCapability.get(key).push(artifact);
  }

  const resolvedArtifacts = [];
  for (const [capability, artifacts] of byCapability.entries()) {
    const ordered = [...artifacts].sort((left, right) =>
      scoreArtifact(right) - scoreArtifact(left) ||
      String(left.artifact || '').localeCompare(String(right.artifact || ''))
    );
    const selected = ordered[0];
    if (ordered.length > 1) {
      conflicts.push({
        capability,
        candidateArtifacts: ordered.map(artifact => artifact.artifact)
      });
      console.log('[ARTIFACT_CONFLICT_RESOLVED]', {
        capability,
        selectedArtifact: selected?.artifact || null,
        candidateArtifacts: ordered.map(artifact => artifact.artifact)
      });
    }
    resolvedArtifacts.push(selected);
  }

  return {
    resolvedArtifacts,
    conflicts
  };
}

