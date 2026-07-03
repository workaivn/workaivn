import { mapRequirementsToWorkspace } from '../../agent/planning/workspaceMapper.js';
import { collectEvidence, normalizeCapabilityKey, stringifyCapabilityEvidence } from './capabilityEvidence.js';

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => normalizePath(value)).filter(Boolean))];
}

function normalizePath(value = '') {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/$/, '')
    .trim();
}

function mergeEvidence(...groups) {
  return stringifyCapabilityEvidence(groups.flat());
}

function uniqueArtifactRecords(records = []) {
  const seen = new Set();
  const output = [];
  for (const record of Array.isArray(records) ? records : []) {
    const file = normalizePath(record?.file || '');
    if (!file) continue;
    const key = `${file}|${String(record?.kind || '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({
      ...record,
      file
    });
  }
  return output;
}

function toArtifactCandidate({
  capability,
  file,
  operation,
  confidence,
  evidence,
  plannerVerified = true,
  origin = 'capability_graph'
} = {}) {
  return {
    capability: normalizeCapabilityKey(capability),
    file: file ? normalizePath(file) : null,
    operation: String(operation || 'CREATE').trim().toUpperCase(),
    confidence: Number.isFinite(Number(confidence)) ? Math.max(0, Math.min(1, Number(confidence))) : 0.5,
    evidence: stringifyCapabilityEvidence(evidence),
    plannerVerified: plannerVerified === true,
    origin
  };
}

export function mapRequirementsToCapabilities({
  requirements = [],
  workspaceCapabilities = [],
  projectScanSnapshot = {},
  planningContext = {},
  objective = '',
  planningStrategyGraph = null,
  constraintGraph = null
} = {}) {
  const capabilityByKey = new Map((Array.isArray(workspaceCapabilities) ? workspaceCapabilities : []).map(capability => [normalizeCapabilityKey(capability.capability), capability]));
  const mappedCapabilities = [];
  const capabilityEvidence = [];

  for (const requirement of Array.isArray(requirements) ? requirements : []) {
    const capabilityKey = normalizeCapabilityKey(requirement?.capability || requirement?.artifactKind || 'UNKNOWN');
    const scanMatch = capabilityByKey.get(capabilityKey) || null;
    const workspaceArtifacts = uniqueArtifactRecords(scanMatch?.existingArtifacts || []).map(artifact => ({
      file: artifact.file,
      kind: 'existing',
      confidence: scanMatch?.confidence ?? requirement?.confidence ?? 0.5,
      evidence: collectEvidence({
        capability: capabilityKey,
        source: 'workspace_capability',
        path: artifact.file,
        detail: 'existing artifact from workspace scan',
        objective,
        projectScanSnapshot,
        planningContext,
        requirement
      })
    }));
    const requestedArtifacts = uniqueArtifactRecords(scanMatch?.requestedArtifacts || []).map(artifact => ({
      file: artifact.file,
      kind: 'requested',
      confidence: scanMatch?.confidence ?? requirement?.confidence ?? 0.5,
      evidence: collectEvidence({
        capability: capabilityKey,
        source: 'requested_artifact',
        path: artifact.file,
        detail: 'requested artifact from explicit user requirement',
        objective,
        projectScanSnapshot,
        planningContext,
        requirement
      })
    }));

    const mapping = mapRequirementsToWorkspace({
      requirements: [requirement],
      projectScanSnapshot,
      planningContext,
      objective,
      planningStrategyGraph,
      constraintGraph
    });
    const resolved = mapping.mappedArtifacts[0] || mapping.unresolvedRequirements[0] || null;
    const candidateArtifacts = [];
    if (resolved?.path) {
      candidateArtifacts.push({
        file: normalizePath(resolved.path),
        kind: resolved.operation && String(resolved.operation).toLowerCase() === 'patch' ? 'patch' : 'create',
        confidence: resolved.confidence ?? requirement?.confidence ?? 0.5,
        evidence: collectEvidence({
          capability: capabilityKey,
          source: 'workspace_mapping',
          path: resolved.path,
          detail: resolved.mappingReason || 'workspace mapping',
          objective,
          projectScanSnapshot,
          planningContext,
          requirement
        })
      });
    }

    const capabilityRecord = {
      id: scanMatch?.id || `workspace-capability:${capabilityKey}`,
      capability: capabilityKey,
      confidence: Math.max(
        Number(scanMatch?.confidence || 0),
        Number(requirement?.confidence || 0),
        Number(resolved?.confidence || 0)
      ),
      evidence: mergeEvidence(
        scanMatch?.evidence || [],
        resolved?.evidence || [],
        collectEvidence({
          capability: capabilityKey,
          source: 'capability_mapper',
          path: resolved?.path || null,
          detail: resolved?.mappingReason || 'capability mapping',
          objective,
          projectScanSnapshot,
          planningContext,
          requirement
        })
      ),
      existingArtifacts: workspaceArtifacts.length > 0 ? workspaceArtifacts : (scanMatch?.existingArtifacts || []),
      requestedArtifacts,
      candidateArtifacts: candidateArtifacts.length > 0 ? candidateArtifacts : requestedArtifacts,
      plannerDecision: workspaceArtifacts.length > 0
        ? 'REUSE'
        : ((candidateArtifacts.length > 0 || requestedArtifacts.length > 0)
          ? ((candidateArtifacts[0] || requestedArtifacts[0]).kind === 'patch' ? 'PATCH' : 'CREATE')
          : 'BLOCK'),
      requirementId: requirement?.id || null,
      semanticGoalId: requirement?.semanticGoalId || requirement?.goalId || null,
      planningStrategyId: requirement?.planningStrategyId || null,
      constraintId: requirement?.constraintId || null,
      requirementPurpose: requirement?.purpose || null,
      required: requirement?.required !== false,
      optional: requirement?.optional === true,
      source: requirement?.source || 'objective'
    };

    console.log('[CAPABILITY_MAPPING]', {
      requirementId: capabilityRecord.requirementId,
      capability: capabilityRecord.capability,
      plannerDecision: capabilityRecord.plannerDecision,
      existingArtifactCount: capabilityRecord.existingArtifacts.length,
      requestedArtifactCount: capabilityRecord.requestedArtifacts.length,
      candidateArtifactCount: capabilityRecord.candidateArtifacts.length
    });

    mappedCapabilities.push(capabilityRecord);
    capabilityEvidence.push(...capabilityRecord.evidence.map(evidence => ({
      capability: capabilityRecord.capability,
      evidence
    })));
  }

  return {
    mappedCapabilities,
    capabilityEvidence
  };
}
