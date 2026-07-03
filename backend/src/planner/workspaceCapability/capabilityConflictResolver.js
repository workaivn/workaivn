import { normalizeCapabilityKey, stringifyCapabilityEvidence } from './capabilityEvidence.js';

function normalizePath(value = '') {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/$/, '')
    .trim();
}

function scoreArtifact(artifact = {}) {
  const operation = String(artifact?.kind || artifact?.operation || '').trim().toLowerCase();
  return (
    (operation === 'reuse' ? 3 : 0) +
    (operation === 'patch' ? 2 : 0) +
    (operation === 'create' ? 1 : 0) +
    (Number(artifact?.confidence || 0) * 10)
  );
}

export function resolveCapabilityConflicts({
  mappedCapabilities = []
} = {}) {
  const resolvedCapabilities = [];
  const conflicts = [];
  const seen = new Map();

  for (const capability of Array.isArray(mappedCapabilities) ? mappedCapabilities : []) {
    const key = normalizeCapabilityKey(capability?.capability || '');
    if (!seen.has(key)) {
      seen.set(key, {
        ...capability,
        capability: key,
        existingArtifacts: Array.isArray(capability?.existingArtifacts) ? [...capability.existingArtifacts] : [],
        candidateArtifacts: Array.isArray(capability?.candidateArtifacts) ? [...capability.candidateArtifacts] : []
      });
      continue;
    }

    const current = seen.get(key);
    current.existingArtifacts = [...current.existingArtifacts, ...(Array.isArray(capability?.existingArtifacts) ? capability.existingArtifacts : [])];
    current.candidateArtifacts = [...current.candidateArtifacts, ...(Array.isArray(capability?.candidateArtifacts) ? capability.candidateArtifacts : [])];
    current.confidence = Math.max(Number(current.confidence || 0), Number(capability?.confidence || 0));
    current.evidence = stringifyCapabilityEvidence([...(current.evidence || []), ...(capability?.evidence || [])]);
    conflicts.push({
      capability: key,
      reason: 'duplicate capability records merged',
      candidateCount: current.candidateArtifacts.length,
      existingArtifactCount: current.existingArtifacts.length
    });
    console.log('[CAPABILITY_CONFLICT]', {
      capability: key,
      reason: 'duplicate capability records merged',
      candidateCount: current.candidateArtifacts.length,
      existingArtifactCount: current.existingArtifacts.length
    });
  }

  for (const capability of seen.values()) {
    const candidates = [
      ...(Array.isArray(capability.existingArtifacts) ? capability.existingArtifacts : []).map(artifact => ({
        ...artifact,
        file: normalizePath(artifact.file),
        kind: 'reuse'
      })),
      ...(Array.isArray(capability.candidateArtifacts) ? capability.candidateArtifacts : []).map(artifact => ({
        ...artifact,
        file: normalizePath(artifact.file),
        kind: artifact.kind || artifact.operation || 'create'
      }))
    ];
    if (candidates.length === 0) {
      resolvedCapabilities.push({
        ...capability,
        selectedArtifact: null
      });
      continue;
    }
    const selectedArtifact = [...candidates].sort((left, right) =>
      scoreArtifact(right) - scoreArtifact(left) ||
      String(left.file || '').localeCompare(String(right.file || ''))
    )[0];
    if (candidates.length > 1) {
      console.log('[CAPABILITY_CONFLICT]', {
        capability: capability.capability,
        reason: 'multiple artifact targets',
        candidateFiles: candidates.map(candidate => candidate.file)
      });
      conflicts.push({
        capability: capability.capability,
        reason: 'multiple artifact targets',
        candidateFiles: candidates.map(candidate => candidate.file)
      });
    }
    resolvedCapabilities.push({
      ...capability,
      selectedArtifact
    });
  }

  return {
    resolvedCapabilities,
    conflicts
  };
}
