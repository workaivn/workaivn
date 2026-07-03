import crypto from 'node:crypto';

import { mapRequirementsToWorkspace } from '../../agent/planning/workspaceMapper.js';
import { normalizeCapabilityKey, stringifyCapabilityEvidence } from './capabilityEvidence.js';

function normalizePath(value = '') {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/$/, '')
    .trim();
}

function operationToExecution(operation = '') {
  const value = String(operation || '').trim().toUpperCase();
  if (value === 'PATCH') return 'patch';
  if (value === 'CREATE') return 'create';
  return 'read';
}

function candidateKind(operation = '') {
  const value = String(operation || '').trim().toUpperCase();
  if (value === 'PATCH') return 'patch';
  if (value === 'CREATE') return 'create';
  return 'reuse';
}

function defaultInitializationPath(capability = '') {
  const key = normalizeCapabilityKey(capability);
  const defaults = {
    APPLICATION_ENTRY: 'src/App.tsx',
    ROOT_COMPONENT: 'src/App.tsx',
    GLOBAL_STYLE: 'src/styles.css',
    STYLING: 'src/styles.css',
    STYLING_SYSTEM: 'src/styles.css',
    THEME: 'src/theme.ts',
    NAVIGATION: 'src/router.tsx',
    ROUTING: 'src/router.tsx',
    HERO: 'src/components/sections/HeroSection.tsx',
    FEATURES: 'src/components/sections/FeatureGrid.tsx',
    PRICING: 'src/components/sections/PricingGrid.tsx',
    CTA: 'src/components/sections/CTASection.tsx',
    FOOTER: 'src/components/sections/Footer.tsx',
    TEST: 'src/App.test.tsx',
    BUILD: 'vite.config.ts',
    AUTH: 'src/auth.ts',
    VALIDATION: 'src/validation.ts',
    API_LAYER: 'src/api/index.ts',
    STATE: 'src/state/index.ts',
    DATABASE_SCHEMA: 'src/schema.sql'
  };
  return defaults[key] || `src/${key.toLowerCase() || 'artifact'}.ts`;
}

function synthesizeInitializationArtifact({
  capability = {},
  planningContext = {},
  projectScanSnapshot = {},
  objective = ''
} = {}) {
  const requirement = capability?.requirement || {
    id: capability?.requirementId || `requirement:${String(capability?.capability || '').toLowerCase()}`,
    capability: capability?.capability,
    artifactType: 'source',
    purpose: `Initialize ${capability?.capability || 'capability'}`
  };
  const mapped = mapRequirementsToWorkspace({
    requirements: [requirement],
    planningContext,
    projectScanSnapshot,
    objective
  });
  const resolved = mapped.mappedArtifacts?.[0] || mapped.unresolvedRequirements?.[0] || null;
  const suggestedPath = normalizePath(
    resolved?.path ||
    capability?.suggestedPath ||
    defaultInitializationPath(capability?.capability)
  );
  if (!suggestedPath) return null;
  return makeArtifactCandidate({
    capability: capability?.capability,
    file: suggestedPath,
    operation: 'CREATE',
    confidence: Math.max(Number(capability?.confidence || 0), Number(resolved?.confidence || 0), 0.5),
    evidence: [
      ...(Array.isArray(capability?.evidence) ? capability.evidence : []),
      ...(Array.isArray(resolved?.evidence) ? resolved.evidence : []),
      `initialization:${capability?.capability || 'unknown'}`
    ],
    plannerVerified: true
  });
}

function makeArtifactCandidate({
  capability = '',
  file = null,
  operation = 'CREATE',
  confidence = 0.5,
  evidence = [],
  plannerVerified = true
} = {}) {
  return {
    id: `artifact:${crypto.randomUUID()}`,
    capability: normalizeCapabilityKey(capability),
    file: file ? normalizePath(file) : null,
    operation: String(operation || 'CREATE').trim().toUpperCase(),
    confidence: Number.isFinite(Number(confidence)) ? Math.max(0, Math.min(1, Number(confidence))) : 0.5,
    evidence: stringifyCapabilityEvidence(evidence),
    plannerVerified: plannerVerified === true
  };
}

export function buildArtifactCandidatesFromCapabilities({
  resolvedCapabilities = [],
  satisfactionAnalysis = null,
  planningContext = {},
  projectScanSnapshot = {},
  objective = ''
} = {}) {
  const artifactCandidates = [];
  const plannerApprovedArtifacts = [];
  const executionCandidates = [];
  const candidatePaths = new Set();

  for (const capability of Array.isArray(resolvedCapabilities) ? resolvedCapabilities : []) {
    const selected = capability?.selectedArtifact || null;
    if (!selected?.file) continue;

    const operation = String(selected.kind || selected.operation || 'create').trim().toUpperCase();
    const artifact = makeArtifactCandidate({
      capability: capability.capability,
      file: selected.file,
      operation: operation === 'REUSE' ? 'REUSE' : (operation === 'PATCH' ? 'PATCH' : 'CREATE'),
      confidence: selected.confidence ?? capability.confidence ?? 0.5,
      evidence: [
        ...(Array.isArray(capability.evidence) ? capability.evidence : []),
        ...(Array.isArray(selected.evidence) ? selected.evidence : [])
      ],
      plannerVerified: true
    });

    artifactCandidates.push(artifact);
    plannerApprovedArtifacts.push(artifact);
    candidatePaths.add(normalizePath(artifact.file));

    console.log('[ARTIFACT_CANDIDATE]', {
      capability: artifact.capability,
      file: artifact.file,
      operation: artifact.operation,
      confidence: artifact.confidence,
      plannerVerified: artifact.plannerVerified
    });
    console.log('[PLANNER_APPROVED_ARTIFACT]', {
      capability: artifact.capability,
      file: artifact.file,
      operation: artifact.operation
    });

    if (artifact.operation === 'REUSE') {
      console.log('[ARTIFACT_REUSED]', {
        capability: artifact.capability,
        file: artifact.file
      });
      continue;
    }

    if (artifact.operation === 'PATCH') {
      console.log('[ARTIFACT_PATCH]', {
        capability: artifact.capability,
        file: artifact.file
      });
    } else {
      console.log('[ARTIFACT_CREATE]', {
        capability: artifact.capability,
        file: artifact.file
      });
    }

    executionCandidates.push({
      id: artifact.id,
      name: artifact.capability,
      purpose: artifact.capability,
      artifactKind: artifact.capability,
      suggestedPath: artifact.file,
      suggestedOperation: operationToExecution(artifact.operation),
      origin: 'workspace',
      authoritySource: 'VERIFIED_PLANNING_CONTEXT',
      confidence: artifact.confidence,
      evidence: artifact.evidence,
      dependencies: [],
      validationHints: [],
      plannerVerified: true,
      operationKind: candidateKind(artifact.operation)
    });
  }

  const initializationAllowed = Boolean(
    satisfactionAnalysis?.initializationCapabilities?.length > 0 &&
    (
      planningContext?.objectiveAuthorityEligible === true ||
      planningContext?.initializationMode === 'PROJECT_INITIALIZATION' ||
      planningContext?.policies?.ALLOW_PROJECT_INITIALIZATION === true ||
      planningContext?.plannerPolicies?.ALLOW_PROJECT_INITIALIZATION === true
    )
  );
  if (initializationAllowed) {
    for (const missing of Array.isArray(satisfactionAnalysis?.missingCapabilities) ? satisfactionAnalysis.missingCapabilities : []) {
      if (!missing || missing.status !== 'MISSING' || missing.initializationEligible !== true) continue;
      const candidate = synthesizeInitializationArtifact({
        capability: missing,
        planningContext,
        projectScanSnapshot,
        objective
      });
      if (!candidate?.file) continue;
      const candidatePath = normalizePath(candidate.file);
      if (candidatePaths.has(candidatePath)) continue;
      candidatePaths.add(candidatePath);
      artifactCandidates.push(candidate);
      plannerApprovedArtifacts.push(candidate);
      executionCandidates.push({
        id: candidate.id,
        name: candidate.capability,
        purpose: candidate.capability,
        artifactKind: candidate.capability,
        suggestedPath: candidate.file,
        suggestedOperation: operationToExecution(candidate.operation),
        origin: 'initialization',
        authoritySource: 'VERIFIED_PLANNING_CONTEXT',
        confidence: candidate.confidence,
        evidence: candidate.evidence,
        dependencies: [],
        validationHints: [],
        plannerVerified: true,
        operationKind: candidateKind(candidate.operation)
      });
      console.log('[ARTIFACT_INITIALIZATION_CANDIDATE]', {
        capability: candidate.capability,
        file: candidate.file,
        operation: candidate.operation,
        confidence: candidate.confidence
      });
    }
  }

  return {
    artifactCandidates,
    plannerApprovedArtifacts,
    executionCandidates
  };
}
