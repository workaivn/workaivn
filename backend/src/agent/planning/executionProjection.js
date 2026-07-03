import crypto from 'node:crypto';
import { createExecutionUnit, EXECUTION_UNIT_TYPES } from '../executionPlanner/executionUnit.js';
import { createExecutionGraph } from '../executionPlanner/executionGraph.js';

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))];
}

function normalize(value = '') {
  return String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '').trim();
}

function upper(value = '') {
  return String(value || '').trim().toUpperCase();
}

function lower(value = '') {
  return String(value || '').trim().toLowerCase();
}

const READ_INTENTS = new Set([
  'READ_CONTEXT',
  'FRAMEWORK_DISCOVERY',
  'VALIDATION_DISCOVERY',
  'ENTRY_DISCOVERY',
  'PACKAGE_DISCOVERY',
  'DISCOVER_WORKSPACE',
  'DISCOVER_BLADE',
  'COLLECT_EVIDENCE'
]);

const WRITE_INTENTS = new Set([
  'GENERATE_SOURCE',
  'GENERATE_TEST',
  'GENERATE_STYLE',
  'GENERATE_ASSET',
  'GENERATE_CONFIG',
  'GENERATE_COMPONENTS',
  'GENERATE_VIEW',
  'GENERATE_CONTROLLER',
  'GENERATE_ICON',
  'GENERATE_IMAGE',
  'GENERATE_HTML'
]);

const VERIFY_INTENTS = new Set([
  'VERIFY_RESULT',
  'QUALITY_GATE',
  'FINALIZE'
]);

function getRequestedKind(intentNode = {}) {
  return upper(intentNode?.requestedKind || intentNode?.inputs?.requestedKind || intentNode?.metadata?.requestedKind || '');
}

function getIntentAuthority(intentNode = {}) {
  if (intentNode?.authority && typeof intentNode.authority === 'object') {
    return { ...intentNode.authority };
  }
  const source = intentNode?.authoritySource ? lower(intentNode.authoritySource) : '';
  if (source) return { source };
  const requestedKind = getRequestedKind(intentNode);
  if (requestedKind === 'EXPLICIT_CREATE') return { source: 'explicit_user_request' };
  if (requestedKind === 'EXPLICIT_MODIFICATION' || requestedKind === 'MODIFY') return { source: 'workspace_authority' };
  if (READ_INTENTS.has(upper(intentNode?.intent || '')) || VERIFY_INTENTS.has(upper(intentNode?.intent || ''))) {
    return { source: 'verified_planning_context' };
  }
  return null;
}

function determineExecutionType(intentNode = {}) {
  const intent = upper(intentNode?.intent || '');
  const requestedKind = getRequestedKind(intentNode);

  if (requestedKind === 'DISCOVER_IF_EXISTS' || requestedKind === 'REFERENCE_ONLY') {
    return EXECUTION_UNIT_TYPES.READ;
  }
  if (requestedKind === 'EXPLICIT_CREATE') {
    return EXECUTION_UNIT_TYPES.WRITE;
  }
  if (requestedKind === 'EXPLICIT_MODIFICATION' || requestedKind === 'MODIFY') {
    return EXECUTION_UNIT_TYPES.PATCH;
  }

  if (READ_INTENTS.has(intent)) return EXECUTION_UNIT_TYPES.READ;
  if (WRITE_INTENTS.has(intent)) return EXECUTION_UNIT_TYPES.WRITE;
  if (intent === 'PATCH_SOURCE') return EXECUTION_UNIT_TYPES.PATCH;
  if (intent.startsWith('RUN_')) return EXECUTION_UNIT_TYPES.RUN_TERMINAL;
  if (VERIFY_INTENTS.has(intent)) return EXECUTION_UNIT_TYPES.VERIFY;
  return EXECUTION_UNIT_TYPES.READ;
}

function resolveTargetPath(intentNode = {}, context = {}, executionType = '') {
  const explicitPath = normalize(intentNode?.outputs?.path || intentNode?.inputs?.path || intentNode?.outputs?.file || intentNode?.inputs?.file || '');
  if (explicitPath) return explicitPath;

  const projectScan = context?.projectScanSnapshot || context?.projectScan || {};
  if (executionType === EXECUTION_UNIT_TYPES.READ) {
    if (upper(intentNode?.intent || '') === 'READ_CONTEXT' || upper(intentNode?.intent || '') === 'PACKAGE_DISCOVERY') {
      if (projectScan?.packageJsonFound === true && projectScan?.packageJsonPath) {
        return normalize(projectScan.packageJsonPath);
      }
      return '';
    }
    if (upper(intentNode?.intent || '') === 'ENTRY_DISCOVERY') {
      return normalize((Array.isArray(projectScan?.entryFiles) && projectScan.entryFiles[0]) || projectScan?.entryFile || '');
    }
  }
  return '';
}

function resolveCommand(intentNode = {}, context = {}) {
  const command = String(intentNode?.inputs?.command || intentNode?.outputs?.command || '').trim();
  if (command) return command;
  const verifiedCommands = Array.isArray(context?.verifiedCommands) ? context.verifiedCommands : [];
  if (verifiedCommands.length > 0) return String(verifiedCommands[0] || '').trim();
  const projectScan = context?.projectScanSnapshot || context?.projectScan || {};
  return String(
    projectScan?.testCommands?.[0] ||
    projectScan?.buildCommands?.[0] ||
    projectScan?.runCommands?.[0] ||
    ''
  ).trim();
}

function preserveAuthority(intentNode = {}, executionUnit = {}) {
  const authority = getIntentAuthority(intentNode);
  executionUnit.authority = authority ? { ...authority } : executionUnit.authority || null;
  executionUnit.authoritySource = authority?.source || intentNode?.authoritySource || executionUnit.authoritySource || null;
  executionUnit.authorityState = intentNode?.authorityState || executionUnit.authorityState || 'candidate';
  executionUnit.metadata = {
    ...(executionUnit.metadata && typeof executionUnit.metadata === 'object' ? executionUnit.metadata : {}),
    authoritySource: executionUnit.authoritySource,
    authorityState: executionUnit.authorityState
  };
  return executionUnit;
}

function preserveIntentMetadata(intentNode = {}, executionUnit = {}) {
  const parentIntentIds = unique(intentNode?.dependencies || []);
  executionUnit.intentId = intentNode?.id || executionUnit.intentId || null;
  executionUnit.parentIntentIds = parentIntentIds;
  executionUnit.metadata = {
    ...(executionUnit.metadata && typeof executionUnit.metadata === 'object' ? executionUnit.metadata : {}),
    intentId: executionUnit.intentId,
    parentIntentIds,
    intent: upper(intentNode?.intent || executionUnit.metadata?.intent || ''),
    requestedKind: getRequestedKind(intentNode) || executionUnit.metadata?.requestedKind || null,
    plannerArtifactId: intentNode?.plannerArtifactId || executionUnit.metadata?.plannerArtifactId || null,
    semanticGoalId: intentNode?.semanticGoalId || executionUnit.metadata?.semanticGoalId || null,
    requirementId: intentNode?.requirementId || executionUnit.metadata?.requirementId || null,
    workspaceCapabilityId: intentNode?.workspaceCapabilityId || executionUnit.metadata?.workspaceCapabilityId || null,
    planningStrategyId: intentNode?.planningStrategyId || executionUnit.metadata?.planningStrategyId || null,
    constraintId: intentNode?.constraintId || executionUnit.metadata?.constraintId || null,
    artifactHash: intentNode?.artifactHash || executionUnit.metadata?.artifactHash || null,
    requestedOperation: intentNode?.requestedOperation || executionUnit.metadata?.requestedOperation || null,
    executionCapability: intentNode?.executionCapability || executionUnit.metadata?.executionCapability || null,
    executionParameters: intentNode?.executionParameters && typeof intentNode.executionParameters === 'object'
      ? { ...intentNode.executionParameters }
      : (executionUnit.metadata?.executionParameters || {})
  };
  executionUnit.dependencies = unique(parentIntentIds);
  executionUnit.inputs = {
    ...(executionUnit.inputs && typeof executionUnit.inputs === 'object' ? executionUnit.inputs : {}),
    intentId: executionUnit.intentId,
    parentIntentIds,
    plannerArtifactId: intentNode?.plannerArtifactId || executionUnit.inputs?.plannerArtifactId || null,
    semanticGoalId: intentNode?.semanticGoalId || executionUnit.inputs?.semanticGoalId || null,
    requirementId: intentNode?.requirementId || executionUnit.inputs?.requirementId || null,
    workspaceCapabilityId: intentNode?.workspaceCapabilityId || executionUnit.inputs?.workspaceCapabilityId || null,
    planningStrategyId: intentNode?.planningStrategyId || executionUnit.inputs?.planningStrategyId || null,
    constraintId: intentNode?.constraintId || executionUnit.inputs?.constraintId || null,
    artifactHash: intentNode?.artifactHash || executionUnit.inputs?.artifactHash || null,
    requestedOperation: intentNode?.requestedOperation || executionUnit.inputs?.requestedOperation || null,
    executionCapability: intentNode?.executionCapability || executionUnit.inputs?.executionCapability || null,
    executionParameters: intentNode?.executionParameters && typeof intentNode.executionParameters === 'object'
      ? { ...intentNode.executionParameters }
      : (executionUnit.inputs?.executionParameters || {})
  };
  return executionUnit;
}

function preserveDependencies(intentNode = {}, executionUnit = {}) {
  const dependencies = unique(intentNode?.dependencies || []);
  executionUnit.dependencies = [...dependencies];
  executionUnit.parentIntentIds = [...dependencies];
  executionUnit.metadata = {
    ...(executionUnit.metadata && typeof executionUnit.metadata === 'object' ? executionUnit.metadata : {}),
    parentIntentIds: [...dependencies],
    provenanceDependencies: [...dependencies]
  };
  return executionUnit;
}

function projectExecutionUnit(intentNode = {}, context = {}) {
  const intent = upper(intentNode?.intent || '');
  const executionType = determineExecutionType(intentNode);
  const dependencyIds = unique(intentNode?.dependencies || []);
  const requestedKind = getRequestedKind(intentNode);
  const explicitUserRequest = requestedKind === 'EXPLICIT_CREATE' || requestedKind === 'EXPLICIT_MODIFICATION' || requestedKind === 'MODIFY' || lower(intentNode?.authoritySource || '') === 'explicit_user_request';
  const targetPath = resolveTargetPath(intentNode, context, executionType);
  const command = resolveCommand(intentNode, context);
  const confidence = Number.isFinite(Number(intentNode?.confidence)) ? Number(intentNode.confidence) : 0.5;
  const authority = getIntentAuthority(intentNode);

  const unit = createExecutionUnit({
    id: intentNode?.id || `${executionType.toLowerCase()}:${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`,
    type: executionType,
    description: String(intentNode?.purpose || intentNode?.description || '').trim() || `Execute ${intent}`,
    targetFiles: targetPath ? [targetPath] : [],
    requiredReads: executionType === EXECUTION_UNIT_TYPES.READ ? (targetPath ? [targetPath] : []) : (executionType === EXECUTION_UNIT_TYPES.PATCH && targetPath ? [targetPath] : []),
    requiredWrites: (executionType === EXECUTION_UNIT_TYPES.WRITE || executionType === EXECUTION_UNIT_TYPES.PATCH) && targetPath ? [targetPath] : [],
    dependencies: [...dependencyIds],
    inputs: {
      ...(intentNode?.inputs && typeof intentNode.inputs === 'object' ? intentNode.inputs : {}),
      intent,
      intentId: intentNode?.id || null,
      parentIntentIds: [...dependencyIds],
      requestedKind
    },
    outputs: {
      ...(intentNode?.outputs && typeof intentNode.outputs === 'object' ? intentNode.outputs : {}),
      path: targetPath || intentNode?.outputs?.path || null,
      file: targetPath || intentNode?.outputs?.file || null,
      command: executionType === EXECUTION_UNIT_TYPES.RUN_TERMINAL ? command : intentNode?.outputs?.command || null
    },
    acceptanceCriteria: Array.isArray(intentNode?.acceptanceCriteria) && intentNode.acceptanceCriteria.length > 0
      ? [...intentNode.acceptanceCriteria]
      : [String(intentNode?.purpose || intentNode?.description || `${intent} is complete`).trim()],
    retryPolicy: intentNode?.retryPolicy && typeof intentNode.retryPolicy === 'object' ? { ...intentNode.retryPolicy } : {},
    verificationPolicy: intentNode?.verificationPolicy && typeof intentNode.verificationPolicy === 'object' ? { ...intentNode.verificationPolicy } : {},
    metadata: {
      ...(intentNode?.metadata && typeof intentNode.metadata === 'object' ? intentNode.metadata : {}),
      intent,
      confidence,
      intentId: intentNode?.id || null,
      parentIntentIds: [...dependencyIds],
      requestedKind,
      plannerArtifactId: intentNode?.plannerArtifactId || intentNode?.metadata?.plannerArtifactId || null,
      semanticGoalId: intentNode?.semanticGoalId || intentNode?.metadata?.semanticGoalId || null,
      requirementId: intentNode?.requirementId || intentNode?.metadata?.requirementId || null,
      workspaceCapabilityId: intentNode?.workspaceCapabilityId || intentNode?.metadata?.workspaceCapabilityId || null,
      planningStrategyId: intentNode?.planningStrategyId || intentNode?.metadata?.planningStrategyId || null,
      constraintId: intentNode?.constraintId || intentNode?.metadata?.constraintId || null,
      artifactHash: intentNode?.artifactHash || intentNode?.metadata?.artifactHash || null,
      requestedOperation: intentNode?.requestedOperation || intentNode?.metadata?.requestedOperation || null,
      executionCapability: intentNode?.executionCapability || intentNode?.metadata?.executionCapability || null,
      executionParameters: intentNode?.executionParameters && typeof intentNode.executionParameters === 'object'
        ? { ...intentNode.executionParameters }
        : (intentNode?.metadata?.executionParameters && typeof intentNode.metadata.executionParameters === 'object'
          ? { ...intentNode.metadata.executionParameters }
          : {}),
      explicitUserRequest,
      requestedFile: explicitUserRequest,
      source: 'execution-projection'
    },
    authority,
    authoritySource: authority?.source || intentNode?.authoritySource || null,
    authorityState: intentNode?.authorityState || 'candidate',
    requestedKind
  });

  preserveIntentMetadata(intentNode, unit);
  preserveAuthority(intentNode, unit);
  preserveDependencies(intentNode, unit);
  unit.plannerArtifactId = intentNode?.plannerArtifactId || unit.plannerArtifactId || null;
  unit.semanticGoalId = intentNode?.semanticGoalId || unit.semanticGoalId || null;
  unit.requirementId = intentNode?.requirementId || unit.requirementId || null;
  unit.workspaceCapabilityId = intentNode?.workspaceCapabilityId || unit.workspaceCapabilityId || null;
  unit.planningStrategyId = intentNode?.planningStrategyId || unit.planningStrategyId || null;
  unit.constraintId = intentNode?.constraintId || unit.constraintId || null;
  unit.artifactHash = intentNode?.artifactHash || unit.artifactHash || null;
  unit.requestedOperation = intentNode?.requestedOperation || unit.requestedOperation || null;
  unit.executionCapability = intentNode?.executionCapability || unit.executionCapability || null;
  unit.executionParameters = intentNode?.executionParameters && typeof intentNode.executionParameters === 'object'
    ? { ...intentNode.executionParameters }
    : (unit.executionParameters && typeof unit.executionParameters === 'object' ? { ...unit.executionParameters } : {});
  unit.intent = intent;
  unit.metadata = {
    ...(unit.metadata && typeof unit.metadata === 'object' ? unit.metadata : {}),
    explicitUserRequest,
    requestedFile: explicitUserRequest,
    provenance: {
      plannerArtifactId: intentNode?.plannerArtifactId || null,
      semanticGoalId: intentNode?.semanticGoalId || null,
      requirementId: intentNode?.requirementId || null,
      workspaceCapabilityId: intentNode?.workspaceCapabilityId || null,
      planningStrategyId: intentNode?.planningStrategyId || null,
      constraintId: intentNode?.constraintId || null,
      artifactHash: intentNode?.artifactHash || null,
      requestedOperation: intentNode?.requestedOperation || null,
      requestedKind,
      executionCapability: intentNode?.executionCapability || null
    }
  };
  unit.provenance = {
    plannerArtifactId: intentNode?.plannerArtifactId || null,
    semanticGoalId: intentNode?.semanticGoalId || null,
    requirementId: intentNode?.requirementId || null,
    workspaceCapabilityId: intentNode?.workspaceCapabilityId || null,
    planningStrategyId: intentNode?.planningStrategyId || null,
    constraintId: intentNode?.constraintId || null,
    authoritySource: authority?.source || intentNode?.authoritySource || null,
    artifactId: intentNode?.plannerArtifactId || intentNode?.id || null,
    artifactHash: intentNode?.artifactHash || null,
    requestedOperation: intentNode?.requestedOperation || null,
    requestedKind,
    executionCapability: intentNode?.executionCapability || null,
    executionParameters: intentNode?.executionParameters && typeof intentNode.executionParameters === 'object'
      ? { ...intentNode.executionParameters }
      : {}
  };

  console.log('[EXECUTION_PROJECTION_NODE]', {
    intentId: unit.intentId,
    executionId: unit.id,
    intent,
    type: unit.type,
    dependencies: [...unit.dependencies]
  });
  for (const dependency of unit.dependencies) {
    console.log('[EXECUTION_PROJECTION_EDGE]', {
      from: dependency,
      to: unit.id
    });
  }
  console.log('[EXECUTION_PROJECTION_AUTHORITY]', {
    intentId: unit.intentId,
    intentAuthority: authority?.source || null,
    executionAuthority: unit.authority?.source || null,
    requestedKind: requestedKind || null
  });

  return unit;
}

function compareAuthority(intentNode = {}, executionUnit = {}) {
  const intentAuthority = getIntentAuthority(intentNode)?.source || intentNode?.authoritySource || null;
  const executionAuthority = executionUnit?.authority?.source || executionUnit?.authoritySource || null;
  if (!intentAuthority || !executionAuthority) return { match: true, intentAuthority, executionAuthority };
  return {
    match: lower(intentAuthority) === lower(executionAuthority),
    intentAuthority,
    executionAuthority
  };
}

function compareProvenance(intentNode = {}, executionUnit = {}) {
  const intentProvenance = intentNode?.provenance || {};
  if (!intentProvenance || Object.keys(intentProvenance).length === 0) {
    return {
      match: true,
      errors: [],
      intentProvenance,
      executionProvenance: executionUnit?.provenance || executionUnit?.metadata?.provenance || {}
    };
  }
  const executionProvenance = executionUnit?.provenance || executionUnit?.metadata?.provenance || {};
  const checks = [];
  const fields = [
    ['plannerArtifactId', 'Missing plannerArtifactId'],
    ['artifactHash', 'Missing artifactHash'],
    ['requirementId', 'Requirement missing'],
    ['workspaceCapabilityId', 'Capability mismatch'],
    ['authoritySource', 'Authority source invalid']
  ];

  for (const [field, missingReason] of fields) {
    const intentValue = intentProvenance[field] || intentNode?.[field] || null;
    const executionValue = executionProvenance[field] || executionUnit?.[field] || null;
    if (!intentValue || !executionValue) {
      checks.push({ field, valid: false, reason: missingReason });
      continue;
    }
    if (String(intentValue).trim() !== String(executionValue).trim()) {
      checks.push({ field, valid: false, reason: `${field} mismatch` });
    }
  }

  const intentDeps = unique(intentProvenance.dependencies || intentNode?.dependencies || []);
  const executionDeps = unique(executionProvenance.dependencies || executionUnit?.dependencies || []);
  if (intentDeps.length !== executionDeps.length || intentDeps.some((dep, index) => dep !== executionDeps[index])) {
    checks.push({ field: 'dependencies', valid: false, reason: 'Dependency chain broken' });
  }

  return {
    match: checks.length === 0,
    errors: checks.map(check => check.reason),
    intentProvenance,
    executionProvenance
  };
}

export function validateProjection(intentGraph = {}, executionUnits = []) {
  const nodes = Array.isArray(intentGraph?.nodes) ? intentGraph.nodes : [];
  const units = Array.isArray(executionUnits) ? executionUnits : [];
  const unitById = new Map(units.map(unit => [unit.intentId || unit.id, unit]));
  const errors = [];

  if (nodes.length !== units.length) {
    errors.push(`Projection node count mismatch: intent=${nodes.length} execution=${units.length}`);
  }

  for (const node of nodes) {
    const unit = unitById.get(node.id);
    if (!unit) {
      errors.push(`Missing projected unit for intent "${node.id}"`);
      continue;
    }

    const expectedDeps = unique(node.dependencies || []);
    const actualDeps = unique(unit.dependencies || []);
    if (expectedDeps.length !== actualDeps.length || expectedDeps.some((dep, index) => dep !== actualDeps[index])) {
      errors.push(`Dependency mismatch for "${node.id}"`);
    }

    const authority = compareAuthority(node, unit);
    if (!authority.match) {
      errors.push(`Authority mismatch for "${node.id}": ${authority.intentAuthority || 'none'} -> ${authority.executionAuthority || 'none'}`);
    }

    const provenance = compareProvenance(node, unit);
    if (!provenance.match) {
      for (const error of provenance.errors) {
        errors.push(`Provenance mismatch for "${node.id}": ${error}`);
      }
    }

    const intent = upper(node.intent || '');
    const type = upper(unit.type || '');
    if (READ_INTENTS.has(intent) && type === EXECUTION_UNIT_TYPES.WRITE) {
      errors.push(`Read intent "${node.id}" projected to WRITE`);
    }
    if ((getRequestedKind(node) === 'DISCOVER_IF_EXISTS' || getRequestedKind(node) === 'REFERENCE_ONLY') && type === EXECUTION_UNIT_TYPES.WRITE) {
      errors.push(`Discovery intent "${node.id}" projected to WRITE`);
    }
  }

  const valid = errors.length === 0;
  console.log(valid ? '[EXECUTION_GRAPH_FIDELITY_PASS]' : '[EXECUTION_GRAPH_FIDELITY_FAIL]', {
    nodeCount: nodes.length,
    unitCount: units.length,
    errorCount: errors.length
  });
  return { valid, errors };
}

export function projectExecutionGraph(intentGraph = {}, context = {}) {
  const nodes = Array.isArray(intentGraph?.nodes) ? intentGraph.nodes : [];
  console.log('[EXECUTION_PROJECTION_START]', {
    intentNodeCount: nodes.length,
    edgeCount: Array.isArray(intentGraph?.edges) ? intentGraph.edges.length : 0
  });

  const projectedUnits = nodes.map(node => projectExecutionUnit(node, context)).filter(Boolean);
  const validation = validateProjection(intentGraph, projectedUnits);
  const executionGraph = createExecutionGraph(projectedUnits);

  console.log('[EXECUTION_PROJECTION_COMPLETE]', {
    intentNodeCount: nodes.length,
    executionUnitCount: projectedUnits.length,
    valid: validation.valid
  });

  return {
    intentGraph,
    executionUnits: projectedUnits,
    executionGraph,
    validation
  };
}

export { projectExecutionUnit, preserveDependencies, preserveAuthority, preserveIntentMetadata };
