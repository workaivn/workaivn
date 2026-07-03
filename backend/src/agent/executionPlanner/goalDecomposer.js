import crypto from 'node:crypto';
import { createExecutionUnit, EXECUTION_UNIT_TYPES } from './executionUnit.js';
import { REQUESTED_FILE_KIND, classifyRequestedFiles } from '../acceptanceCriteria.js';
import { detectProjectInitialization } from '../planner/context/ProjectInitializationDetector.js';
import { AuthoritySource } from '../../planner/authority/AuthoritySource.js';

import { createDerivedRequestedFileDetails } from '../planner/context/PlanningContextBuilder.js';
import { generateArtifactCandidates } from '../planner/artifactCandidateGenerator.js';
import { verifyArtifactCandidates } from '../planner/artifactCandidateVerifier.js';
import { buildExecutionIntentGraph } from '../planning/executionIntentGraph.js';
import { resolveExecutionDependencies } from '../planning/dependencyResolver.js';

const KNOWN_CONFIG_FILES = /(?:^|\/)(?:package|tsconfig|composer|vite\.config|next\.config|nuxt\.config)\.js$/i;

function enforceCanonicalExtension(path = '') {
  const normalized = String(path || '').replace(/\\/g, '/').trim();
  if (KNOWN_CONFIG_FILES.test(normalized)) {
    const corrected = normalized.replace(/\.js$/i, '.json');
    console.log('[PACKAGE_JSON_CANONICAL]', {
      original: path,
      corrected,
      note: 'Forced .json extension for known config file'
    });
    return corrected;
  }
  return normalized;
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))];
}

function normalize(value = '') {
  return String(value || '').replace(/\\/g, '/').trim();
}

function createWorkspaceFileSet(verifiedPlanningContext = {}, projectScan = {}, workspaceState = {}) {
  return new Set([
    ...(Array.isArray(workspaceState?.existingFiles) ? workspaceState.existingFiles : []),
    ...(Array.isArray(verifiedPlanningContext?.verifiedFiles) ? verifiedPlanningContext.verifiedFiles : []),
    ...(Array.isArray(projectScan?.discoveredFiles) ? projectScan.discoveredFiles : []),
    ...(Array.isArray(projectScan?.files) ? projectScan.files : []),
    ...(Array.isArray(verifiedPlanningContext?.facts?.discoveredFiles) ? verifiedPlanningContext.facts.discoveredFiles : [])
  ].map(file => normalize(file).toLowerCase()).filter(Boolean));
}

function toRequestedFileDetails(value = [], { plannedNewFiles = [], explicitRequestedNewFiles = [] } = {}) {
  const plannedSet = new Set(unique(plannedNewFiles).map(file => enforceCanonicalExtension(normalize(file)).toLowerCase()));
  const explicitSet = new Set(unique(explicitRequestedNewFiles).map(file => enforceCanonicalExtension(normalize(file)).toLowerCase()));
  return (Array.isArray(value) ? value : [])
    .map(detail => {
      if (typeof detail === 'string') {
        const path = enforceCanonicalExtension(normalize(detail));
        return {
          path,
          canonicalPath: path,
          requestedKind: null,
          authoritySource: AuthoritySource.VERIFIED_PLANNING_CONTEXT,
          conditional: false,
          explicit: false,
          verified: false,
          plannedNewFile: plannedSet.has(path.toLowerCase()) || explicitSet.has(path.toLowerCase())
        };
      }

      const path = enforceCanonicalExtension(normalize(detail?.path || detail?.file || detail?.target || detail?.name || ''));
      if (!path) return null;
      const lower = path.toLowerCase();
      const requestedKind = detail?.requestedKind || detail?.kind || null;
      const authoritySource = detail?.authoritySource || 'verified_planning_context';
      const conditional = detail?.conditional === true;
      const explicit = detail?.explicit === true;
      const verified = detail?.verified === true;
      const plannedNewFile = detail?.plannedNewFile === true
        || plannedSet.has(lower)
        || explicitSet.has(lower)
        || requestedKind === REQUESTED_FILE_KIND.EXPLICIT_CREATE;

      return {
        ...detail,
        path,
        canonicalPath: path,
        requestedKind,
        authoritySource,
        conditional,
        explicit,
        verified,
        plannedNewFile
      };
    })
    .filter(Boolean);
}

function inferObjectiveKind(objective = '') {
  const text = String(objective || '').toLowerCase();
  if (/\b(read|inspect|open|view|show|examine|analyze)\b/.test(text)) return 'READ';
  if (/\b(create|write|add|implement|generate|build|construct|modify|update|change|edit|patch|replace|refactor|fix|delete|remove|rename)\b/.test(text)) return 'WRITE';
  return 'ANALYZE';
}

function extractRequestedFileDetailsFromIntent(objective = '', verifiedPlanningContext = {}, canonicalFileUniverse = [], explicitRequestedNewFiles = [], {
  projectIntent = {},
  projectScan = {},
  workspaceState = {},
  bootstrapProfile = null
} = {}) {
  const workspaceExistingFiles = unique([
    ...(Array.isArray(workspaceState?.existingFiles) ? workspaceState.existingFiles : []),
    ...(Array.isArray(verifiedPlanningContext?.verifiedFiles) ? verifiedPlanningContext.verifiedFiles : []),
    ...(Array.isArray(verifiedPlanningContext?.facts?.entryFiles) ? verifiedPlanningContext.facts.entryFiles : [])
  ]);
  const planningRequestedFileDetails = toRequestedFileDetails(
    verifiedPlanningContext?.requestedFileDetails || verifiedPlanningContext?.facts?.requestedFileDetails || [],
    {
      plannedNewFiles: verifiedPlanningContext?.plannedNewFiles || verifiedPlanningContext?.facts?.plannedNewFiles || [],
      explicitRequestedNewFiles: [
        ...(Array.isArray(explicitRequestedNewFiles) ? explicitRequestedNewFiles : []),
        ...(Array.isArray(verifiedPlanningContext?.explicitRequestedNewFiles) ? verifiedPlanningContext.explicitRequestedNewFiles : [])
      ]
    }
  );
  if (planningRequestedFileDetails.length > 0) {
    for (const detail of planningRequestedFileDetails) {
      console.log('[REQUESTED_FILE_IMPORTED]', {
        path: detail.path,
        requestedKind: detail.requestedKind || null,
        authoritySource: detail.authoritySource || null,
        plannedNewFile: detail.plannedNewFile === true
      });
    }
    return planningRequestedFileDetails;
  }

  const REQUIRE_FILES_RE = /(?:\b(?:file|files|path|paths)\b[:\s]+)?([A-Za-z0-9_.\-\\/]+\.(?:json|jsx|mjs|cjs|tsx|ts|js|html|css|php|py|cs|dart|yaml|yml|md))/gi;
  const prompt = String(objective || '');
  const promptFiles = unique(Array.from(prompt.matchAll(REQUIRE_FILES_RE), m => enforceCanonicalExtension(normalize(m[1]))));
  const contextFiles = unique([
    ...(Array.isArray(verifiedPlanningContext?.verifiedFiles) ? verifiedPlanningContext.verifiedFiles : []),
    ...(Array.isArray(verifiedPlanningContext?.facts?.requestedFiles) ? verifiedPlanningContext.facts.requestedFiles : []),
    ...(Array.isArray(verifiedPlanningContext?.facts?.entryFiles) ? verifiedPlanningContext.facts.entryFiles : []),
    ...(Array.isArray(explicitRequestedNewFiles) ? explicitRequestedNewFiles : [])
  ].map(file => enforceCanonicalExtension(normalize(file))));
  const requested = unique([...promptFiles, ...contextFiles]);
  const classified = classifyRequestedFiles(prompt, requested);
  const explicitSet = new Set(unique(explicitRequestedNewFiles).map(file => enforceCanonicalExtension(normalize(file)).toLowerCase()));
  const workspace = workspaceState && typeof workspaceState === 'object' ? workspaceState : (verifiedPlanningContext?.workspace || {});
  const projectScanContext = projectScan && typeof projectScan === 'object' ? projectScan : (verifiedPlanningContext?.projectScan || verifiedPlanningContext?.facts || {});
  const workspaceFileSet = createWorkspaceFileSet(verifiedPlanningContext, projectScanContext, workspace);

  const baseDetails = classified.map(detail => {
    const path = enforceCanonicalExtension(normalize(detail.path));
    const exists = workspaceFileSet.has(path.toLowerCase());
    const isExplicitNew = explicitSet.has(path.toLowerCase());
    const objectiveSuggestsModification = /\b(modify|edit|patch|update|change|refactor|fix|replace|remove|delete|rename)\b/i.test(String(objective || ''));
    const requestedKind = isExplicitNew
      ? REQUESTED_FILE_KIND.EXPLICIT_CREATE
      : (exists && objectiveSuggestsModification
        ? REQUESTED_FILE_KIND.EXPLICIT_MODIFICATION
        : (detail.kind || REQUESTED_FILE_KIND.REFERENCE_ONLY));
    const isExecutableWrite = requestedKind === REQUESTED_FILE_KIND.EXPLICIT_CREATE || requestedKind === REQUESTED_FILE_KIND.EXPLICIT_MODIFICATION;
    const isReadOnlyKind = requestedKind === REQUESTED_FILE_KIND.REFERENCE_ONLY || requestedKind === REQUESTED_FILE_KIND.DISCOVER_IF_EXISTS || requestedKind === REQUESTED_FILE_KIND.CONDITIONAL;
    const isBlockedKind = requestedKind === REQUESTED_FILE_KIND.DERIVED;
    return {
      path,
      canonicalPath: path,
      kind: requestedKind,
      requestedKind,
      authoritySource: isExplicitNew
        ? 'explicit_user_request'
        : (exists && objectiveSuggestsModification
          ? 'workspace_derived'
          : (detail.authoritySource || 'explicit_user_request')),
      conditional: isExplicitNew ? false : detail.conditional === true,
      explicit: isExplicitNew ? true : !(exists && objectiveSuggestsModification) && detail.explicit !== false,
      verified: exists || detail.verified === true,
      executableWrite: isExecutableWrite,
      readOnly: isReadOnlyKind,
      blocked: isBlockedKind
    };
  });

  return createDerivedRequestedFileDetails({
    objective,
    projectIntent,
    workspaceState: { ...workspace, existingFiles: workspaceExistingFiles },
    projectScan: projectScanContext,
    bootstrapProfile,
    requestedFileDetails: baseDetails
  });
}

function extractTargetFilesFromIntent(objective = '', verifiedPlanningContext = {}, canonicalFileUniverse = [], explicitRequestedNewFiles = []) {
  const details = extractRequestedFileDetailsFromIntent(objective, verifiedPlanningContext, canonicalFileUniverse, explicitRequestedNewFiles);
  const prompt = String(objective || '');
  const explicitFiles = details.filter(detail => detail.executableWrite).map(detail => detail.path);
  const readOnlyFiles = details.filter(detail => detail.readOnly).map(detail => detail.path);
  const blockedFiles = details.filter(detail => detail.blocked).map(detail => detail.path);

  if (blockedFiles.length > 0) {
    console.log('[DERIVED_FILE_BLOCKED]', { paths: blockedFiles });
  }

  if (explicitFiles.length > 0 || readOnlyFiles.length > 0) {
    return unique([...readOnlyFiles, ...explicitFiles]);
  }

  if (/saas|landing page|marketing site|homepage|hero/i.test(prompt)) {
    return ['src/Hero.jsx', 'src/Features.jsx', 'src/Pricing.jsx'];
  }

  if (/dashboard|admin panel|admin dashboard/i.test(prompt)) {
    return ['src/Dashboard.jsx', 'src/Sidebar.jsx', 'src/Overview.jsx'];
  }

  return [];
}

function buildValidationCommandUnit({ verifiedCommands = [], dependencyId = null, objective = '' } = {}) {
  const command = unique(verifiedCommands)[0] || null;
  if (!command) return null;
  return createExecutionUnit({
    id: `validate:${crypto.randomUUID()}`,
    type: EXECUTION_UNIT_TYPES.VALIDATE,
    description: `Validate the completed changes with ${command}`,
    targetFiles: [],
    requiredReads: [],
    requiredWrites: [],
    dependencies: dependencyId ? [dependencyId] : [],
    inputs: { command, objective: String(objective || '') },
    outputs: { command },
    acceptanceCriteria: [`Validation command succeeds: ${command}`],
    retryPolicy: { maxAttempts: 2, mode: 'validation' },
    verificationPolicy: { requiresTerminal: true, command },
    metadata: { command },
    authoritySource: AuthoritySource.VERIFIED_PLANNING_CONTEXT,
    authorityState: 'candidate'
  });
}

function buildObjectiveAuthorityFiles({
  objective = '',
  projectIntent = {},
  workspaceState = {}
} = {}) {
  const text = String(objective || projectIntent?.prompt || projectIntent?.objective || '').trim();
  const lower = text.toLowerCase();
  const requestedFramework = String(projectIntent?.requestedFramework || '').toLowerCase();
  const workspaceEmpty = !Array.isArray(workspaceState?.existingFiles) || workspaceState.existingFiles.length === 0;
  if (!workspaceEmpty) return [];

  if (requestedFramework === 'php-plain' || /\bphp\b/.test(lower)) {
    return [
      { path: 'index.php', reason: 'Objective authority initializes the PHP entry point' },
      { path: 'assets/css/style.css', reason: 'Objective authority initializes shared styles' },
      { path: 'assets/js/app.js', reason: 'Objective authority initializes client scripting' }
    ];
  }

  if (requestedFramework === 'python-fastapi' || requestedFramework === 'python-flask' || /\b(?:flask|fastapi|python)\b/.test(lower)) {
    return [
      { path: requestedFramework === 'python-fastapi' ? 'main.py' : 'app.py', reason: 'Objective authority initializes the Python entry point' },
      { path: 'requirements.txt', reason: 'Objective authority initializes dependencies' }
    ];
  }

  if (requestedFramework === 'node-express' || /\b(?:node|express|backend|api server|rest api|fullstack)\b/.test(lower)) {
    return [
      { path: 'package.json', reason: 'Objective authority initializes package metadata' },
      { path: 'src/server.js', reason: 'Objective authority initializes the HTTP server' },
      { path: 'src/routes/health.js', reason: 'Objective authority initializes a health route' },
      { path: 'src/controllers/healthController.js', reason: 'Objective authority initializes a health controller' },
      { path: 'src/middleware/errorHandler.js', reason: 'Objective authority initializes error handling' }
    ];
  }

  if (requestedFramework === 'react-custom' || (/\breact\b/.test(lower) && /\bcustom\b/.test(lower))) {
    return [];
  }

  if (requestedFramework === 'react-vite-ts' || /\breact\s+vite\b/.test(lower) || /\bvite\b/.test(lower) || /\b(?:dashboard|admin|frontend)\b/.test(lower)) {
    return [
      { path: 'index.html', reason: 'Objective authority initializes the HTML shell' },
      { path: 'src/main.tsx', reason: 'Objective authority initializes the React entry point' },
      { path: 'src/App.tsx', reason: 'Objective authority initializes the root component' },
      { path: 'src/styles.css', reason: 'Objective authority initializes the global styles' }
    ];
  }

  if (/\b(?:landing page|homepage|marketing site)\b/.test(lower)) {
    return [
      { path: 'index.html', reason: 'Objective authority initializes the landing page shell' },
      { path: 'assets/css/style.css', reason: 'Objective authority initializes shared styles' },
      { path: 'assets/js/app.js', reason: 'Objective authority initializes client scripting' }
    ];
  }

  return [
    { path: 'index.html', reason: 'Objective authority initializes the project shell' },
    { path: 'assets/css/style.css', reason: 'Objective authority initializes shared styles' },
    { path: 'assets/js/app.js', reason: 'Objective authority initializes client scripting' }
  ];
}

function createInitializationExecutionUnit({
  path,
  reason,
  objective,
  initializationMode
} = {}) {
  return createExecutionUnit({
    id: `init:${path || crypto.randomUUID()}`,
    type: EXECUTION_UNIT_TYPES.WRITE,
    description: `Initialize ${path}`,
    targetFiles: [path],
    requiredReads: [],
    requiredWrites: [path],
    dependencies: [],
    inputs: {
      objective,
      initializationMode,
      reason
    },
    outputs: { file: path },
    acceptanceCriteria: [`${path} is created as part of project initialization`],
    retryPolicy: { maxAttempts: 2, mode: 'write' },
    verificationPolicy: { requiresReads: false, requiresWrites: true },
    metadata: {
      source: 'goal-decomposer',
      objectiveAuthority: true,
      initializationMode,
      plannedNewFile: true,
      reason
    },
    authoritySource: AuthoritySource.OBJECTIVE_AUTHORITY,
    authorityState: 'candidate',
    requestedKind: REQUESTED_FILE_KIND.EXPLICIT_CREATE
  });
}

function finalizeExecutionUnits({
  units = [],
  objective = '',
  projectIntent = {},
  projectScan = {},
  verifiedPlanningContext = {},
  requestedFileDetails = [],
  artifactCandidates = [],
  verifiedCommands = []
} = {}) {
  const intentGraph = buildExecutionIntentGraph({
    objective,
    projectIntent,
    projectScanSnapshot: projectScan,
    planningContext: verifiedPlanningContext || {},
    requestedFileDetails,
    artifactCandidates,
    plannerApprovedArtifacts: Array.isArray(artifactCandidates) ? artifactCandidates : [],
    verifiedCommands
  });
  const resolution = resolveExecutionDependencies(intentGraph, {
    executionCandidates: units,
    planningContext: verifiedPlanningContext || {},
    projectScanSnapshot: projectScan,
    projectIntent,
    verifiedCommands,
    objective
  });
  console.log('[EXECUTION_GRAPH_GENERATED]', {
    unitCount: Array.isArray(resolution.executionUnits) ? resolution.executionUnits.length : 0,
    levelCount: Array.isArray(resolution.levels) ? resolution.levels.length : 0
  });
  console.log('[EXECUTION_GRAPH_READY]', {
    readyCount: Array.isArray(resolution.levels?.[0]) ? resolution.levels[0].length : 0
  });
  resolution.executionUnits.executionGraph = resolution.executionGraph;
  resolution.executionUnits.executionLevels = resolution.levels;
  resolution.executionUnits.executionValidation = resolution.validation;
  resolution.executionUnits.executionIntentGraph = intentGraph;
  return resolution.executionUnits;
}

export function decomposeGoalToExecutionUnits({
  objective = '',
  verifiedPlanningContext = null,
  knowledgeGraph = null,
  canonicalFileUniverse = [],
  plannerPolicies = {},
  projectIntent = {},
  projectScan = {},
  explicitRequestedNewFiles = [],
  artifactCandidateModelRequest = null,
  artifactCandidateModelResponse = null
} = {}) {
  const units = [];
  const canonical = unique(canonicalFileUniverse);
  const workspaceFileSet = createWorkspaceFileSet(
    verifiedPlanningContext,
    projectScan && typeof projectScan === 'object' ? projectScan : (verifiedPlanningContext?.projectScan || verifiedPlanningContext?.facts || {}),
    verifiedPlanningContext?.workspace || {}
  );
  const objectiveKind = inferObjectiveKind(objective);
  const explicitNewFiles = unique(
    (Array.isArray(explicitRequestedNewFiles) ? explicitRequestedNewFiles : [])
      .concat(
        Array.isArray(verifiedPlanningContext?.explicitRequestedNewFiles)
          ? verifiedPlanningContext.explicitRequestedNewFiles
          : []
      )
  );
  const requestedFileDetails = extractRequestedFileDetailsFromIntent(objective, verifiedPlanningContext, canonical, explicitNewFiles, {
    projectIntent,
    projectScan,
    workspaceState: verifiedPlanningContext?.workspace || {},
    bootstrapProfile: null
  });
  const initialization = detectProjectInitialization({
    workspaceState: verifiedPlanningContext?.workspace || {},
    projectScan,
    projectIntent,
    objective,
    verifiedPlanningContext
  });
  const targetFiles = requestedFileDetails.map(detail => detail.path);
  const verifiedFiles = unique(verifiedPlanningContext?.verifiedFiles || []);
  const verifiedCommands = unique(verifiedPlanningContext?.verifiedCommands || []);
  const allowBootstrap = plannerPolicies?.ALLOW_PROJECT_BOOTSTRAP === true;
  const allowInitialization = plannerPolicies?.ALLOW_PROJECT_INITIALIZATION === true ||
    plannerPolicies?.ALLOW_NEW_PROJECT_INITIALIZATION === true ||
    plannerPolicies?.ALLOW_PROJECT_BOOTSTRAP === true;
  const artifactGenerationEnabled = initialization.initializationMode === 'PROJECT_INITIALIZATION' && requestedFileDetails.length === 0;
  const artifactCandidateGeneration = artifactGenerationEnabled
    ? generateArtifactCandidates({
        objective,
        taskIntent: projectIntent?.taskIntent || verifiedPlanningContext?.taskIntent || null,
        projectScanSnapshot: projectScan && typeof projectScan === 'object' ? projectScan : (verifiedPlanningContext?.projectScan || verifiedPlanningContext?.facts || {}),
        planningContext: verifiedPlanningContext || {},
        capabilityGraph: knowledgeGraph,
        frameworkCandidates: Array.isArray(projectIntent?.frameworkCandidates) ? projectIntent.frameworkCandidates : [],
        bootstrapRecommendations: Array.isArray(verifiedPlanningContext?.verifiedRecommendations) ? verifiedPlanningContext.verifiedRecommendations : [],
        policies: plannerPolicies,
        modelRequest: artifactCandidateModelRequest,
        modelResponse: artifactCandidateModelResponse
      })
    : { candidates: [], modelError: null, usedModel: false, fallbackUsed: false };
  const artifactCandidateVerification = verifyArtifactCandidates(artifactCandidateGeneration.candidates, {
    projectScanSnapshot: projectScan && typeof projectScan === 'object' ? projectScan : (verifiedPlanningContext?.projectScan || verifiedPlanningContext?.facts || {}),
    planningContext: verifiedPlanningContext || {},
    policies: plannerPolicies
  });
  const artifactWriteTargets = [];
  for (const candidate of artifactCandidateVerification.verifiedCandidates) {
    const normalized = enforceCanonicalExtension(normalize(candidate.suggestedPath));
    if (!normalized) {
      console.log('[PATH_RESOLUTION_REQUIRED]', {
        id: candidate.id || null,
        name: candidate.name || null,
        origin: candidate.origin || null,
        reason: 'suggestedPath missing'
      });
      continue;
    }
    const suggestedOperation = String(candidate.suggestedOperation || candidate.operation || '').trim().toLowerCase();
    if (suggestedOperation === 'reuse') {
      console.log('[ARTIFACT_REUSE_SKIPPED]', {
        id: candidate.id || null,
        name: candidate.name || null,
        origin: candidate.origin || null,
        suggestedPath: normalized
      });
      continue;
    }
    const existsInWorkspace = workspaceFileSet.has(normalized.toLowerCase());
    const requestedKind = suggestedOperation === 'patch' && existsInWorkspace
      ? REQUESTED_FILE_KIND.EXPLICIT_MODIFICATION
      : REQUESTED_FILE_KIND.EXPLICIT_CREATE;
    if (suggestedOperation === 'patch' && !existsInWorkspace) {
      console.log('[PATH_RESOLUTION_REQUIRED]', {
        id: candidate.id || null,
        name: candidate.name || null,
        origin: candidate.origin || null,
        reason: 'patch target does not exist yet'
      });
      continue;
    }
      console.log('[ARTIFACT_CANDIDATE_PROMOTED]', {
        id: candidate.id || null,
        name: candidate.name || null,
        origin: candidate.origin || null,
        authoritySource: candidate.authoritySource || null,
        suggestedPath: normalized,
        suggestedOperation
      });
    console.log('[WRITE_CANDIDATE_FROM_ARTIFACT]', {
      path: normalized,
      artifactId: candidate.id || null,
      artifactKind: candidate.artifactKind || null,
      authoritySource: candidate.authoritySource || null
    });
    artifactWriteTargets.push({
      path: normalized,
      requestedKind,
      authoritySource: candidate.authoritySource || AuthoritySource.OBJECTIVE_AUTHORITY,
      conditional: false,
      explicit: true,
      verified: true,
      plannedNewFile: requestedKind === REQUESTED_FILE_KIND.EXPLICIT_CREATE,
      artifactCandidateId: candidate.id || null,
      artifactCandidateName: candidate.name || null,
      artifactCandidateOrigin: candidate.origin || null,
      artifactCandidateKind: candidate.artifactKind || null
    });
  }
  const shouldReadFirst = verifiedFiles.length > 0 && objectiveKind !== 'READ';
  const requestedWriteFiles = requestedFileDetails.filter(detail =>
    detail.requestedKind === REQUESTED_FILE_KIND.EXPLICIT_CREATE ||
    detail.requestedKind === REQUESTED_FILE_KIND.EXPLICIT_MODIFICATION
  );

  const readUnitId = shouldReadFirst
    ? `read:${crypto.randomUUID()}`
    : null;

  if (shouldReadFirst) {
    units.push(createExecutionUnit({
      id: readUnitId,
      type: EXECUTION_UNIT_TYPES.READ,
      description: 'Read verified workspace files before making changes',
      targetFiles: verifiedFiles.slice(0, 3),
      requiredReads: verifiedFiles.slice(0, 3),
      requiredWrites: [],
      dependencies: [],
      inputs: { objective, verifiedFiles },
      outputs: { inspectedFiles: verifiedFiles.slice(0, 3) },
      acceptanceCriteria: ['Workspace evidence has been inspected'],
      retryPolicy: { maxAttempts: 1, mode: 'read_only' },
      verificationPolicy: { requiresReads: true, requiresWrites: false },
      metadata: { source: 'verified-planning-context' },
      authoritySource: AuthoritySource.VERIFIED_PLANNING_CONTEXT,
      authorityState: 'candidate'
    }));
  }

  const requestedReadOnlyFiles = requestedFileDetails.filter(detail =>
    detail.requestedKind === REQUESTED_FILE_KIND.REFERENCE_ONLY ||
    detail.requestedKind === REQUESTED_FILE_KIND.DISCOVER_IF_EXISTS ||
    detail.requestedKind === REQUESTED_FILE_KIND.CONDITIONAL ||
    detail.requestedKind === REQUESTED_FILE_KIND.EXPLICIT_MODIFICATION
  );
  const blockedRequestedFiles = requestedFileDetails.filter(detail => detail.requestedKind === REQUESTED_FILE_KIND.DERIVED);
  const explicitRequestedCount = unique(explicitNewFiles).length;
  const writeCandidateCount = requestedWriteFiles.length + artifactWriteTargets.length;
  if (blockedRequestedFiles.length > 0) {
    console.log('[DERIVED_FILE_BLOCKED]', {
      files: blockedRequestedFiles.map(detail => detail.path)
    });
  }

  if (explicitRequestedCount > 0 && writeCandidateCount === 0) {
    const error = new Error('Execution planner integration failure: explicit requested files produced no executable writes');
    error.code = 'EXECUTION_PLANNER_INTEGRATION_FAILURE';
    error.details = {
      explicitRequestedCount,
      requestedFileCount: requestedFileDetails.length,
      blockedRequestedCount: blockedRequestedFiles.length,
      objective: String(objective || '').slice(0, 200)
    };
    console.log('[EXECUTION_PLANNER_INTEGRATION_FAILURE]', error.details);
    throw error;
  }

  if (
    requestedFileDetails.length > 0 &&
    requestedReadOnlyFiles.length === 0 &&
    requestedWriteFiles.length === 0 &&
    blockedRequestedFiles.length === requestedFileDetails.length
  ) {
    return [];
  }

  if (objectiveKind === 'READ' && requestedFileDetails.length === 0) {
    const filesToRead = targetFiles.length > 0 ? targetFiles : verifiedFiles.slice(0, 3);
    units.push(createExecutionUnit({
      id: `analyze:${crypto.randomUUID()}`,
      type: EXECUTION_UNIT_TYPES.ANALYZE,
      description: 'Analyze the workspace evidence for the requested files',
      targetFiles: filesToRead,
      requiredReads: filesToRead,
      requiredWrites: [],
      dependencies: readUnitId ? [readUnitId] : [],
      inputs: { objective, knowledgeGraph: knowledgeGraph?.summary || null },
      outputs: { analysisComplete: true },
      acceptanceCriteria: ['Relevant files are read and analyzed'],
      retryPolicy: { maxAttempts: 1, mode: 'analysis' },
      verificationPolicy: { requiresReads: true, requiresWrites: false },
      metadata: { source: 'goal-decomposer' },
      authoritySource: AuthoritySource.VERIFIED_PLANNING_CONTEXT,
      authorityState: 'candidate'
    }));
  } else {
    const readTargets = [];
    const writeTargets = [];
    const readSeen = new Set();
    const writeSeen = new Set();

    for (const detail of requestedReadOnlyFiles) {
      const normalized = enforceCanonicalExtension(normalize(detail.path));
      if (!normalized || readSeen.has(normalized.toLowerCase())) continue;
      readSeen.add(normalized.toLowerCase());
      readTargets.push({ ...detail, path: normalized });
    }

    for (const detail of requestedWriteFiles) {
      const normalized = enforceCanonicalExtension(normalize(detail.path));
      if (!normalized || writeSeen.has(normalized.toLowerCase())) continue;
      writeSeen.add(normalized.toLowerCase());
      writeTargets.push({ ...detail, path: normalized });
    }

    if (readTargets.length === 0 && verifiedFiles.length > 0) {
      for (const file of verifiedFiles.slice(0, 3)) {
        const normalized = enforceCanonicalExtension(normalize(file));
        if (normalized && !readSeen.has(normalized.toLowerCase())) {
          readSeen.add(normalized.toLowerCase());
          readTargets.push({
            path: normalized,
            requestedKind: REQUESTED_FILE_KIND.REFERENCE_ONLY,
            authoritySource: AuthoritySource.VERIFIED_PLANNING_CONTEXT,
            conditional: false,
            explicit: false,
            verified: true
          });
        }
      }
    }

    for (const artifactTarget of artifactWriteTargets) {
      const existingIndex = writeTargets.findIndex(target => String(target.path || '').toLowerCase() === String(artifactTarget.path || '').toLowerCase());
      if (existingIndex >= 0) {
        writeTargets[existingIndex] = {
          ...writeTargets[existingIndex],
          ...artifactTarget,
          requestedKind: artifactTarget.requestedKind || writeTargets[existingIndex].requestedKind,
          authoritySource: artifactTarget.authoritySource || writeTargets[existingIndex].authoritySource
        };
        continue;
      }
      writeTargets.push(artifactTarget);
    }

    console.log('[WRITE_CANDIDATE_COUNT]', {
      explicitRequested: requestedWriteFiles.length,
      artifactTargets: artifactWriteTargets.length,
      readOnlyTargets: readTargets.length,
      writeTargets: writeTargets.length,
      blockedTargets: blockedRequestedFiles.length
    });

    for (const detail of readTargets) {
      const candidateId = `read:${detail.path || crypto.randomUUID()}`;
      units.push(createExecutionUnit({
        id: candidateId,
        type: EXECUTION_UNIT_TYPES.READ,
        description: `Read file ${detail.path}`,
        targetFiles: [detail.path],
        requiredReads: [detail.path],
        requiredWrites: [],
        dependencies: readUnitId ? [readUnitId] : [],
        inputs: {
          objective,
          requestedKind: detail.requestedKind,
          conditional: detail.conditional === true,
          explicit: detail.explicit === true
        },
        outputs: { file: detail.path },
        acceptanceCriteria: [`${detail.path} is read before execution`],
        retryPolicy: { maxAttempts: 1, mode: 'read_only' },
        verificationPolicy: { requiresReads: true, requiresWrites: false },
        metadata: {
          source: 'goal-decomposer',
          requestedKind: detail.requestedKind,
          authoritySource: detail.authoritySource,
          conditional: detail.conditional === true,
          explicit: detail.explicit === true,
          verified: detail.verified === true,
          explicitUserRequest: detail.explicit === true,
          requestedFile: detail.explicit === true
        },
        authoritySource: detail.authoritySource ? AuthoritySource.WORKSPACE_AUTHORITY : AuthoritySource.VERIFIED_PLANNING_CONTEXT,
        authorityState: 'candidate'
      }));
    }

    for (const detail of writeTargets) {
      const requestedKind = detail.requestedKind;
      const approvedWrite = requestedKind === REQUESTED_FILE_KIND.EXPLICIT_CREATE || requestedKind === REQUESTED_FILE_KIND.EXPLICIT_MODIFICATION;
      if (!approvedWrite) {
        console.log('[WRITE_CANDIDATE_SKIPPED]', {
          path: detail.path,
          requestedKind,
          reason: 'requested file classification is read-only'
        });
        continue;
      }
      console.log('[WRITE_CANDIDATE_ALLOWED]', {
        path: detail.path,
        requestedKind,
        authoritySource: detail.authoritySource || null
      });
      const existsInWorkspace = workspaceFileSet.has(detail.path.toLowerCase());
      const usePatch = requestedKind === REQUESTED_FILE_KIND.EXPLICIT_MODIFICATION && existsInWorkspace;
      if (requestedKind === REQUESTED_FILE_KIND.EXPLICIT_CREATE && existsInWorkspace) {
        console.log('[PATCH_CONVERTED_TO_WRITE]', {
          path: detail.path,
          reason: 'explicit create must always create a new file, not patch an existing one'
        });
      } else if (requestedKind === REQUESTED_FILE_KIND.EXPLICIT_MODIFICATION && !existsInWorkspace) {
        console.log('[PATCH_CONVERTED_TO_WRITE]', {
          path: detail.path,
          reason: 'requested modification file does not exist yet'
        });
      }
      const unitType = usePatch ? EXECUTION_UNIT_TYPES.PATCH : EXECUTION_UNIT_TYPES.WRITE;
      const candidateId = `${unitType.toLowerCase()}:${detail.path || crypto.randomUUID()}`;
      units.push(createExecutionUnit({
        id: candidateId,
        type: unitType,
        description: `${unitType === EXECUTION_UNIT_TYPES.PATCH ? 'Patch' : 'Write'} ${detail.path}`,
        targetFiles: [detail.path],
        requiredReads: unitType === EXECUTION_UNIT_TYPES.PATCH ? [detail.path] : [],
        requiredWrites: [detail.path],
        dependencies: readUnitId ? [readUnitId] : [],
        inputs: {
          objective,
          projectType: projectScan.projectType || null,
          requestedKind,
          conditional: detail.conditional === true,
          conceptSeeds: Array.isArray(knowledgeGraph?.concepts) ? knowledgeGraph.concepts.slice(0, 3) : []
        },
        outputs: { file: detail.path },
        acceptanceCriteria: [`${detail.path} is created or updated`],
        retryPolicy: { maxAttempts: 2, mode: 'write' },
        verificationPolicy: { requiresReads: unitType === EXECUTION_UNIT_TYPES.PATCH, requiresWrites: true },
        metadata: {
          source: 'goal-decomposer',
          bootstrapAllowed: allowBootstrap,
          explicitUserRequest: true,
          requestedFile: true,
          requestedKind,
          conditional: detail.conditional === true,
          explicit: detail.explicit === true,
          verified: detail.verified === true,
          plannedNewFile: requestedKind === REQUESTED_FILE_KIND.EXPLICIT_CREATE || !existsInWorkspace
        },
        authoritySource: detail.authoritySource ? AuthoritySource.WORKSPACE_AUTHORITY : AuthoritySource.VERIFIED_PLANNING_CONTEXT,
        authorityState: 'candidate'
      }));
    }

    const mutationUnits = units.filter(unit =>
      unit.type === EXECUTION_UNIT_TYPES.WRITE ||
      unit.type === EXECUTION_UNIT_TYPES.PATCH ||
      unit.type === EXECUTION_UNIT_TYPES.DELETE ||
      unit.type === EXECUTION_UNIT_TYPES.MOVE ||
      unit.type === EXECUTION_UNIT_TYPES.RENAME
    );
    let validationUnit = null;
    if (mutationUnits.length > 0) {
      validationUnit = buildValidationCommandUnit({
        verifiedCommands,
        dependencyId: mutationUnits[mutationUnits.length - 1]?.id || null,
        objective
      });
      if (validationUnit) {
        validationUnit.dependencies = [...new Set([...(validationUnit.dependencies || []), ...mutationUnits.map(unit => unit.id)])];
        units.push(validationUnit);
      }
    }

    const verifyDependencies = validationUnit
      ? [validationUnit.id]
      : mutationUnits.map(unit => unit.id);
    const verifyUnit = createExecutionUnit({
      id: `verify:${crypto.randomUUID()}`,
      type: EXECUTION_UNIT_TYPES.VERIFY,
      description: 'Verify the execution graph completes with approved work only',
      targetFiles: [],
      requiredReads: [],
      requiredWrites: [],
      dependencies: verifyDependencies,
      inputs: { objective },
      outputs: { verified: true },
      acceptanceCriteria: ['All non-VERIFY execution units complete successfully'],
      completionPredicate: () => true,
      retryPolicy: { maxAttempts: 1, mode: 'verify' },
      verificationPolicy: { requiresTerminal: false, requiresWrites: false },
      metadata: { source: 'goal-decomposer', internal: true },
      authoritySource: AuthoritySource.VERIFIED_PLANNING_CONTEXT,
      authorityState: 'candidate'
    });
    units.push(verifyUnit);

    return finalizeExecutionUnits({
      units,
      objective,
      projectIntent,
      projectScan,
      verifiedPlanningContext,
      requestedFileDetails,
      artifactCandidates: Array.isArray(artifactCandidateGeneration.plannerApprovedArtifacts)
        ? artifactCandidateGeneration.plannerApprovedArtifacts
        : artifactCandidateVerification.verifiedCandidates,
      verifiedCommands
    });
  }

  return finalizeExecutionUnits({
    units,
    objective,
    projectIntent,
    projectScan,
    verifiedPlanningContext,
    requestedFileDetails,
    artifactCandidates: Array.isArray(artifactCandidateGeneration.plannerApprovedArtifacts)
      ? artifactCandidateGeneration.plannerApprovedArtifacts
      : artifactCandidateVerification.verifiedCandidates,
    verifiedCommands
  });
}
