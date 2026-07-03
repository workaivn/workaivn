import crypto from 'node:crypto';

import { isExecutableAuthoritySource, normalizeAuthoritySource } from '../../planner/authority/AuthoritySource.js';

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))];
}

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

function hashArtifact(artifact = {}) {
  return crypto.createHash('sha256').update(stableStringify({
    artifactId: artifact.artifactId || null,
    artifact: normalizePath(artifact.artifact || artifact.path || ''),
    capability: artifact.capability || null,
    role: artifact.role || null,
    operation: String(artifact.operation || artifact.requestedOperation || '').toUpperCase() || null,
    requestedKind: artifact.requestedKind || null,
    authoritySource: normalizeAuthoritySource(artifact.authoritySource || ''),
    requirementId: artifact.requirementId || null,
    semanticGoalId: artifact.semanticGoalId || null,
    workspaceCapabilityId: artifact.workspaceCapabilityId || null,
    planningStrategyId: artifact.planningStrategyId || null,
    constraintId: artifact.constraintId || null,
    evidence: Array.isArray(artifact.evidence) ? artifact.evidence : [],
    dependencies: Array.isArray(artifact.dependencies) ? artifact.dependencies : []
  })).digest('hex');
}

function artifactToIntentType(artifact = {}) {
  const operation = String(artifact.requestedOperation || artifact.operation || '').trim().toUpperCase();
  const capability = String(artifact.executionCapability || artifact.capability || artifact.role || '').trim().toUpperCase();

  if (operation === 'PATCH') return 'PATCH_SOURCE';
  if (operation === 'REUSE') return 'READ_CONTEXT';

  if (capability === 'TEST' || capability === 'TESTING' || capability === 'VALIDATION') return 'GENERATE_TEST';
  if (capability === 'GLOBAL_STYLE' || capability === 'STYLING' || capability === 'THEME' || capability === 'STYLING_SYSTEM' || capability === 'STYLE') return 'GENERATE_STYLE';
  if (capability === 'ICON_SET' || capability === 'ICON') return 'GENERATE_ICON';
  if (capability === 'IMAGE_ASSET' || capability === 'IMAGE') return 'GENERATE_IMAGE';
  if (capability === 'BUILD' || capability === 'PROJECT_MANIFEST' || capability === 'DEPENDENCY_MANIFEST' || capability === 'CONFIG') return 'GENERATE_CONFIG';
  if (capability === 'APPLICATION_ENTRY' || capability === 'ROOT_COMPONENT' || capability === 'LAYOUT' || capability === 'SECTION' || capability === 'COMPONENT_STRUCTURE' || capability === 'VIEW' || capability === 'COMPONENT') {
    return 'GENERATE_COMPONENTS';
  }
  if (capability === 'API' || capability === 'API_LAYER' || capability === 'STATE' || capability === 'MODEL' || capability === 'CONTROLLER' || capability === 'HOOK' || capability === 'UTILITY' || capability === 'SOURCE') {
    return 'GENERATE_SOURCE';
  }
  return 'GENERATE_SOURCE';
}

function requiredProvenanceFields(artifact = {}) {
  return {
    plannerArtifactId: artifact.plannerArtifactId || artifact.artifactId || null,
    artifactHash: artifact.artifactHash || null,
    requirementId: artifact.requirementId || null,
    workspaceCapabilityId: artifact.workspaceCapabilityId || null,
    authoritySource: artifact.authoritySource || null
  };
}

export function validateExecutionIntentProvenance(intent = {}, context = {}) {
  const provenance = intent?.provenance && typeof intent.provenance === 'object'
    ? intent.provenance
    : {
        plannerArtifactId: intent?.plannerArtifactId || null,
        artifactHash: intent?.artifactHash || null,
        requirementId: intent?.requirementId || null,
        workspaceCapabilityId: intent?.workspaceCapabilityId || null,
        authoritySource: intent?.authoritySource || null,
        dependencies: Array.isArray(intent?.dependencies) ? [...intent.dependencies] : [],
        requestedOperation: intent?.requestedOperation || null,
        requestedKind: intent?.requestedKind || null
      };

  const errors = [];
  const current = requiredProvenanceFields(provenance);

  if (!current.plannerArtifactId) errors.push('Missing plannerArtifactId');
  if (!current.artifactHash) errors.push('Missing artifactHash');
  if (!current.requirementId) errors.push('Requirement missing');
  if (!current.workspaceCapabilityId) errors.push('Capability mismatch');

  if (!isExecutableAuthoritySource(current.authoritySource || '')) {
    errors.push('Authority source invalid');
  }

  const approvedArtifacts = Array.isArray(context?.plannerApprovedArtifacts) ? context.plannerApprovedArtifacts : [];
  const approvedById = new Map(approvedArtifacts.map(artifact => [String(artifact?.artifactId || '').trim(), artifact]));
  const approved = approvedById.get(String(current.plannerArtifactId || '').trim());
  if (!approved) {
    errors.push('Artifact approval revoked');
  } else if (String(approved.artifactHash || approved?.provenance?.artifactHash || '').trim() && String(current.artifactHash || '').trim() && String(approved.artifactHash || approved?.provenance?.artifactHash || '').trim() !== String(current.artifactHash || '').trim()) {
    errors.push('Planner hash mismatch');
  }

  const dependencies = unique(provenance.dependencies || []);
  const chain = unique(provenance.parentExecutionIntentIds || intent?.dependencies || []);
  if (dependencies.length !== chain.length || dependencies.some((dep, index) => dep !== chain[index])) {
    errors.push('Dependency chain broken');
  }

  return {
    valid: errors.length === 0,
    errors,
    provenance
  };
}

export function buildExecutionIntentProvenanceGraph({
  plannerApprovedArtifacts = [],
  planningContext = {},
  projectScanSnapshot = {},
  objective = ''
} = {}) {
  const nodes = [];
  const edges = [];
  const artifactList = Array.isArray(plannerApprovedArtifacts) ? plannerApprovedArtifacts : [];

  console.log('[EXECUTION_INTENT_PROVENANCE_START]', {
    approvedArtifactCount: artifactList.length
  });

  const nodeById = new Map();
  const errors = [];

  for (const artifact of artifactList) {
    const artifactId = String(artifact?.artifactId || '').trim();
    const artifactHash = String(artifact?.artifactHash || '').trim();
    const requirementId = String(artifact?.requirementId || artifact?.semanticGoalId || '').trim();
    const workspaceCapabilityId = String(artifact?.workspaceCapabilityId || '').trim();
    const authoritySource = normalizeAuthoritySource(artifact?.authoritySource || '');
    const dependencies = unique(artifact?.dependencies || []);
    const intentId = artifactId ? `intent:${artifactId}` : `intent:${crypto.randomUUID()}`;
    const requestedOperation = String(artifact?.requestedOperation || artifact?.operation || '').trim().toUpperCase() || 'CREATE';
    const requestedKind = artifact?.requestedKind || null;
    const intent = artifactToIntentType(artifact);
    const provenance = {
      plannerArtifactId: artifactId || null,
      semanticGoalId: artifact?.semanticGoalId || requirementId || null,
      requirementId: requirementId || null,
      workspaceCapabilityId: workspaceCapabilityId || null,
      planningStrategyId: artifact?.planningStrategyId || null,
      constraintId: artifact?.constraintId || null,
      authoritySource,
      artifactId: artifactId || null,
      artifactHash: artifactHash || null,
      requestedOperation,
      requestedKind,
      executionCapability: artifact?.executionCapability || artifact?.capability || null,
      executionParameters: artifact?.executionParameters && typeof artifact.executionParameters === 'object'
        ? { ...artifact.executionParameters }
        : {
            artifact: normalizePath(artifact?.artifact || ''),
            operation: requestedOperation,
            role: artifact?.role || null
          },
      dependencies
    };

    const node = {
      id: intentId,
      intent,
      purpose: `Execute approved artifact ${normalizePath(artifact?.artifact || '')}`,
      capability: artifact?.executionCapability || artifact?.capability || null,
      required: true,
      inputs: {
        intentId,
        plannerArtifactId: artifactId || null,
        semanticGoalId: provenance.semanticGoalId,
        requirementId: provenance.requirementId,
        workspaceCapabilityId,
        planningStrategyId: provenance.planningStrategyId || null,
        constraintId: provenance.constraintId || null,
        authoritySource,
        requestedOperation,
        requestedKind,
        executionParameters: { ...provenance.executionParameters }
      },
      outputs: {
        path: normalizePath(artifact?.artifact || ''),
        file: normalizePath(artifact?.artifact || ''),
        artifactId,
        artifactHash
      },
      dependencies,
      confidence: Number.isFinite(Number(artifact?.confidence)) ? Number(artifact.confidence) : 0.5,
      evidence: Array.isArray(artifact?.evidence) ? [...artifact.evidence] : [],
      executionEligible: false,
      requestedKind,
      authority: { source: authoritySource },
      authoritySource,
      authorityState: 'candidate',
      source: 'VERIFIED_ARTIFACT_MAPPING',
      purityStatus: 'provenance',
      plannerArtifactId: artifactId,
      semanticGoalId: provenance.semanticGoalId,
      requirementId: provenance.requirementId,
      workspaceCapabilityId,
      planningStrategyId: provenance.planningStrategyId,
      constraintId: provenance.constraintId,
      artifactHash,
      requestedOperation,
      executionCapability: provenance.executionCapability,
      executionParameters: { ...provenance.executionParameters },
      provenance,
      plannerApproved: artifact?.plannerApproved === true
    };

    const validation = validateExecutionIntentProvenance(node, { plannerApprovedArtifacts: artifactList });
    if (!validation.valid) {
      errors.push({
        intentId,
        artifactId: artifactId || null,
        errors: validation.errors
      });
      console.log('[EXECUTION_INTENT_PROVENANCE_FAIL]', {
        intentId,
        artifactId: artifactId || null,
        errors: validation.errors
      });
      continue;
    }

    console.log('[EXECUTION_INTENT_PARENT_ARTIFACT]', {
      intentId,
      plannerArtifactId: artifactId || null,
      artifactId: artifactId || null,
      artifactHash: artifactHash || null
    });
    console.log('[EXECUTION_INTENT_PARENT_REQUIREMENT]', {
      intentId,
      requirementId: provenance.requirementId || null,
      semanticGoalId: provenance.semanticGoalId || null,
      planningStrategyId: provenance.planningStrategyId || null,
      constraintId: provenance.constraintId || null
    });
    console.log('[EXECUTION_INTENT_PARENT_GOAL]', {
      intentId,
      semanticGoalId: provenance.semanticGoalId || null
    });
    console.log('[EXECUTION_INTENT_PARENT_CAPABILITY]', {
      intentId,
      workspaceCapabilityId: provenance.workspaceCapabilityId || null,
      executionCapability: provenance.executionCapability || null
    });

    nodes.push(node);
    nodeById.set(intentId, node);
    for (const dependency of dependencies) {
      edges.push({ from: dependency, to: intentId, relation: 'depends_on' });
    }
  }

  const validation = errors.length === 0;
  console.log(validation ? '[EXECUTION_INTENT_PROVENANCE_PASS]' : '[EXECUTION_INTENT_PROVENANCE_FAIL]', {
    intentCount: nodes.length,
    errorCount: errors.length
  });

  return {
    intentGraph: {
      objective: String(objective || '').trim(),
      planningContext,
      projectScanSnapshot,
      nodes,
      edges
    },
    executionIntents: nodes,
    edges,
    validation: {
      valid: validation,
      errors
    }
  };
}
