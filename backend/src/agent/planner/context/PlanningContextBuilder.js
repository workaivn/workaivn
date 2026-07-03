import { VerifiedPlanningContext } from './VerifiedPlanningContext.js';
import { resolvePlannerPolicies } from './PlannerPolicy.js';
import { validatePlanningContext } from './PlanningContextValidator.js';
import { createPlanningContextSnapshot } from './PlanningContextSnapshot.js';
import { createProjectScanSnapshot, getCanonicalWorkspaceFiles } from '../../context/ProjectScanSnapshot.js';
import { validateContextConsistency } from '../../context/ContextConsistencyValidator.js';
import { normalizeCanonicalPath } from '../../context/canonicalPath.js';
import { buildObjectiveConstraintGraph } from '../../planning/objectiveConstraintExtractor.js';
import { buildPlanningStrategyGraph } from '../../planning/constraintResolver.js';
import { resolveImplementationStrategy } from '../../planning/implementationStrategy/implementationStrategyResolver.js';
import { REQUESTED_FILE_KIND } from '../../acceptanceCriteria.js';
import { createRuntimePlan } from '../../projectIntelligence/runtimePlanningIntelligence.js';
import { createDerivedRequestedFileDetails as inferFileIntentDetails } from '../fileIntentInference.js';
import { detectProjectInitialization } from './ProjectInitializationDetector.js';
import { scanWorkspaceCapabilities } from '../../../planner/workspaceCapability/workspaceCapabilityScanner.js';

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
  if (source === 'objective_authority') return 'objective_authority';
  if (source === 'workspace_authority') return 'workspace_authority';
  if (source === 'verified_planning_context') return 'verified_planning_context';
  if (source === 'explicit_user_request' || source === 'explicit_user' || source === 'workspace_derived' || source === 'workspace_evidence') return 'workspace_authority';
  if (source === 'planner_derived') return 'model_suggestion';
  if (source === 'recommendation_only' || source === 'recommendation') return 'recommendation_only';
  if (source === 'template') return 'template';
  if (source === 'framework_hint') return 'framework_hint';
  if (source === 'bootstrap_hint') return 'bootstrap_hint';
  if (source === 'default_hint') return 'default_hint';
  if (source === 'model_suggestion' || source === 'model_invented' || source === 'model_output' || source === 'model reasoning' || source === 'model_reasoning') return 'model_suggestion';
  return source || 'recommendation_only';
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
  const inferredRequestedFileDetails = Array.isArray(inferredFileIntents) ? inferredFileIntents : (inferredFileIntents?.requestedFileDetails || []);
  const workspaceExistingFiles = new Set([
    ...(Array.isArray(workspaceState?.existingFiles) ? workspaceState.existingFiles : []),
    ...(Array.isArray(projectScan?.discoveredFiles) ? projectScan.discoveredFiles : []),
    ...(Array.isArray(projectScan?.files) ? projectScan.files : [])
  ].map(file => canonicalPathKey(file)));
  const explicitRequestedDetails = uniqueNormalizedPaths(explicitRequestedNewFiles).map(path => {
    const verified = workspaceExistingFiles.has(canonicalPathKey(path));
    return {
      path,
      kind: verified ? REQUESTED_FILE_KIND.EXPLICIT_MODIFICATION : REQUESTED_FILE_KIND.EXPLICIT_CREATE,
      authoritySource: 'workspace_authority',
      conditional: false,
      explicit: true,
      verified,
      plannedNewFile: !verified
    };
  });
  const plannedWriteDetails = uniqueNormalizedPaths(plannedWriteTargets).map(path => {
    const verified = workspaceExistingFiles.has(canonicalPathKey(path));
    return {
      path,
      kind: verified ? REQUESTED_FILE_KIND.EXPLICIT_MODIFICATION : REQUESTED_FILE_KIND.EXPLICIT_CREATE,
      authoritySource: 'workspace_authority',
      conditional: false,
      explicit: true,
      verified,
      plannedNewFile: !verified
    };
  });
  const requestedFileDetails = uniqueNormalized([
    ...inferredRequestedFileDetails,
    ...explicitRequestedDetails,
    ...plannedWriteDetails
  ]);
  const requestedFileKinds = [...new Set(requestedFileDetails.map(entry => entry.kind).filter(Boolean))];
  const plannedNewFilePaths = uniqueNormalizedPaths(
    requestedFileDetails
      .filter(entry => entry.kind === REQUESTED_FILE_KIND.EXPLICIT_CREATE)
      .map(entry => entry.path)
  );
  const explicitRequestedNewFilePaths = uniqueNormalizedPaths(
    requestedFileDetails
      .filter(entry => entry.kind === REQUESTED_FILE_KIND.EXPLICIT_CREATE && entry.explicit === true)
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
    bootstrapProfile: bootstrapProfile ? { id: bootstrapProfile.id, framework: bootstrapProfile.framework, note: 'recommendation-only' } : null
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
  const objectiveConstraintGraph = buildObjectiveConstraintGraph({
    objective: projectIntent?.prompt || projectIntent?.objective || '',
    projectIntent
  });
  const planningStrategyGraph = buildPlanningStrategyGraph({
    objective: projectIntent?.prompt || projectIntent?.objective || '',
    projectIntent,
    constraintGraph: objectiveConstraintGraph
  });
  const implementationResolution = resolveImplementationStrategy({
    objective: projectIntent?.prompt || projectIntent?.objective || '',
    objectiveConstraints: Array.isArray(objectiveConstraintGraph?.constraints) ? objectiveConstraintGraph.constraints : [],
    planningStrategies: Array.isArray(planningStrategyGraph?.strategies) ? planningStrategyGraph.strategies : [],
    initializationStrategies: Array.isArray(planningStrategyGraph?.initializationStrategies) ? planningStrategyGraph.initializationStrategies : [],
    planningContext: {
      plannerPolicies: {},
      policies: {},
      initializationMode: null,
      objectiveAuthorityEligible: false,
      facts: {
        projectType: projectScan.projectType || 'generic',
        packageJsonFound: projectScan.packageJsonFound === true,
        packageManager: projectScan.packageManager || null
      }
    },
    projectScanSnapshot: projectScan?.scanId ? projectScan : {
      ...projectScan,
      discoveredFiles: Array.isArray(projectScan?.discoveredFiles) ? projectScan.discoveredFiles : []
    },
    projectIntent
  });
  const plannedFilesList = uniqueNormalizedPaths([
    ...(Array.isArray(requestedFileMetadata.plannedNewFiles) ? requestedFileMetadata.plannedNewFiles : []),
    ...(Array.isArray(explicitRequestedNewFiles) ? explicitRequestedNewFiles : []),
    ...(Array.isArray(plannedWriteTargets) ? plannedWriteTargets : [])
  ]);
  const scanInput = projectScan?.scanId
    ? projectScan
    : {
        ...projectScan,
        discoveredFiles: [...new Set(mergedDiscoveredFiles.map(file => normalizeCanonicalPath(file)).filter(Boolean))]
      };
  const scanWithRequestedMetadata = {
    ...scanInput,
    ...requestedFileMetadata,
    explicitRequestedFiles: uniqueNormalizedPaths(explicitRequestedNewFiles),
    plannerApprovedFiles: uniqueNormalizedPaths(plannedFilesList),
    generatedFiles: uniqueNormalizedPaths(projectScan?.generatedFiles || []),
    dependencyReleasedFiles: uniqueNormalizedPaths(projectScan?.dependencyReleasedFiles || [])
  };

  const facts = createProjectScanSnapshot(scanWithRequestedMetadata, {
    workspaceRoot: workspaceState.workspaceRoot || projectScan.workspaceRoot || '',
    scanId: projectScan?.scanId || null,
    timestamp: projectScan?.timestamp || null
  });
  const canonicalFiles = getCanonicalWorkspaceFiles(facts);
  const discoveredFiles = [...canonicalFiles];
  const capabilityScan = scanWorkspaceCapabilities({
    projectScanSnapshot: facts,
    planningContext: {
      verifiedFiles: [],
      plannedFiles: plannedFilesList,
      facts
    },
    objective: projectIntent?.prompt || projectIntent?.objective || ''
  });

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
    blockedRecommendations: [],
    workspaceCapabilities: capabilityScan.workspaceCapabilities,
    artifactCandidates: [],
    artifactGraph: null,
    artifactOperations: {},
    plannerApprovedArtifacts: [],
    implementationStrategies: Array.isArray(implementationResolution?.implementationStrategies) ? implementationResolution.implementationStrategies : [],
    implementationVariants: Array.isArray(implementationResolution?.implementationVariants) ? implementationResolution.implementationVariants : [],
    selectedImplementation: implementationResolution?.selectedImplementation || null,
    implementationEvidence: Array.isArray(implementationResolution?.implementationEvidence) ? implementationResolution.implementationEvidence : [],
    implementationPolicyDecision: implementationResolution?.implementationPolicyDecision || null,
    implementationVariantGraph: implementationResolution?.implementationVariantGraph || null,
    satisfiedCapabilities: [],
    missingCapabilities: [],
    capabilityCoverage: { total: 0, satisfied: 0, partial: 0, missing: 0, blocked: 0, unknown: 0, coverage: 0 },
    capabilityGapGraph: null,
    satisfiedCapabilityGraph: null,
    missingCapabilityGraph: null,
    initializationCapabilities: [],
    capabilitySatisfaction: null,
    artifactOwnership: {},
    artifactLifecycle: {},
    operationPlan: [],
    capabilityEvidence: capabilityScan.capabilityEvidence,
    objectiveConstraintGraph,
    planningStrategyGraph,
    requiredFramework: null
  };

  for (const p of plannedFilesList) {
    console.log("[PLANNED_FILE_REGISTERED]", { path: p });
  }
  for (const p of requestedFileMetadata.explicitRequestedNewFiles) {
    console.log("[EXPLICIT_USER_AUTHORITY_DETECTED]", { path: p, authoritySource: 'workspace_authority' });
  }
  for (const detail of requestedFileMetadata.requestedFileDetails) {
    if (detail.authoritySource === 'model_suggestion' || detail.authoritySource === 'workspace_authority') {
      console.log('[PLANNER_DERIVED_FILE]', {
        name: detail.path,
        authoritySource: detail.authoritySource,
        plannerGoal: detail.plannerGoal || projectScan?.goalType || null
      });
    }
  }
  console.log('[PLANNER_FILE_AUTHORITY]', {
    explicit: requestedFileMetadata.requestedFileDetails.filter(entry => entry.explicit === true).length,
    plannerDerived: requestedFileMetadata.requestedFileDetails.filter(entry => entry.authoritySource === 'model_suggestion').length,
    workspaceDerived: requestedFileMetadata.requestedFileDetails.filter(entry => entry.authoritySource === 'workspace_authority').length,
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
      console.log('[BOOTSTRAP_RECOMMENDATION_CREATED]', {
        source: 'bootstrap_profile',
        profileId: bootstrapProfile?.id || null,
        commandCount: recommendedCommands.length,
        commands: recommendedCommands,
        note: 'Profile recommendations only — not executable authority'
      });
    }
  }

  if (facts.projectType) {
    derived.verifiedFramework = facts.projectType;
  }

  const requiredFrameworkConstraint = Array.isArray(objectiveConstraintGraph?.constraints)
    ? objectiveConstraintGraph.constraints.find(constraint => String(constraint.category || '').toUpperCase() === 'FRAMEWORK')
    : null;
  if (requiredFrameworkConstraint) {
    derived.requiredFramework = requiredFrameworkConstraint.value || null;
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
  const initialization = detectProjectInitialization({
    workspaceState,
    projectScan: facts,
    projectIntent,
    objective: projectIntent?.prompt || projectIntent?.objective || '',
    verifiedPlanningContext: {
      verifiedFiles,
      verifiedCommands
    }
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
    explicitRequestedNewFiles: requestedFileMetadata.explicitRequestedNewFiles,
    initializationMode: initialization.initializationMode,
    objectiveAuthorityEligible: initialization.objectiveAuthorityEligible,
    workspaceCapabilities: capabilityScan.workspaceCapabilities,
    artifactCandidates: [],
    artifactGraph: null,
    artifactOperations: {},
    plannerApprovedArtifacts: [],
    implementationStrategies: Array.isArray(implementationResolution?.implementationStrategies) ? implementationResolution.implementationStrategies : [],
    implementationVariants: Array.isArray(implementationResolution?.implementationVariants) ? implementationResolution.implementationVariants : [],
    selectedImplementation: implementationResolution?.selectedImplementation || null,
    implementationEvidence: Array.isArray(implementationResolution?.implementationEvidence) ? implementationResolution.implementationEvidence : [],
    implementationPolicyDecision: implementationResolution?.implementationPolicyDecision || null,
    implementationVariantGraph: implementationResolution?.implementationVariantGraph || null,
    satisfiedCapabilities: [],
    missingCapabilities: [],
    capabilityCoverage: { total: 0, satisfied: 0, partial: 0, missing: 0, blocked: 0, unknown: 0, coverage: 0 },
    capabilityGapGraph: null,
    satisfiedCapabilityGraph: null,
    missingCapabilityGraph: null,
    initializationCapabilities: [],
    capabilitySatisfaction: null,
    artifactOwnership: {},
    artifactLifecycle: {},
    operationPlan: [],
    capabilityEvidence: capabilityScan.capabilityEvidence,
    constraintGraph: objectiveConstraintGraph,
    planningStrategyGraph,
    objectiveConstraints: Array.isArray(objectiveConstraintGraph?.constraints) ? objectiveConstraintGraph.constraints : [],
    planningStrategies: Array.isArray(planningStrategyGraph?.strategies) ? planningStrategyGraph.strategies : [],
    initializationStrategies: Array.isArray(planningStrategyGraph?.initializationStrategies) ? planningStrategyGraph.initializationStrategies : [],
    requiredFramework: derived.requiredFramework
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
