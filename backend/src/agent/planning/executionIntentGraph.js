import { AuthoritySource, normalizeAuthoritySource } from '../../planner/authority/AuthoritySource.js';
import { buildExecutionIntentProvenanceGraph } from './executionIntentProvenance.js';
import {
  explainIntentRejection,
  validateIntentArtifact,
  validateIntentCapability,
  validateIntentCommand,
  validateIntentGraphPurity,
  validateIntentSource
} from './intentPurityGuard.js';

const ALLOWED_INTENT_TYPES = new Set([
  'FRAMEWORK_DISCOVERY',
  'PACKAGE_DISCOVERY',
  'VALIDATION_DISCOVERY',
  'ENTRY_DISCOVERY',
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
  'PATCH_SOURCE',
  'RUN_VALIDATION',
  'RUN_BUILD',
  'RUN_TEST',
  'RUN_LINT',
  'VERIFY_RESULT',
  'QUALITY_GATE',
  'FINALIZE',
  'READ_CONTEXT',
  'COLLECT_EVIDENCE',
  'DISCOVER_WORKSPACE',
  'DISCOVER_BLADE',
  'GENERATE_HTML'
]);

const EXECUTABLE_INTENT_TYPES = new Set([
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
  'PATCH_SOURCE',
  'RUN_VALIDATION',
  'RUN_BUILD',
  'RUN_TEST',
  'RUN_LINT',
  'VERIFY_RESULT',
  'QUALITY_GATE',
  'FINALIZE',
  'GENERATE_HTML'
]);

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))];
}

function normalizePath(value = '') {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .trim();
}

function normalizeExecutionIntent(value = '') {
  const intent = String(value || '').trim().toUpperCase();
  if (!intent) return 'READ_CONTEXT';
  return intent;
}

function normalizeEvidence(values = []) {
  return unique((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean));
}

function normalizeSourceValue(value = '') {
  return String(value || '').trim();
}

function mapFrameworkCapability(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === 'generic' || normalized === 'unknown') return null;
  if (['react', 'vite', 'react-vite-ts', 'vite-react', 'vite-react-ts', 'vite/react', 'react/vite', 'react-vite'].includes(normalized)) return 'REACT/VITE';
  if (['next', 'nextjs', 'nextjs-ts', 'next.js'].includes(normalized)) return 'NEXT.JS';
  if (['node', 'node-express', 'express'].includes(normalized)) return 'NODE/EXPRESS';
  if (['php', 'php-plain'].includes(normalized)) return 'PHP';
  if (['static', 'static-html', 'generic-static-html'].includes(normalized)) return 'STATIC/HTML';
  if (['flutter'].includes(normalized)) return 'FLUTTER';
  return String(value || '').trim().toUpperCase();
}

function isAllowedIntentSource(value = '') {
  const normalized = normalizeSourceValue(value).toUpperCase();
  return [
    'EXPLICIT_USER_REQUEST',
    'VERIFIED_PLANNING_CONTEXT',
    'VERIFIED_WORKSPACE_EVIDENCE',
    'WORKSPACE_AUTHORITY',
    'VERIFIED_ARTIFACT_MAPPING',
    'VERIFIED_VALIDATION_COMMAND',
    'APPROVED_EXECUTION_CANDIDATE'
  ].includes(normalized);
}

export function createIntentNode({
  id,
  intent,
  purpose = '',
  capability = null,
  required = true,
  inputs = {},
  outputs = {},
  dependencies = [],
  confidence = 0.5,
  evidence = [],
  executionEligible = false,
  requestedKind = null,
  authority = null,
  authoritySource = null,
  authorityState = null,
  source = null,
  purityStatus = 'unknown'
} = {}) {
  const normalizedIntent = normalizeExecutionIntent(intent);
  if (!ALLOWED_INTENT_TYPES.has(normalizedIntent)) {
    throw new Error(`Unsupported execution intent: ${normalizedIntent}`);
  }
  return {
    id: String(id || `intent:${normalizedIntent.toLowerCase()}`),
    intent: normalizedIntent,
    purpose: String(purpose || '').trim(),
    capability: capability ? String(capability).trim().toUpperCase() : null,
    required: required !== false,
    inputs: inputs && typeof inputs === 'object' ? { ...inputs } : {},
    outputs: outputs && typeof outputs === 'object' ? { ...outputs } : {},
    dependencies: unique(dependencies),
    confidence: Number.isFinite(Number(confidence)) ? Math.max(0, Math.min(1, Number(confidence))) : 0.5,
    evidence: normalizeEvidence(evidence),
    executionEligible: executionEligible === true && EXECUTABLE_INTENT_TYPES.has(normalizedIntent) ? true : false,
    requestedKind: requestedKind ? String(requestedKind).trim().toUpperCase() : null,
    authority: authority && typeof authority === 'object' ? { ...authority } : null,
    authoritySource: authoritySource ? String(authoritySource).trim().toLowerCase() : null,
    authorityState: authorityState ? String(authorityState).trim().toLowerCase() : null,
    source: source ? String(source).trim().toUpperCase() : null,
    purityStatus: purityStatus ? String(purityStatus).trim().toLowerCase() : 'unknown'
  };
}

export function createIntentEdge(from, to, relation = 'depends_on') {
  return {
    from: String(from || '').trim(),
    to: String(to || '').trim(),
    relation: String(relation || 'depends_on').trim() || 'depends_on'
  };
}

function detectFrameworkKey({ projectScanSnapshot = {}, projectIntent = {}, planningContext = {}, objective = '' } = {}) {
  const selectedVariantKey = String(
    planningContext?.selectedImplementation?.selectedVariant?.frameworkKey ||
    projectIntent?.selectedImplementation?.selectedVariant?.frameworkKey ||
    projectIntent?.selectedVariant?.frameworkKey ||
    planningContext?.requestedFramework ||
    projectIntent?.requestedFramework ||
    ''
  ).trim().toLowerCase();
  if (selectedVariantKey) return selectedVariantKey;

  const scanType = String(projectScanSnapshot?.projectType || '').toLowerCase();
  const text = String(objective || projectIntent?.prompt || projectIntent?.objective || '').toLowerCase();
  if (scanType.includes('next') || /\bnext\.?js\b/.test(text)) return 'nextjs-ts';
  if (/\breact\b/.test(text) && /\bcustom\b/.test(text)) return 'react-custom';
  if (scanType.includes('vite') || scanType.includes('react') || /\breact\b/.test(text) || /\bvite\b/.test(text)) return 'react-vite-ts';
  if (scanType.includes('laravel') || /\blaravel\b/.test(text)) return 'laravel';
  if (scanType.includes('flutter') || /\bflutter\b/.test(text)) return 'flutter';
  if (scanType.includes('php') || /\bphp\b/.test(text)) return 'php-plain';
  if (scanType.includes('python') || /\bflask\b/.test(text)) return 'python-flask';
  if (scanType.includes('django') || /\bdjango\b/.test(text)) return 'python-django';
  if (scanType.includes('spring') || /\bspring\b/.test(text)) return 'java-spring';
  if (scanType.includes('html') || /\bstatic\s+html\b/.test(text)) return 'static-html';
  return null;
}

function isKnownFrameworkResolved(frameworkKey = null, projectScanSnapshot = {}, projectIntent = {}, objective = '') {
  return Boolean(
    frameworkKey ||
    projectScanSnapshot?.packageJsonFound === true ||
    Array.isArray(projectScanSnapshot?.entryFiles) && projectScanSnapshot.entryFiles.length > 0 ||
    /\b(next\.?js|react|vite|laravel|php|flutter|django|flask|spring)\b/i.test(String(objective || projectIntent?.prompt || projectIntent?.objective || ''))
  );
}

function classifyPathIntent(path = '', frameworkKey = null) {
  const normalized = normalizePath(path);
  const lower = normalized.toLowerCase();
  if (!normalized) return { intent: 'GENERATE_SOURCE', capability: 'SOURCE' };
  if (/\.test\.(?:ts|tsx|js|jsx)$|\.spec\.(?:ts|tsx|js|jsx)$/.test(lower)) return { intent: 'GENERATE_TEST', capability: 'TEST' };
  if (/\.(?:css|scss|sass|less)$/.test(lower)) return { intent: 'GENERATE_STYLE', capability: 'STYLE' };
  if (/\.(?:png|jpg|jpeg|gif|webp|svg|ico)$/.test(lower)) {
    if (/icon|favicon/.test(lower)) return { intent: 'GENERATE_ICON', capability: 'ICON_SET' };
    return { intent: 'GENERATE_IMAGE', capability: 'IMAGE_ASSET' };
  }
  if (/\.blade\.php$/.test(lower) || /views\/.+\.php$/.test(lower)) return { intent: 'GENERATE_VIEW', capability: 'SOURCE' };
  if (frameworkKey === 'nextjs-ts' && /app\/page\.(?:ts|tsx|js|jsx)$/.test(lower)) return { intent: 'GENERATE_SOURCE', capability: 'APPLICATION_ENTRY' };
  if (frameworkKey === 'react-vite-ts' && /src\/app\.(?:ts|tsx|js|jsx)$/.test(lower)) return { intent: 'GENERATE_COMPONENTS', capability: 'APPLICATION_ENTRY' };
  if (/index\.php$/.test(lower)) return { intent: 'GENERATE_SOURCE', capability: 'APPLICATION_ENTRY' };
  if (/package\.json$/.test(lower)) return { intent: 'PACKAGE_DISCOVERY', capability: 'BUILD' };
  if (/\.(?:json|ya?ml)$/.test(lower)) return { intent: 'GENERATE_CONFIG', capability: 'BUILD' };
  if (/controller/.test(lower)) return { intent: 'GENERATE_CONTROLLER', capability: 'API_LAYER' };
  if (/html?$/.test(lower)) return { intent: 'GENERATE_HTML', capability: 'APPLICATION_ENTRY' };
  if (frameworkKey === 'react-vite-ts' || frameworkKey === 'nextjs-ts') return { intent: 'GENERATE_COMPONENTS', capability: 'APPLICATION_ENTRY' };
  return { intent: 'GENERATE_SOURCE', capability: 'APPLICATION_ENTRY' };
}

function classifyCommandIntent(command = '') {
  const lower = String(command || '').toLowerCase();
  if (!lower) return 'RUN_VALIDATION';
  if (/\btest\b/.test(lower)) return 'RUN_TEST';
  if (/\bbuild\b/.test(lower)) return 'RUN_BUILD';
  if (/\blint\b/.test(lower)) return 'RUN_LINT';
  return 'RUN_VALIDATION';
}

function shouldAddGenerationIntents({ requestedFileDetails = [], artifactCandidates = [] } = {}) {
  return (Array.isArray(requestedFileDetails) ? requestedFileDetails.length > 0 : false) ||
    (Array.isArray(artifactCandidates) ? artifactCandidates.length > 0 : false);
}

export function getExecutableIntentSources() {
  return [
    'EXPLICIT_USER_REQUEST',
    'VERIFIED_PLANNING_CONTEXT',
    'VERIFIED_WORKSPACE_EVIDENCE',
    'WORKSPACE_AUTHORITY',
    'VERIFIED_ARTIFACT_MAPPING',
    'VERIFIED_VALIDATION_COMMAND',
    'APPROVED_EXECUTION_CANDIDATE'
  ];
}

export function sanitizeIntentInput({
  objective = '',
  projectIntent = {},
  projectScanSnapshot = {},
  planningContext = {},
  requestedFileDetails = [],
  artifactCandidates = [],
  plannerApprovedArtifacts = [],
  verifiedCommands = []
} = {}) {
  const forbiddenFields = [
    'bootstrapProfile',
    'templateProfile',
    'domainProfile',
    'landingSignals',
    'knowledgeGraph',
    'projectTypeHint',
    'frameworkCandidates',
    'recommendationCandidates'
  ];

  const sanitizedProjectIntent = {
    prompt: String(projectIntent?.prompt || '').trim(),
    objective: String(projectIntent?.objective || objective || '').trim(),
    goalType: projectIntent?.goalType || null,
    taskIntent: projectIntent?.taskIntent || null
  };
  const sanitizedProjectScan = {
    ...projectScanSnapshot,
    projectType: String(projectScanSnapshot?.projectType || '').trim(),
    packageJsonFound: projectScanSnapshot?.packageJsonFound === true,
    entryFiles: Array.isArray(projectScanSnapshot?.entryFiles) ? [...projectScanSnapshot.entryFiles] : [],
    testCommands: [],
    buildCommands: [],
    runCommands: []
  };
  const sanitizedPlanningContext = {
    ...planningContext,
    bootstrapProfile: null,
    templateProfile: null,
    domainProfile: null,
    knowledgeGraph: null,
    landingSignals: null,
    projectTypeHint: null,
    frameworkCandidates: [],
    constraintGraph: planningContext?.constraintGraph || planningContext?.objectiveConstraintGraph || null,
    planningStrategyGraph: planningContext?.planningStrategyGraph || null,
    objectiveConstraints: Array.isArray(planningContext?.objectiveConstraints) ? [...planningContext.objectiveConstraints] : [],
    planningStrategies: Array.isArray(planningContext?.planningStrategies) ? [...planningContext.planningStrategies] : [],
    initializationStrategies: Array.isArray(planningContext?.initializationStrategies) ? [...planningContext.initializationStrategies] : [],
    requiredFramework: planningContext?.requiredFramework || planningContext?.derived?.requiredFramework || null,
    verifiedCommands: Array.isArray(planningContext?.verifiedCommands) ? [...planningContext.verifiedCommands] : [],
    verifiedFramework: planningContext?.verifiedFramework || planningContext?.derived?.verifiedFramework || null,
    verifiedValidation: planningContext?.verifiedValidation || planningContext?.derived?.verifiedValidation || null
  };

  const sourceSummary = {
    requestedFileDetails: Array.isArray(requestedFileDetails) ? requestedFileDetails.length : 0,
    artifactCandidates: Array.isArray(artifactCandidates) ? artifactCandidates.length : 0,
    plannerApprovedArtifacts: Array.isArray(plannerApprovedArtifacts) ? plannerApprovedArtifacts.length : 0,
    verifiedCommands: Array.isArray(verifiedCommands) ? verifiedCommands.length : 0
  };

  const approvedSources = new Set(getExecutableIntentSources());
  const approvedRequestedFileDetails = [];
  const rejectedRequestedFileDetails = [];
  for (const detail of Array.isArray(requestedFileDetails) ? requestedFileDetails : []) {
    const source = String(detail?.source || detail?.authoritySource || detail?.metadata?.source || detail?.metadata?.authoritySource || '').trim();
    const sourceKey = source.toUpperCase();
    const sourceCheck = validateIntentSource(source || detail?.authoritySource || 'VERIFIED_PLANNING_CONTEXT', detail);
    if (!sourceCheck.valid || (sourceKey && !approvedSources.has(sourceKey))) {
      rejectedRequestedFileDetails.push({
        path: detail?.path || detail?.file || null,
        reason: explainIntentRejection(sourceCheck.reason || 'forbidden requested file source', { source: source || detail?.authoritySource || null })
      });
      continue;
    }
    approvedRequestedFileDetails.push(detail);
  }

  const approvedArtifactCandidates = [];
  const rejectedArtifactCandidates = [];
  for (const artifact of Array.isArray(artifactCandidates) ? artifactCandidates : []) {
    const source = String(artifact?.source || artifact?.authoritySource || artifact?.metadata?.source || artifact?.metadata?.authoritySource || '').trim();
    const sourceKey = source.toUpperCase();
    const sourceCheck = validateIntentSource(source || artifact?.authoritySource || 'VERIFIED_ARTIFACT_MAPPING', artifact);
    if (!sourceCheck.valid || (sourceKey && !approvedSources.has(sourceKey))) {
      rejectedArtifactCandidates.push({
        path: artifact?.path || artifact?.file || null,
        reason: explainIntentRejection(sourceCheck.reason || 'forbidden artifact source', { source: source || artifact?.authoritySource || null })
      });
      continue;
    }
    approvedArtifactCandidates.push(artifact);
  }

  const approvedPlannerArtifacts = [];
  const rejectedPlannerArtifacts = [];
  for (const artifact of Array.isArray(plannerApprovedArtifacts) ? plannerApprovedArtifacts : []) {
    const source = String(artifact?.source || artifact?.authoritySource || artifact?.metadata?.source || artifact?.metadata?.authoritySource || 'VERIFIED_ARTIFACT_MAPPING').trim();
    const sourceKey = source.toUpperCase();
    const sourceCheck = validateIntentSource(source || artifact?.authoritySource || 'VERIFIED_ARTIFACT_MAPPING', artifact);
    if (!sourceCheck.valid || (sourceKey && !approvedSources.has(sourceKey))) {
      rejectedPlannerArtifacts.push({
        artifactId: artifact?.artifactId || null,
        reason: explainIntentRejection(sourceCheck.reason || 'forbidden planner approved artifact source', { source: source || artifact?.authoritySource || null })
      });
      continue;
    }
    approvedPlannerArtifacts.push(artifact);
  }

  const approvedVerifiedCommands = [];
  const rejectedVerifiedCommands = [];
  for (const command of Array.isArray(verifiedCommands) ? verifiedCommands : []) {
    const commandCheck = validateIntentCommand(command, { verifiedCommands: planningContext?.verifiedCommands || verifiedCommands, verifiedValidation: planningContext?.verifiedValidation || planningContext?.derived?.verifiedValidation || null });
    if (!commandCheck.valid) {
      rejectedVerifiedCommands.push({
        command,
        reason: explainIntentRejection(commandCheck.reason, { command })
      });
      continue;
    }
    approvedVerifiedCommands.push(commandCheck.command);
  }

  console.log('[INTENT_INPUT_SANITIZED]', {
    ...sourceSummary,
    requestedFileDetailsApproved: approvedRequestedFileDetails.length,
    requestedFileDetailsRejected: rejectedRequestedFileDetails.length,
    artifactCandidatesApproved: approvedArtifactCandidates.length,
    artifactCandidatesRejected: rejectedArtifactCandidates.length,
    plannerApprovedArtifactsApproved: approvedPlannerArtifacts.length,
    plannerApprovedArtifactsRejected: rejectedPlannerArtifacts.length,
    verifiedCommandsApproved: approvedVerifiedCommands.length,
    verifiedCommandsRejected: rejectedVerifiedCommands.length,
    strippedFields: forbiddenFields
  });

  return {
    objective: String(objective || projectIntent?.objective || projectIntent?.prompt || '').trim(),
    projectIntent: sanitizedProjectIntent,
    projectScanSnapshot: sanitizedProjectScan,
    planningContext: sanitizedPlanningContext,
    requestedFileDetails: approvedRequestedFileDetails,
    artifactCandidates: approvedArtifactCandidates,
    plannerApprovedArtifacts: approvedPlannerArtifacts,
    verifiedCommands: approvedVerifiedCommands,
    rejectedRequestedFileDetails,
    rejectedArtifactCandidates,
    rejectedPlannerArtifacts,
    rejectedVerifiedCommands
  };
}

export function getVerifiedFrameworkCapability({
  planningContext = {},
  projectScanSnapshot = {},
  projectIntent = {}
} = {}) {
  const verifiedFramework = String(
    planningContext?.verifiedFramework ||
    planningContext?.derived?.verifiedFramework ||
    projectScanSnapshot?.verifiedFramework ||
    projectScanSnapshot?.projectType ||
    ''
  ).trim();
  if (!verifiedFramework || ['generic', 'unknown'].includes(verifiedFramework.toLowerCase())) {
    return null;
  }

  const capability = mapFrameworkCapability(verifiedFramework);
  if (!capability) return null;

  const source = String(
    projectIntent?.source ||
    planningContext?.source ||
    projectScanSnapshot?.source ||
    planningContext?.derived?.source ||
    ''
  ).trim();
  if (source && !isAllowedIntentSource(source)) {
    return null;
  }
  return capability;
}

export function getVerifiedValidationIntents({
  planningContext = {},
  projectScanSnapshot = {},
  verifiedCommands = []
} = {}) {
  const approvedCommands = [
    ...(Array.isArray(planningContext?.verifiedCommands) ? planningContext.verifiedCommands : []),
    ...(Array.isArray(projectScanSnapshot?.verifiedCommands) ? projectScanSnapshot.verifiedCommands : []),
    ...(Array.isArray(verifiedCommands) ? verifiedCommands : [])
  ].map(command => String(command || '').trim()).filter(Boolean);

  const uniqueCommands = unique(approvedCommands);
  const intents = [];
  for (const command of uniqueCommands) {
    const intent = classifyCommandIntent(command);
    if (intent === 'RUN_TEST' || intent === 'RUN_BUILD' || intent === 'RUN_LINT' || intent === 'RUN_VALIDATION') {
      intents.push({
        intent,
        command
      });
    }
  }
  return intents;
}

export function assertIntentPurity(graph = {}, context = {}) {
  const validation = validateIntentGraphPurity(graph, context);
  if (!validation.valid) {
    console.log('[INTENT_PURITY_CHECK_FAIL]', {
      nodeCount: Array.isArray(graph?.nodes) ? graph.nodes.length : 0,
      errorCount: validation.errors.length
    });
    return {
      valid: false,
      errors: validation.errors
    };
  }

  console.log('[INTENT_PURITY_CHECK_PASS]', {
    nodeCount: Array.isArray(graph?.nodes) ? graph.nodes.length : 0,
    errorCount: 0
  });
  return { valid: true, errors: [] };
}

export function rejectImpureIntent(reason = '', details = {}) {
  const message = explainIntentRejection(reason, details);
  console.log('[INTENT_REJECTED_IMPURE_SOURCE]', {
    reason: message,
    details
  });
  return {
    valid: false,
    reason: message
  };
}

export function buildExecutionIntentGraph({
  objective = '',
  projectIntent = {},
  projectScanSnapshot = {},
  planningContext = {},
  requestedFileDetails = [],
  artifactCandidates = [],
  plannerApprovedArtifacts = [],
  verifiedCommands = []
} = {}) {
  const sanitized = sanitizeIntentInput({
    objective,
    projectIntent,
    projectScanSnapshot,
    planningContext,
    requestedFileDetails,
    artifactCandidates,
    plannerApprovedArtifacts,
    verifiedCommands
  });
  const provenanceMode = Array.isArray(sanitized.plannerApprovedArtifacts) && sanitized.plannerApprovedArtifacts.length > 0;
  if (provenanceMode) {
    const provenanceGraph = buildExecutionIntentProvenanceGraph({
      plannerApprovedArtifacts: sanitized.plannerApprovedArtifacts,
      planningContext: sanitized.planningContext,
      projectScanSnapshot: sanitized.projectScanSnapshot,
      objective: sanitized.objective
    });
    const graph = {
      objective: String(sanitized.objective || sanitized.projectIntent?.objective || sanitized.projectIntent?.prompt || '').trim(),
      frameworkKey: null,
      frameworkResolved: true,
      blockedReason: provenanceGraph.validation.valid ? null : 'EXECUTION_INTENT_PROVENANCE_FAIL',
      nodes: provenanceGraph.intentGraph.nodes,
      edges: provenanceGraph.intentGraph.edges,
      provenanceValidation: provenanceGraph.validation
    };
    const purityValidation = assertIntentPurity(graph, {
      planningContext: sanitized.planningContext,
      projectScanSnapshot: sanitized.projectScanSnapshot,
      plannerApprovedArtifacts: sanitized.plannerApprovedArtifacts,
      approvedArtifactCandidates: sanitized.plannerApprovedArtifacts,
      verifiedCommands: sanitized.verifiedCommands
    });
    if (!purityValidation.valid) {
      for (const error of purityValidation.errors) {
        rejectImpureIntent(error, { objective: sanitized.objective });
      }
    }
    console.log('[EXECUTION_INTENT_GRAPH_COMPLETE]', {
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      executableNodeCount: graph.nodes.filter(node => node.executionEligible === true).length
    });
    return graph;
  }
  const frameworkKey = detectFrameworkKey({
    projectScanSnapshot: sanitized.projectScanSnapshot,
    projectIntent: sanitized.projectIntent,
    planningContext: sanitized.planningContext,
    objective: sanitized.objective
  });
  const verifiedFrameworkCapability = getVerifiedFrameworkCapability({
    planningContext: sanitized.planningContext,
    projectScanSnapshot: sanitized.projectScanSnapshot,
    projectIntent: sanitized.projectIntent
  });
  const frameworkResolved = isKnownFrameworkResolved(frameworkKey, sanitized.projectScanSnapshot, sanitized.projectIntent, sanitized.objective);
  const hasGenerationTargets = shouldAddGenerationIntents({ requestedFileDetails: sanitized.requestedFileDetails, artifactCandidates: sanitized.artifactCandidates });
  const verifiedValidationIntents = getVerifiedValidationIntents({
    planningContext: sanitized.planningContext,
    projectScanSnapshot: sanitized.projectScanSnapshot,
    verifiedCommands: sanitized.verifiedCommands
  });
  const hasValidationSignals = verifiedValidationIntents.length > 0;
  const hasExecutableWork = hasGenerationTargets || verifiedValidationIntents.length > 0 || (Array.isArray(sanitized.requestedFileDetails) && sanitized.requestedFileDetails.some(detail => String(detail?.requestedKind || detail?.kind || '').toUpperCase() === 'EXPLICIT_CREATE'));

  const nodes = [];
  const edges = [];
  const addNode = (spec) => {
    const node = createIntentNode(spec);
    nodes.push(node);
    console.log('[EXECUTION_INTENT_CREATED]', {
      id: node.id,
      intent: node.intent,
      capability: node.capability,
      dependencyCount: node.dependencies.length,
      executionEligible: node.executionEligible === true
    });
    return node;
  };
  const addEdge = (from, to) => {
    const edge = createIntentEdge(from, to);
    edges.push(edge);
    console.log('[EXECUTION_INTENT_EDGE]', edge);
    return edge;
  };

  console.log('[EXECUTION_INTENT_GRAPH_START]', {
    objectiveLength: String(sanitized.objective || sanitized.projectIntent?.objective || sanitized.projectIntent?.prompt || '').length,
    frameworkKey,
    frameworkResolved,
    generationTargets: hasGenerationTargets,
    validationSignals: hasValidationSignals
  });

  const root = addNode({
    id: 'intent:read-context',
    intent: 'READ_CONTEXT',
    purpose: 'Read workspace and objective context before semantic discovery',
    capability: 'DISCOVER_WORKSPACE',
    source: 'VERIFIED_PLANNING_CONTEXT',
    purityStatus: 'pure',
    authoritySource: 'verified_planning_context',
    authority: { source: 'verified_planning_context' },
    evidence: ['objective', 'workspace', 'context']
  });

  const framework = addNode({
    id: 'intent:framework-discovery',
    intent: 'FRAMEWORK_DISCOVERY',
    purpose: 'Infer the workspace framework and structural constraints',
    capability: verifiedFrameworkCapability,
    dependencies: [root.id],
    source: 'VERIFIED_PLANNING_CONTEXT',
    purityStatus: verifiedFrameworkCapability ? 'verified' : 'discovery',
    authoritySource: 'verified_planning_context',
    authority: { source: 'verified_planning_context' },
    evidence: [
      `frameworkResolved:${frameworkResolved}`,
      verifiedFrameworkCapability ? `frameworkCapability:${verifiedFrameworkCapability}` : 'frameworkCapability:null'
    ]
  });
  addEdge(root.id, framework.id);

  let validationDiscovery = null;
  if (frameworkResolved || hasValidationSignals || hasGenerationTargets) {
    validationDiscovery = addNode({
      id: 'intent:validation-discovery',
      intent: 'VALIDATION_DISCOVERY',
      purpose: 'Determine validation commands and guardrails',
      capability: 'VALIDATION',
      dependencies: [framework.id],
      source: 'VERIFIED_PLANNING_CONTEXT',
      purityStatus: hasValidationSignals ? 'verified' : 'discovery',
      authoritySource: 'verified_planning_context',
      authority: { source: 'verified_planning_context' },
      evidence: [
        `validationSignals:${hasValidationSignals}`,
        `frameworkResolved:${frameworkResolved}`
      ]
    });
    addEdge(framework.id, validationDiscovery.id);
  }

  let entryDiscovery = null;
  const needsEntryDiscovery = frameworkResolved && (
    frameworkKey === 'react-vite-ts' ||
    frameworkKey === 'nextjs-ts' ||
    frameworkKey === 'laravel' ||
    frameworkKey === 'php-plain' ||
    frameworkKey === 'static-html'
  );
  if (needsEntryDiscovery) {
    entryDiscovery = addNode({
      id: 'intent:entry-discovery',
      intent: 'ENTRY_DISCOVERY',
      purpose: 'Determine the primary entry surface before generating components',
      capability: 'APPLICATION_ENTRY',
      dependencies: [framework.id],
      source: 'VERIFIED_PLANNING_CONTEXT',
      purityStatus: 'discovery',
      authoritySource: 'verified_planning_context',
      authority: { source: 'verified_planning_context' },
      evidence: [`frameworkKey:${frameworkKey}`]
    });
    addEdge(framework.id, entryDiscovery.id);
  }

  const generationSpecs = [];
  const explicitTargets = [
    ...(Array.isArray(sanitized.requestedFileDetails) ? sanitized.requestedFileDetails : []),
    ...(Array.isArray(sanitized.artifactCandidates) ? sanitized.artifactCandidates : [])
  ];
  for (const item of explicitTargets) {
    const path = normalizePath(item?.path || item?.suggestedPath || item?.targetPath || '');
    if (!path) continue;
    const classification = classifyPathIntent(path, frameworkKey);
    const source = normalizeSourceValue(item?.source || item?.authoritySource || item?.metadata?.source || item?.metadata?.authoritySource || (item?.requestedKind === 'EXPLICIT_CREATE' ? 'EXPLICIT_USER_REQUEST' : 'VERIFIED_ARTIFACT_MAPPING'));
    generationSpecs.push({
      id: `intent:${classification.intent.toLowerCase()}:${path.toLowerCase()}`,
      intent: classification.intent,
      purpose: `Generate ${path}`,
      capability: classification.capability,
      required: item?.required !== false,
      inputs: {
        path,
        requestedKind: item?.requestedKind || item?.kind || null
      },
      outputs: {
        path
      },
      evidence: normalizeEvidence([
        `path:${path}`,
        item?.source ? `source:${item.source}` : null
      ]),
      confidence: Number.isFinite(Number(item?.confidence)) ? Number(item.confidence) : 0.6,
      requestedKind: item?.requestedKind || item?.kind || null,
      authoritySource: item?.authoritySource || item?.authority?.source || (String(item?.requestedKind || item?.kind || '').toUpperCase() === 'EXPLICIT_CREATE' ? 'explicit_user_request' : null),
      authority: item?.authority || (item?.authoritySource || item?.authority?.source ? { source: item?.authoritySource || item?.authority?.source } : null),
      source: source.toUpperCase(),
      purityStatus: isAllowedIntentSource(source) ? 'pure' : 'rejected',
      executionEligible: false
    });
  }

  const seenGenerationIds = new Set();
  for (const spec of generationSpecs) {
    if (seenGenerationIds.has(spec.id)) continue;
    seenGenerationIds.add(spec.id);
    if (!isAllowedIntentSource(spec.source)) {
      rejectImpureIntent('generation spec rejected', { id: spec.id, source: spec.source });
      continue;
    }
    const dependencies = [validationDiscovery?.id || framework.id];
    if (spec.intent === 'GENERATE_COMPONENTS' && entryDiscovery) {
      dependencies.push(entryDiscovery.id);
    }
    if (spec.intent === 'GENERATE_TEST') {
      dependencies.push(validationDiscovery?.id || framework.id);
    }
    if (spec.intent === 'GENERATE_STYLE' || spec.intent === 'GENERATE_ASSET' || spec.intent === 'GENERATE_ICON' || spec.intent === 'GENERATE_IMAGE') {
      // Independent asset/style generation can flow in parallel after framework discovery.
      dependencies.length = 0;
    }
    const node = addNode({
      ...spec,
      dependencies: dependencies.filter(Boolean)
    });
    for (const dep of node.dependencies) {
      addEdge(dep, node.id);
    }
  }

  const validationCommands = unique([
    ...(Array.isArray(sanitized.verifiedCommands) ? sanitized.verifiedCommands : [])
  ]);
  const validationRunNodes = [];
  for (const validationIntent of verifiedValidationIntents) {
    const intent = String(validationIntent.intent || '').toUpperCase();
    const command = String(validationIntent.command || '').trim();
    if (!intent || !command) continue;
    const runNodeId = `intent:${intent.toLowerCase()}:${validationCommands.indexOf(command) >= 0 ? validationCommands.indexOf(command) : validationRunNodes.length}`;
    const runNode = addNode({
      id: runNodeId,
      intent,
      purpose: intent === 'RUN_TEST'
        ? 'Execute the test suite after test files are generated'
        : (intent === 'RUN_BUILD'
          ? 'Run the verified build command'
          : (intent === 'RUN_LINT'
            ? 'Run the verified lint command'
            : 'Run the verified validation command')),
      capability: intent === 'RUN_BUILD' ? 'BUILD' : (intent === 'RUN_LINT' ? 'LINT' : (intent === 'RUN_VALIDATION' ? 'VALIDATION' : 'TEST')),
      dependencies: intent === 'RUN_TEST' && generationSpecs.some(spec => spec.intent === 'GENERATE_TEST')
        ? generationSpecs.filter(spec => spec.intent === 'GENERATE_TEST').map(spec => spec.id)
        : [validationDiscovery?.id || framework.id],
      authoritySource: 'verified_planning_context',
      authority: { source: 'verified_planning_context' },
      inputs: {
        commands: [command],
        command
      },
      evidence: [`command:${command}`],
      confidence: 0.8,
      source: 'VERIFIED_VALIDATION_COMMAND',
      purityStatus: 'verified'
    });
    for (const dep of runNode.dependencies) addEdge(dep, runNode.id);
    validationRunNodes.push(runNode);
  }

  if (validationRunNodes.length > 0) {
    const verify = addNode({
      id: 'intent:verify-result',
      intent: 'VERIFY_RESULT',
      purpose: 'Verify execution result after validation execution',
      capability: 'VALIDATION',
      dependencies: validationRunNodes.map(node => node.id),
      source: 'VERIFIED_PLANNING_CONTEXT',
      purityStatus: 'verified',
      authoritySource: 'verified_planning_context',
      authority: { source: 'verified_planning_context' },
      confidence: 0.9
    });
    for (const dep of verify.dependencies) addEdge(dep, verify.id);

    const qualityGate = addNode({
      id: 'intent:quality-gate',
      intent: 'QUALITY_GATE',
      purpose: 'Run quality gate after verification',
      capability: 'VALIDATION',
      dependencies: [verify.id],
      source: 'VERIFIED_PLANNING_CONTEXT',
      purityStatus: 'verified',
      authoritySource: 'verified_planning_context',
      authority: { source: 'verified_planning_context' },
      confidence: 0.9
    });
    addEdge(verify.id, qualityGate.id);

    const finalize = addNode({
      id: 'intent:finalize',
      intent: 'FINALIZE',
      purpose: 'Finalize after the quality gate passes',
      capability: 'VALIDATION',
      dependencies: [qualityGate.id],
      source: 'VERIFIED_PLANNING_CONTEXT',
      purityStatus: 'verified',
      authoritySource: 'verified_planning_context',
      authority: { source: 'verified_planning_context' },
      confidence: 0.95
    });
    addEdge(qualityGate.id, finalize.id);
  } else if (frameworkResolved && hasGenerationTargets) {
    const verify = addNode({
      id: 'intent:verify-result',
      intent: 'VERIFY_RESULT',
      purpose: 'Verify the generated artifacts',
      capability: 'VALIDATION',
      dependencies: generationSpecs.length > 0 ? generationSpecs.map(spec => spec.id) : [framework.id],
      source: 'VERIFIED_PLANNING_CONTEXT',
      purityStatus: 'verified',
      authoritySource: 'verified_planning_context',
      authority: { source: 'verified_planning_context' },
      confidence: 0.85
    });
    for (const dep of verify.dependencies) addEdge(dep, verify.id);
  }

  const graph = {
    objective: String(sanitized.objective || sanitized.projectIntent?.objective || sanitized.projectIntent?.prompt || '').trim(),
    frameworkKey,
    frameworkResolved,
    blockedReason: !hasExecutableWork ? 'PLANNER_BLOCKED_NO_APPROVED_INTENTS' : null,
    nodes,
    edges
  };

  if (!hasExecutableWork) {
    console.log('[PLANNER_BLOCKED_NO_APPROVED_INTENTS]', {
      reason: 'no verified executable intents were approved',
      requestedFileCount: sanitized.requestedFileDetails.length,
      artifactCandidateCount: sanitized.artifactCandidates.length,
      verifiedCommandCount: sanitized.verifiedCommands.length
    });
  }

  const purityValidation = assertIntentPurity(graph, {
    verifiedFramework: verifiedFrameworkCapability,
    planningContext: sanitized.planningContext,
    projectScanSnapshot: sanitized.projectScanSnapshot,
    verifiedCommands: sanitized.verifiedCommands,
    approvedArtifactCandidates: sanitized.artifactCandidates,
    explicitRequestedFiles: sanitized.requestedFileDetails
  });
  if (!purityValidation.valid) {
    for (const error of purityValidation.errors) {
      rejectImpureIntent(error, { objective: sanitized.objective });
    }
  }

  console.log('[EXECUTION_INTENT_GRAPH_COMPLETE]', {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    executableNodeCount: nodes.filter(node => node.executionEligible === true).length
  });

  return graph;
}

export function validateIntentGraph(graph = {}) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const nodeIds = new Set(nodes.map(node => node.id));
  const errors = [];

  for (const node of nodes) {
    if (!ALLOWED_INTENT_TYPES.has(normalizeExecutionIntent(node.intent))) {
      errors.push(`Unsupported intent: ${node.intent}`);
    }
    if (node.executionEligible === true) {
      errors.push(`Intent node ${node.id} must not be execution eligible before dependency resolution`);
    }
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.from)) errors.push(`Missing edge source: ${edge.from}`);
    if (!nodeIds.has(edge.to)) errors.push(`Missing edge target: ${edge.to}`);
  }

  const visiting = new Set();
  const visited = new Set();
  const walk = (id, stack = []) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      errors.push(`Intent cycle detected: ${[...stack, id].join(' -> ')}`);
      return;
    }
    visiting.add(id);
    const node = nodes.find(entry => entry.id === id);
    if (node) {
      for (const dep of Array.isArray(node.dependencies) ? node.dependencies : []) {
        walk(dep, [...stack, id]);
      }
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const node of nodes) walk(node.id);

  return { valid: errors.length === 0, errors };
}

export function resolveIntentDependencies(intentGraph = {}, context = {}) {
  const nodes = Array.isArray(intentGraph?.nodes) ? intentGraph.nodes : [];
  const byId = new Map(nodes.map(node => [node.id, node]));
  const memo = new Map();
  const levelOf = (id) => {
    if (memo.has(id)) return memo.get(id);
    const node = byId.get(id);
    const deps = unique(node?.dependencies || []).filter(dep => byId.has(dep));
    const level = deps.length === 0 ? 0 : 1 + Math.max(...deps.map(dep => levelOf(dep)));
    memo.set(id, level);
    return level;
  };
  for (const id of byId.keys()) levelOf(id);
  const levels = [];
  for (const node of nodes) {
    const level = memo.get(node.id) || 0;
    if (!levels[level]) levels[level] = [];
    levels[level].push({ ...node, executionEligible: false });
  }
  return {
    intentGraph,
    context,
    levels: levels.filter(Boolean),
    executionEligible: false
  };
}

export { EXECUTABLE_INTENT_TYPES, ALLOWED_INTENT_TYPES, normalizeExecutionIntent };
