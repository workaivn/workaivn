import { VerifiedPlanningContext } from './VerifiedPlanningContext.js';
import { resolvePlannerPolicies } from './PlannerPolicy.js';
import { validatePlanningContext } from './PlanningContextValidator.js';
import { createPlanningContextSnapshot } from './PlanningContextSnapshot.js';
import { createProjectScanSnapshot, getCanonicalWorkspaceFiles } from '../../context/ProjectScanSnapshot.js';
import { validateContextConsistency } from '../../context/ContextConsistencyValidator.js';
import { normalizeCanonicalPath } from '../../context/canonicalPath.js';
import { REQUESTED_FILE_KIND } from '../../acceptanceCriteria.js';
import { createRuntimePlan } from '../../projectIntelligence/runtimePlanningIntelligence.js';
import { createDerivedRequestedFileDetails as inferFileIntentDetails } from '../fileIntentInference.js';

function uniqueNormalizedPaths(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => preserveCanonicalPath(value)).filter(Boolean))];
}

function preserveCanonicalPath(value = '') {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .trim();
}

function canonicalPathKey(value = '') {
  return preserveCanonicalPath(value).toLowerCase();
}

function normalizeRequestedFileDetails(classifierRequestedFiles = []) {
  return (Array.isArray(classifierRequestedFiles) ? classifierRequestedFiles : [])
    .map(entry => {
      if (typeof entry === 'string') {
        return {
          path: preserveCanonicalPath(entry),
          kind: null,
          authoritySource: 'classifier',
          conditional: false,
          explicit: true,
          verified: false
        };
      }

      const path = preserveCanonicalPath(entry?.path || entry?.file || entry?.target || entry?.name || '');
      return {
        path,
        kind: entry?.kind || entry?.requestedKind || null,
        authoritySource: entry?.authoritySource || 'classifier',
        conditional: entry?.conditional === true,
        explicit: entry?.explicit !== false,
        verified: entry?.verified === true,
        plannedNewFile: entry?.plannedNewFile === true || entry?.plannedNewFile === false ? entry.plannedNewFile === true : undefined
      };
    })
    .filter(entry => entry.path);
}

function normalizeAuthoritySource(value = '') {
  const source = String(value || '').trim().toLowerCase();
  if (source === 'explicit_user_request' || source === 'explicit_user') return 'explicit_user_request';
  if (source === 'planner_derived') return 'planner_derived';
  if (source === 'workspace_derived') return 'workspace_derived';
  if (source === 'verified_planning_context') return 'verified_planning_context';
  if (source === 'workspace_evidence') return 'workspace_evidence';
  if (source === 'model_invented' || source === 'model_output' || source === 'model reasoning' || source === 'model_reasoning') return 'model_invented';
  return source || 'explicit_user_request';
}

function uniqueNormalized(entries = []) {
  const seen = new Set();
  const output = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const path = preserveCanonicalPath(entry?.path || entry?.file || entry?.target || entry?.name || entry || '');
    if (!path) continue;
    const key = canonicalPathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ ...entry, path });
  }
  return output;
}

function inferWorkspaceDerivedFilePatterns(goalType = '') {
  const upper = String(goalType || '').toUpperCase();
  if (upper === 'LANDING_PAGE' || upper === 'SAAS_APP' || upper === 'DASHBOARD' || upper === 'ADMIN_PANEL' || upper === 'FULLSTACK_APP') {
    return [
      /(^|\/)app\.(?:tsx|jsx)$/i,
      /(^|\/)main\.(?:tsx|jsx)$/i,
      /(^|\/)layout\.(?:tsx|jsx)$/i,
      /(^|\/)page\.(?:tsx|jsx)$/i,
      /(^|\/)index\.html$/i,
      /(^|\/)styles\.css$/i,
      /(^|\/)style\.css$/i,
      /(^|\/)globals\.css$/i,
      /(^|\/)navbar\.(?:tsx|jsx)$/i,
      /(^|\/)hero(?:section)?\.(?:tsx|jsx)$/i,
      /(^|\/)feature(?:grid)?\.(?:tsx|jsx)$/i,
      /(^|\/)pricing(?:grid)?\.(?:tsx|jsx)$/i,
      /(^|\/)cta(?:section)?\.(?:tsx|jsx)$/i,
      /(^|\/)footer\.(?:tsx|jsx)$/i
    ];
  }
  if (upper === 'API_SERVER') {
    return [
      /(^|\/)server\.js$/i,
      /(^|\/)app\.js$/i,
      /(^|\/)routes\/index\.js$/i,
      /(^|\/)controllers\/.+\.js$/i,
      /(^|\/)middleware\/errorHandler\.js$/i
    ];
  }
  if (upper === 'READ_ONLY') {
    return [];
  }
  return [
    /(^|\/)package\.json$/i,
    /(^|\/)app\.(?:tsx|jsx|js)$/i,
    /(^|\/)index\.html$/i
  ];
}

export function createDerivedRequestedFileDetails({
  objective = '',
  projectIntent = {},
  workspaceState = {},
  projectScan = {},
  bootstrapProfile = null,
  requestedFileDetails = []
} = {}) {
  return inferFileIntentDetails({
    objective,
    projectIntent,
    workspaceState,
    projectScan,
    bootstrapProfile,
    requestedFileDetails
  });
}

function buildRequestedFileMetadata({
  classifierRequestedFiles = [],
  explicitRequestedNewFiles = [],
  plannedWriteTargets = [],
  projectIntent = {},
  workspaceState = {},
  projectScan = {},
  bootstrapProfile = null,
  objective = ''
} = {}) {
  const inferredFileIntents = inferFileIntentDetails({
    objective,
    projectIntent,
    workspaceState,
    projectScan,
    bootstrapProfile,
    requestedFileDetails: normalizeRequestedFileDetails(classifierRequestedFiles)
  });
  const requestedFileDetails = Array.isArray(inferredFileIntents) ? inferredFileIntents : (inferredFileIntents?.requestedFileDetails || []);
  const requestedFileKinds = [...new Set(requestedFileDetails.map(entry => entry.kind).filter(Boolean))];
  const plannedNewFilePaths = uniqueNormalizedPaths(
    requestedFileDetails
      .filter(entry => entry.kind === REQUESTED_FILE_KIND.EXPLICIT_CREATE)
      .map(entry => entry.path)
  );
  const explicitRequestedNewFilePaths = uniqueNormalizedPaths(
    requestedFileDetails
      .filter(entry => entry.kind === REQUESTED_FILE_KIND.EXPLICIT_CREATE && entry.authoritySource === 'explicit_user_request')
      .map(entry => entry.path)
  );
  const plannedNewFileSet = new Set(plannedNewFilePaths.map(path => canonicalPathKey(path)));
  const requestedFileDetailsWithPlanning = requestedFileDetails.map(entry => ({
    ...entry,
    plannedNewFile: plannedNewFileSet.has(canonicalPathKey(entry.path)) || entry.kind === REQUESTED_FILE_KIND.EXPLICIT_CREATE
  }));
  const conditionalRequestedFiles = requestedFileDetails
    .filter(entry => entry.kind === REQUESTED_FILE_KIND.CONDITIONAL || entry.conditional === true)
    .map(entry => entry.path);
  const discoverIfExistsFiles = requestedFileDetails
    .filter(entry => entry.kind === REQUESTED_FILE_KIND.DISCOVER_IF_EXISTS)
    .map(entry => entry.path);
  const referenceOnlyFiles = requestedFileDetails
    .filter(entry => entry.kind === REQUESTED_FILE_KIND.REFERENCE_ONLY)
    .map(entry => entry.path);
  const derivedFiles = requestedFileDetails
    .filter(entry => entry.kind === REQUESTED_FILE_KIND.DERIVED)
    .map(entry => entry.path);
  const plannedNewFiles = plannedNewFilePaths;

  return {
    requestedFileDetails: requestedFileDetailsWithPlanning,
    requestedFiles: requestedFileDetailsWithPlanning.map(entry => entry.path),
    requestedFileKinds,
    explicitRequestedNewFiles: explicitRequestedNewFilePaths,
    conditionalRequestedFiles: uniqueNormalizedPaths(conditionalRequestedFiles),
    discoverIfExistsFiles: uniqueNormalizedPaths(discoverIfExistsFiles),
    referenceOnlyFiles: uniqueNormalizedPaths(referenceOnlyFiles),
    derivedFiles: uniqueNormalizedPaths(derivedFiles),
    plannedNewFiles: plannedNewFilePaths,
    executionCandidates: Array.isArray(inferredFileIntents?.executionCandidates) ? inferredFileIntents.executionCandidates : [],
    recommendationCandidates: Array.isArray(inferredFileIntents?.recommendationCandidates) ? inferredFileIntents.recommendationCandidates : [],
    blockedRecommendations: Array.isArray(inferredFileIntents?.blockedRecommendations) ? inferredFileIntents.blockedRecommendations : []
  };
}

export function buildPlanningContext({
  workspaceState = {},
  projectScan = {},
  projectIntent = {},
  validatedAssumptions = [],
  bootstrapProfile = null,
  classifierRequestedFiles = [],
  plannedWriteTargets = [],
  explicitRequestedNewFiles = []
} = {}) {
  console.log('[PLANNING_CONTEXT_BUILD_START]', {
    projectType: projectScan.projectType || 'generic',
    packageJsonFound: projectScan.packageJsonFound === true,
    existingFileCount: (workspaceState.existingFiles || []).length,
    assumptionCount: validatedAssumptions.length,
    bootstrapProfileId: bootstrapProfile?.id || null
  });

  const mergedDiscoveredFiles = [
    ...(Array.isArray(projectScan?.discoveredFiles) ? projectScan.discoveredFiles : []),
    ...(Array.isArray(projectScan?.files) ? projectScan.files : []),
    ...(Array.isArray(workspaceState?.existingFiles) ? workspaceState.existingFiles : [])
  ];
  const requestedFileMetadata = buildRequestedFileMetadata({
    classifierRequestedFiles,
    explicitRequestedNewFiles,
    plannedWriteTargets,
    projectIntent,
    workspaceState,
    projectScan,
    bootstrapProfile,
    objective: projectIntent?.prompt || projectIntent?.objective || ''
  });
  const plannedFilesList = uniqueNormalizedPaths(requestedFileMetadata.plannedNewFiles);
  const scanInput = projectScan?.scanId
    ? projectScan
    : {
        ...projectScan,
        discoveredFiles: [...new Set(mergedDiscoveredFiles.map(file => normalizeCanonicalPath(file)).filter(Boolean))]
      };
  const scanWithRequestedMetadata = {
    ...scanInput,
    ...requestedFileMetadata
  };

  const facts = createProjectScanSnapshot(scanWithRequestedMetadata, {
    workspaceRoot: workspaceState.workspaceRoot || projectScan.workspaceRoot || '',
    scanId: projectScan?.scanId || null,
    timestamp: projectScan?.timestamp || null
  });
  const canonicalFiles = getCanonicalWorkspaceFiles(facts);
  const discoveredFiles = [...canonicalFiles];

  const verifiedFiles = [];
  const verifiedRecommendations = [];
  const blockedRecommendations = [];
  const verifiedCommands = [];
  const derived = {
    verifiedFramework: facts.projectType || null,
    verifiedPackageManager: facts.packageManagerVerified === true ? facts.packageManager || null : null,
    verifiedValidation: null,
    verifiedEntrypoints: [],
    verifiedAppRoots: [],
    verifiedSourceRoots: [],
    verifiedModuleRoots: [],
    verifiedRecommendations: [],
    blockedRecommendations: []
  };

  for (const p of plannedFilesList) {
    console.log("[PLANNED_FILE_REGISTERED]", { path: p });
  }
  for (const p of requestedFileMetadata.explicitRequestedNewFiles) {
    console.log("[EXPLICIT_USER_AUTHORITY_DETECTED]", { path: p, authoritySource: 'explicit_user_request' });
  }
  for (const detail of requestedFileMetadata.requestedFileDetails) {
    if (detail.authoritySource === 'planner_derived' || detail.authoritySource === 'workspace_derived') {
      console.log('[PLANNER_DERIVED_FILE]', {
        name: detail.path,
        authoritySource: detail.authoritySource,
        plannerGoal: detail.plannerGoal || projectScan?.goalType || null
      });
    }
  }
  console.log('[PLANNER_FILE_AUTHORITY]', {
    explicit: requestedFileMetadata.requestedFileDetails.filter(entry => entry.authoritySource === 'explicit_user_request').length,
    plannerDerived: requestedFileMetadata.requestedFileDetails.filter(entry => entry.authoritySource === 'planner_derived').length,
    workspaceDerived: requestedFileMetadata.requestedFileDetails.filter(entry => entry.authoritySource === 'workspace_derived').length,
    invented: requestedFileMetadata.requestedFileDetails.filter(entry => entry.authoritySource === 'model_invented').length
  });

  for (const assumption of validatedAssumptions) {
    if (assumption.verified && assumption.path) {
      const normalizedPath = normalizeCanonicalPath(assumption.path);
      if (!canonicalFiles.has(normalizedPath)) {
        if (plannedFilesList.some(file => canonicalPathKey(file) === canonicalPathKey(normalizedPath))) {
          console.log("[PLANNED_FILE_ACCEPTED]", { path: normalizedPath });
          verifiedFiles.push(normalizedPath);
          verifiedRecommendations.push({
            path: normalizedPath,
            kind: 'file',
            source: assumption.source,
            confidence: assumption.confidence,
            required: assumption.required,
            optional: assumption.optional
          });
          continue;
        }
        console.log('[CONTEXT_NON_CANONICAL_FILE_VIOLATION]', {
          path: normalizedPath,
          source: assumption.source,
          reason: 'verified assumption not present in canonical project scan files'
        });
        blockedRecommendations.push({
          path: normalizedPath,
          kind: 'file',
          source: assumption.source,
          confidence: assumption.confidence,
          required: assumption.required,
          optional: assumption.optional,
          reason: 'File not found in canonical workspace files'
        });
        continue;
      }
      verifiedFiles.push(normalizedPath);
      verifiedRecommendations.push({
        path: normalizedPath,
        kind: 'file',
        source: assumption.source,
        confidence: assumption.confidence,
        required: assumption.required,
        optional: assumption.optional
      });
    } else if (!assumption.verified && assumption.path) {
      const normalizedPath = normalizeCanonicalPath(assumption.path);
      if (requestedFileMetadata.explicitRequestedNewFiles.some(file => canonicalPathKey(file) === canonicalPathKey(normalizedPath))) {
        console.log('[EXPLICIT_USER_PATH_APPROVED]', {
          path: normalizedPath,
          authoritySource: 'explicit_user_request',
          note: 'Explicit user request — not blocked despite missing from workspace'
        });
        continue;
      }
      blockedRecommendations.push({
        path: assumption.path,
        kind: 'file',
        source: assumption.source,
        confidence: assumption.confidence,
        required: assumption.required,
        optional: assumption.optional,
        reason: 'File not found in workspace'
      });
    }
  }

  const packageJsonFound = facts.packageJsonFound === true;

  if (packageJsonFound && facts.packageManagerVerified === true) {
    derived.verifiedPackageManager = facts.packageManager || derived.verifiedPackageManager || null;
  }

  if (facts.testCommands && facts.testCommands.length > 0) {
    for (const cmd of facts.testCommands) {
      if (!verifiedCommands.includes(cmd)) verifiedCommands.push(cmd);
    }
    derived.verifiedValidation = verifiedCommands[0];
  }

  if (facts.buildCommands && facts.buildCommands.length > 0) {
    for (const cmd of facts.buildCommands) {
      if (!verifiedCommands.includes(cmd)) verifiedCommands.push(cmd);
    }
    derived.verifiedValidation = derived.verifiedValidation || verifiedCommands[0];
  }

  if (facts.runCommands && facts.runCommands.length > 0) {
    for (const cmd of facts.runCommands) {
      if (!verifiedCommands.includes(cmd)) verifiedCommands.push(cmd);
    }
  }

  if (bootstrapProfile && packageJsonFound) {
    const recommendedCommands = [
      ...(Array.isArray(bootstrapProfile.validationCommands) ? bootstrapProfile.validationCommands : []),
      ...(Array.isArray(bootstrapProfile.buildCommands) ? bootstrapProfile.buildCommands : []),
      ...(Array.isArray(bootstrapProfile.installCommands) ? bootstrapProfile.installCommands : [])
    ].map(cmd => String(cmd || '').trim()).filter(Boolean);
    if (recommendedCommands.length > 0) {
      console.log('[PLANNING_CONTEXT_RECOMMENDATION_ONLY]', {
        source: 'bootstrap_profile',
        commandCount: recommendedCommands.length,
        commands: recommendedCommands
      });
    }
  }

  if (facts.projectType) {
    derived.verifiedFramework = facts.projectType;
  }

  if (facts.entryFiles) {
    for (const f of facts.entryFiles) {
      const normalized = normalizeCanonicalPath(f);
      if (canonicalFiles.has(normalized) && (normalized.endsWith('.html') || normalized.endsWith('.php'))) {
        derived.verifiedEntrypoints.push(normalized);
      }
    }
  }

  const goalType = (projectIntent.goalType || '').toUpperCase();

  if (goalType === 'LANDING_PAGE' || goalType === 'SAAS_APP') {
    if (verifiedFiles.some(f => f.includes('index.html') || f.includes('index.php') || f.includes('src/App.'))) {
      derived.verifiedAppRoots.push('/');
    }
  }

  for (const file of verifiedFiles) {
    if (/^src\//.test(file) || /^src\\/.test(file)) {
      if (!derived.verifiedSourceRoots.includes('src/')) derived.verifiedSourceRoots.push('src/');
    }
    if (/^app\//.test(file) || /^app\\/.test(file)) {
      if (!derived.verifiedSourceRoots.includes('app/')) derived.verifiedSourceRoots.push('app/');
    }
  }

  for (const file of discoveredFiles) {
    if (/\/node_modules\//.test(file) || /\\node_modules\\/.test(file)) continue;
    if (/node_modules/.test(file)) continue;
    const parts = file.replace(/\\/g, '/').split('/');
    if (parts.length >= 2) {
      const dir = parts.slice(0, -1).join('/');
      if (dir && !derived.verifiedModuleRoots.includes(dir)) derived.verifiedModuleRoots.push(dir);
    }
  }

  const plannerPolicies = resolvePlannerPolicies({
    workspaceState,
    projectScan: facts,
    projectIntent,
    validatedAssumptions
  });

  const context = new VerifiedPlanningContext({
    workspace: workspaceState,
    facts,
    derived: {
      ...derived,
      verifiedFiles,
      verifiedCommands,
      verifiedRecommendations,
      blockedRecommendations
    },
    discoveredFiles,
    plannerPolicies,
    blockedRecommendations,
    proposals: [],
    plannedFiles: plannedFilesList,
    explicitRequestedNewFiles: requestedFileMetadata.explicitRequestedNewFiles
  });

  const validation = validatePlanningContext(context);
  if (!validation.valid) {
    console.log('[PLANNING_CONTEXT_INVALID]', { errors: validation.errors });
  }

  const consistency = validateContextConsistency({
    facts,
    context,
    plannerPolicies
  });
  if (!consistency.valid) {
    console.log('[PLANNING_CONTEXT_CONSISTENCY_FAILED]', {
      violations: consistency.violations,
      warnings: consistency.warnings
    });
  }

  const snapshot = createPlanningContextSnapshot(context);
  console.log('[CONTEXT_FACTS_PRESERVED]', {
    scanId: facts.scanId || null,
    packageJsonFound: facts.packageJsonFound === true,
    projectType: facts.projectType || null
  });
  console.log('[CONTEXT_DERIVED_CREATED]', {
    scanId: facts.scanId || null,
    verifiedCommandCount: verifiedCommands.length,
    verifiedFileCount: verifiedFiles.length
  });
  console.log('[PLANNING_CONTEXT_CREATED]', snapshot);

  if (blockedRecommendations.length > 0) {
    console.log('[PLANNING_CONTEXT_BLOCKED]', {
      count: blockedRecommendations.length,
      files: blockedRecommendations.map(r => r.path),
      reasons: blockedRecommendations.map(r => r.reason)
    });
  }

  return { context, validation, snapshot, facts };
}
