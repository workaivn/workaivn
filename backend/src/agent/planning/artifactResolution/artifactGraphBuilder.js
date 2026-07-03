import crypto from 'node:crypto';

import { normalizeCapabilityKey, stringifyCapabilityEvidence } from '../../../planner/workspaceCapability/capabilityEvidence.js';

function normalizePath(value = '') {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/$/, '')
    .trim();
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))];
}

function roleFromCapability(capability = '', artifactPath = '') {
  const key = normalizeCapabilityKey(capability);
  const path = normalizePath(artifactPath).toLowerCase();
  if (key === 'APPLICATION_ENTRY') return 'ENTRY';
  if (key === 'ROOT_COMPONENT') return 'ROOT_COMPONENT';
  if (key === 'LAYOUT') return 'LAYOUT';
  if (/\/layout\./i.test(path)) return 'LAYOUT';
  if (/\/(page|index)\./i.test(path) && (key === 'VIEW' || key === 'DOCUMENTATION' || key === 'SEMANTIC_HTML')) return 'VIEW';
  if (['NAVIGATION', 'HERO', 'FEATURES', 'PRICING', 'CTA', 'FOOTER'].includes(key)) return 'SECTION';
  if (['GLOBAL_STYLE', 'STYLING', 'THEME', 'STYLING_SYSTEM'].includes(key)) return 'STYLE';
  if (['PROJECT_MANIFEST', 'DEPENDENCY_MANIFEST', 'BUILD', 'CONFIG'].includes(key)) return 'CONFIG';
  if (['TEST', 'TESTING', 'VALIDATION'].includes(key)) return 'TEST';
  if (['API_LAYER', 'API'].includes(key)) return 'API';
  if (['STATE'].includes(key)) return 'STATE';
  if (['MODEL'].includes(key)) return 'MODEL';
  if (['CONTROLLER'].includes(key)) return 'CONTROLLER';
  if (['UTILITY'].includes(key)) return 'UTILITY';
  if (['HOOK'].includes(key)) return 'HOOK';
  if (['ASSET'].includes(key)) return 'ASSET';
  return 'COMPONENT';
}

function plannerDecisionForCapability(capabilityRecord = {}) {
  const existingCount = Array.isArray(capabilityRecord?.existingArtifacts) ? capabilityRecord.existingArtifacts.length : 0;
  const candidateCount = Array.isArray(capabilityRecord?.candidateArtifacts) ? capabilityRecord.candidateArtifacts.length : 0;
  if (capabilityRecord?.plannerDecision === 'BLOCK') return 'MISSING';
  if (existingCount > 0 && candidateCount > 0) return 'PARTIAL';
  if (existingCount > 0) return 'SATISFIED';
  if (candidateCount > 0) return 'MISSING';
  return 'MISSING';
}

function selectArtifactRecord(capabilityRecord = {}) {
  return capabilityRecord?.selectedArtifact
    || capabilityRecord?.selected
    || capabilityRecord?.existingArtifacts?.[0]
    || capabilityRecord?.candidateArtifacts?.[0]
    || null;
}

export function buildArtifactGraph({
  mappedCapabilities = [],
  objective = '',
  planningContext = {},
  projectScanSnapshot = {}
} = {}) {
  const nodes = [];
  const edges = [];

  console.log('[ARTIFACT_RESOLUTION_START]', {
    capabilityCount: Array.isArray(mappedCapabilities) ? mappedCapabilities.length : 0,
    objectiveLength: String(objective || '').length
  });

  for (const capabilityRecord of Array.isArray(mappedCapabilities) ? mappedCapabilities : []) {
    const selected = selectArtifactRecord(capabilityRecord);
    const artifactPath = normalizePath(selected?.file || selected?.path || '');
    if (!artifactPath) continue;

    const role = roleFromCapability(capabilityRecord.capability, artifactPath);
    const plannerDecision = plannerDecisionForCapability(capabilityRecord);
    const artifactNode = {
      id: `artifact:${crypto.randomUUID()}`,
      capability: normalizeCapabilityKey(capabilityRecord.capability),
      artifact: artifactPath,
      role,
      confidence: Math.max(Number(capabilityRecord.confidence || 0), Number(selected?.confidence || 0)),
      evidence: stringifyCapabilityEvidence([
        ...(Array.isArray(capabilityRecord.evidence) ? capabilityRecord.evidence : []),
        ...(Array.isArray(selected?.evidence) ? selected.evidence : [])
      ]),
      ownership: null,
      lifecycle: null,
      plannerDecision,
      sourceCapabilityId: capabilityRecord?.id || null,
      selected: selected?.kind || selected?.operation || null,
      selectedArtifact: selected ? {
        file: normalizePath(selected.file || selected.path || ''),
        kind: selected.kind || selected.operation || null,
        confidence: selected.confidence ?? null,
        evidence: selected.evidence || []
      } : null,
      requirementId: capabilityRecord?.requirementId || null,
      semanticGoalId: capabilityRecord?.semanticGoalId || capabilityRecord?.requirementId || null,
      planningStrategyId: capabilityRecord?.planningStrategyId || null,
      constraintId: capabilityRecord?.constraintId || null,
      requestedKind: capabilityRecord?.requestedKind || null,
      requestedOperation: selected?.kind || selected?.operation || null,
      authoritySource: capabilityRecord?.authoritySource || null,
      dependencies: Array.isArray(capabilityRecord?.dependencies) ? [...capabilityRecord.dependencies] : [],
      existingArtifactCount: Array.isArray(capabilityRecord?.existingArtifacts) ? capabilityRecord.existingArtifacts.length : 0,
      candidateArtifactCount: Array.isArray(capabilityRecord?.candidateArtifacts) ? capabilityRecord.candidateArtifacts.length : 0
    };

    console.log('[ARTIFACT_DISCOVERED]', {
      id: artifactNode.id,
      capability: artifactNode.capability,
      artifact: artifactNode.artifact,
      confidence: artifactNode.confidence
    });
    console.log('[ARTIFACT_ROLE_ASSIGNED]', {
      id: artifactNode.id,
      capability: artifactNode.capability,
      role: artifactNode.role
    });

    nodes.push(artifactNode);

    if (Array.isArray(capabilityRecord?.dependencies) && capabilityRecord.dependencies.length > 0) {
      for (const dependency of capabilityRecord.dependencies) {
        edges.push({
          from: dependency,
          to: artifactNode.id,
          reason: `dependency:${dependency}`
        });
      }
    }
  }

  const artifactGraph = {
    objective,
    projectScanSnapshot,
    planningContext,
    nodes,
    edges
  };

  console.log('[ARTIFACT_GRAPH_CREATED]', {
    nodeCount: nodes.length,
    edgeCount: edges.length
  });
  console.log('[ARTIFACT_GRAPH_VALID]', {
    nodeCount: nodes.length,
    valid: true
  });

  return {
    artifactGraph,
    artifactNodes: nodes,
    artifactEdges: edges
  };
}
