import crypto from 'node:crypto';
import { createExecutionUnit, EXECUTION_UNIT_TYPES } from './executionUnit.js';
import { resolveExecutionOrder } from './dependencyResolver.js';
import { REQUESTED_FILE_KIND, classifyRequestedFiles } from '../acceptanceCriteria.js';

import { createDerivedRequestedFileDetails } from '../planner/context/PlanningContextBuilder.js';

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
          authoritySource: 'verified_planning_context',
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
  const canonical = new Set(unique(canonicalFileUniverse).map(normalize));
  const explicitSet = new Set(unique(explicitRequestedNewFiles).map(file => enforceCanonicalExtension(normalize(file)).toLowerCase()));
  const workspace = workspaceState && typeof workspaceState === 'object' ? workspaceState : (verifiedPlanningContext?.workspace || {});
  const projectScanContext = projectScan && typeof projectScan === 'object' ? projectScan : (verifiedPlanningContext?.projectScan || verifiedPlanningContext?.facts || {});

  const baseDetails = classified.map(detail => {
    const path = enforceCanonicalExtension(normalize(detail.path));
    const exists = canonical.has(path) || unique(verifiedPlanningContext?.verifiedFiles || []).map(normalize).includes(path);
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
    authoritySource: 'verified_planning_context',
    authorityState: 'candidate'
  });
}

export function decomposeGoalToExecutionUnits({
  objective = '',
  verifiedPlanningContext = null,
  knowledgeGraph = null,
  canonicalFileUniverse = [],
  plannerPolicies = {},
  projectIntent = {},
  projectScan = {},
  explicitRequestedNewFiles = []
} = {}) {
  const units = [];
  const canonical = unique(canonicalFileUniverse);
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
    bootstrapProfile: verifiedPlanningContext?.bootstrapProfile || null
  });
  const targetFiles = requestedFileDetails.map(detail => detail.path);
  const verifiedFiles = unique(verifiedPlanningContext?.verifiedFiles || []);
  const verifiedCommands = unique(verifiedPlanningContext?.verifiedCommands || []);
  const allowBootstrap = plannerPolicies?.ALLOW_PROJECT_BOOTSTRAP === true;
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
      authoritySource: 'verified_planning_context',
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
  const writeCandidateCount = requestedWriteFiles.length;
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
      authoritySource: 'verified_planning_context',
      authorityState: 'candidate'
    }));
  } else {
    const readTargets = [];
    const writeTargets = [];
    const readSeen = new Set();
    const writeSeen = new Set();
    const canonicalSet = new Set(canonical.map(value => normalize(value).toLowerCase()));

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
            authoritySource: 'verified_planning_context',
            conditional: false,
            explicit: false,
            verified: true
          });
        }
      }
    }

    console.log('[WRITE_CANDIDATE_COUNT]', {
      explicitRequested: requestedWriteFiles.length,
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
        authoritySource: detail.authoritySource || 'verified_planning_context',
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
      const existsInWorkspace = canonicalSet.has(detail.path.toLowerCase());
      const unitType = existsInWorkspace ? EXECUTION_UNIT_TYPES.PATCH : EXECUTION_UNIT_TYPES.WRITE;
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
          plannedNewFile: !existsInWorkspace
        },
        authoritySource: detail.authoritySource || 'workspace_evidence',
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
      authoritySource: 'verified_planning_context',
      authorityState: 'candidate'
    });
    units.push(verifyUnit);

    const ordered = resolveExecutionOrder(units);
    return ordered;
  }

  return resolveExecutionOrder(units);
}
