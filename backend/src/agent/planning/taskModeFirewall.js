const ANSWER_ONLY_PATTERNS = [
  /^\s*\d+\s*[\+\-\*\/]\s*\d+\s*(?:=\s*\d+)?\s*$/,
  /^\s*\d+\s*[\+\-\*\/]\s*\d+\s*=\s*\d+\s*$/,
  /\bwhat\s+is\s+\d+\s*[\+\-\*\/]\s*\d+\b/,
  /\b(?:translate|summarize|summarise|explain|describe|draft|reply|advice|message|q&a|question|answer)\b/
];

const ANSWER_ONLY_PHRASES = [
  'just answer',
  'just reply',
  'answer only',
  'reply only',
  'respond only',
  'chi tra loi',
  'chi can tra loi',
  'tra loi',
  'tra loi thoi',
  'chi tra loi thoi',
  'no explanation',
  'without explanation',
  'without workspace',
  'khong can workspace'
];

const NO_MODIFY_PHRASES = [
  'khong sua',
  'khong thay doi',
  'khong viet',
  'chi doc',
  'chi xem',
  'do not modify',
  'do not change',
  'do not write',
  'do not edit',
  'no changes',
  'no edits',
  'dont modify',
  'dont change',
  'dont write'
];

const READ_ONLY_PATTERNS = [
  /\b(?:read|inspect|analyze|analyse|review|search|find|list|show|open|view|look at)\b/,
  /\b(?:file|folder|directory|repo|repository|workspace|package\.json|src\/|app\/|index\.html)\b/
];

const WORKSPACE_WRITE_PATTERNS = [
  /\b(?:create|build|implement|add|write|generate|update|modify|edit|patch|change|replace|remove|delete|rename|refactor|scaffold|initialize|start|launch)\b/,
  /\b(?:run|validate|test|lint|build|fix)\b/
];

const WORKSPACE_INIT_PATTERNS = [
  /\b(?:create|build|initialize|scaffold|start|launch)\b/,
  /\b(?:react|next(?:\.js)?|vite|astro|laravel|flutter|vue|svelte|landing\s+page|dashboard|app|application)\b/
];

const VALIDATION_PATTERNS = [
  /\b(?:validate|validation|test|lint|check|verify)\b/,
  /\b(?:npm\s+test|npm\s+run|node\s+--test|vitest|jest|pytest|cargo\s+test|go\s+test)\b/
];

const LEGACY_TARGET_PATTERNS = [
  'src/main.js',
  'src/main.jsx',
  'src/app.jsx',
  'src/app.tsx',
  'index.html',
  'package.json'
];

const LEGACY_TARGET_SOURCE_ALLOWLIST = new Set([
  'EXPLICIT_USER_REQUEST',
  'VERIFIED_WORKSPACE_EVIDENCE',
  'WORKSPACE_AUTHORITY',
  'VERIFIED_PLANNING_CONTEXT',
  'VERIFIED_ARTIFACT_MAPPING',
  'APPROVED_EXECUTION_CANDIDATE',
  'EXISTING_WORKSPACE',
  'EXISTING_FILE',
  'OBJECTIVE_AUTHORITY'
]);

const LEGACY_TARGET_SOURCE_BLOCKLIST = new Set([
  'FALLBACK_DEFAULT',
  'LEGACY_DEFAULT',
  'BOOTSTRAP',
  'BOOTSTRAP_PROFILE',
  'TEMPLATE',
  'TEMPLATE_PROFILE',
  'DOMAIN_PROFILE',
  'IMPLICIT_DEFAULT',
  'INFERRED_DEFAULT',
  'UNKNOWN'
]);

function normalizeText(value = '') {
  return String(value || '').trim();
}

function lower(value = '') {
  return normalizeText(value).toLowerCase();
}

function upper(value = '') {
  return normalizeText(value).toUpperCase();
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => normalizeText(value)).filter(Boolean))];
}

function collectObjectiveText(objective = '') {
  return normalizeText(objective).replace(/\r\n/g, '\n');
}

function normalizeIntentText(value = '') {
  return normalizeText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function hasPattern(text = '', patterns = []) {
  return (Array.isArray(patterns) ? patterns : []).some(pattern => pattern.test(text));
}

function includesAny(text = '', phrases = []) {
  return (Array.isArray(phrases) ? phrases : []).some(phrase => text.includes(String(phrase || '').toLowerCase()));
}

function isPathLike(value = '') {
  const text = normalizeText(value);
  return /[\\/]/.test(text) || /\.[a-z0-9]+$/i.test(text);
}

function collectRecordValues(record = {}) {
  const values = [
    record?.path,
    record?.file,
    record?.target,
    record?.suggestedPath,
    ...(Array.isArray(record?.targetFiles) ? record.targetFiles : []),
    ...(Array.isArray(record?.requiredWrites) ? record.requiredWrites : []),
    ...(Array.isArray(record?.requiredReads) ? record.requiredReads : []),
    record?.outputs?.path,
    record?.outputs?.file,
    record?.inputs?.path,
    record?.inputs?.file,
    record?.metadata?.path,
    record?.metadata?.file,
    record?.metadata?.target,
    record?.provenance?.path,
    record?.provenance?.file
  ];
  return unique(values).filter(isPathLike);
}

function isApprovedProvenance(record = {}, context = {}) {
  const authoritySource = upper(
    record?.authoritySource ||
    record?.source ||
    record?.metadata?.authoritySource ||
    record?.metadata?.source ||
    record?.provenance?.authoritySource ||
    ''
  );

  const hasExplicitRequest = authoritySource === 'EXPLICIT_USER_REQUEST' || record?.metadata?.explicitUserRequest === true || record?.requestedKind === 'EXPLICIT_CREATE';
  const hasWorkspaceEvidence = authoritySource === 'VERIFIED_WORKSPACE_EVIDENCE' || authoritySource === 'WORKSPACE_AUTHORITY';
  const hasPlanningContextEvidence = authoritySource === 'VERIFIED_PLANNING_CONTEXT';
  const hasArtifactMapping = authoritySource === 'VERIFIED_ARTIFACT_MAPPING' || authoritySource === 'APPROVED_EXECUTION_CANDIDATE' || Boolean(record?.plannerArtifactId || record?.artifactHash);
  const hasExecutionProvenance = Boolean(
    record?.provenance && typeof record.provenance === 'object' &&
    (
      record.provenance.plannerArtifactId ||
      record.provenance.artifactHash ||
      record.provenance.requirementId ||
      record.provenance.workspaceCapabilityId ||
      record.provenance.selectedImplementationId ||
      record.provenance.selectedVariantId ||
      record.provenance.implementationVariantId
    )
  );
  const hasSelectedImplementation = Boolean(
    record?.selectedImplementationId ||
    record?.selectedVariantId ||
    record?.implementationVariantId ||
    record?.selectedImplementation?.id ||
    context?.selectedImplementation?.id
  );
  const hasPlannerProvenance = hasExplicitRequest || hasWorkspaceEvidence || hasPlanningContextEvidence || hasArtifactMapping || hasExecutionProvenance || hasSelectedImplementation;
  return hasPlannerProvenance;
}

function collectCandidateRecords(input = {}) {
  const records = [];
  const add = (record, stage) => {
    if (!record) return;
    if (typeof record === 'string') {
      records.push({ path: record, stage });
      return;
    }
    if (typeof record !== 'object') return;
    records.push({ stage, ...record });
  };

  const appendCollection = (value, stage) => {
    if (Array.isArray(value)) {
      for (const item of value) add(item, stage);
      return;
    }
    if (value && typeof value === 'object') {
      add(value, stage);
    }
  };

  appendCollection(input?.executionUnits, 'execution_units');
  appendCollection(input?.plannerApprovedArtifacts, 'planner_approved_artifacts');
  appendCollection(input?.executionCandidates, 'execution_candidates');
  appendCollection(input?.artifactCandidates, 'artifact_candidates');
  appendCollection(input?.requestedFileDetails, 'requested_file_details');
  appendCollection(input?.plannedNewFiles, 'planned_new_files');
  appendCollection(input?.generatedFiles, 'generated_files');
  appendCollection(input?.plannedFiles, 'planned_files');
  appendCollection(input?.blockedRecommendations, 'blocked_recommendations');

  return records;
}

function getLeakMissingProvenanceField(record = {}) {
  if (!record?.provenance) return 'provenance';
  if (!record.provenance.plannerArtifactId && !record.provenance.selectedImplementationId && !record.provenance.selectedVariantId && !record.provenance.implementationVariantId) {
    return 'provenance.plannerArtifactId';
  }
  if (!record.provenance.authoritySource) return 'provenance.authoritySource';
  return 'provenance';
}

function getLegacyTargetSource(record = {}) {
  return upper(
    record?.source ||
    record?.authoritySource ||
    record?.metadata?.source ||
    record?.metadata?.authoritySource ||
    record?.provenance?.authoritySource ||
    ''
  );
}

function hasLegacyTargetProvenance(record = {}) {
  const source = getLegacyTargetSource(record);
  if (LEGACY_TARGET_SOURCE_ALLOWLIST.has(source)) return true;

  const provenance = record?.provenance && typeof record.provenance === 'object' ? record.provenance : null;
  if (provenance) {
    if (provenance.plannerArtifactId || provenance.artifactHash || provenance.requirementId || provenance.workspaceCapabilityId) return true;
    if (provenance.selectedImplementationId || provenance.selectedVariantId || provenance.implementationVariantId) return true;
  }

  if (record?.plannerArtifactId || record?.artifactHash || record?.selectedImplementationId || record?.selectedVariantId || record?.implementationVariantId) {
    return true;
  }

  return false;
}

export function classifyAnswerOnlyObjective(objective = '') {
  const rawText = collectObjectiveText(objective);
  const normalized = normalizeIntentText(objective);

  if (!rawText || !normalized) return true;
  if (/^\s*[\d\s+\-*/().=]+\s*$/.test(normalized) && /\d/.test(normalized)) return true;
  if (/^\s*(?:hello|hi|hey|xin chao|chao|hola|bonjour|alo)\b/.test(normalized)) return true;
  if (/^\s*what\s+is\s+\d+\s*[\+\-\*\/]\s*\d+\s*$/.test(normalized)) return true;

  if (includesAny(normalized, ANSWER_ONLY_PHRASES)) return true;
  if (includesAny(normalized, NO_MODIFY_PHRASES) && !/\b(?:create|build|implement|add|write|generate|update|modify|edit|patch|change|replace|remove|delete|rename|refactor|scaffold|initialize|start|launch)\b/.test(normalized)) {
    return true;
  }

  return false;
}

export function classifyTaskMode(objective = '') {
  const text = collectObjectiveText(objective);
  const normalized = normalizeIntentText(objective);
  if (!text) {
    console.log('[TASK_MODE_CLASSIFIED]', { taskMode: 'ANSWER_ONLY', reason: 'empty objective' });
    return 'ANSWER_ONLY';
  }

  if (classifyAnswerOnlyObjective(objective)) {
    console.log('[TASK_MODE_CLASSIFIED]', { taskMode: 'ANSWER_ONLY', reason: 'answer-only objective detected' });
    return 'ANSWER_ONLY';
  }

  if (hasPattern(normalized, VALIDATION_PATTERNS)) {
    console.log('[TASK_MODE_CLASSIFIED]', { taskMode: 'VALIDATION_ONLY', reason: 'validation signal detected' });
    return 'VALIDATION_ONLY';
  }

  if (hasPattern(normalized, WORKSPACE_INIT_PATTERNS) && !/\b(?:src\/|app\/|pages\/|components\/|package\.json|index\.html|\.js\b|\.jsx\b|\.ts\b|\.tsx\b|\.css\b|\.html\b)\b/.test(normalized)) {
    console.log('[TASK_MODE_CLASSIFIED]', { taskMode: 'PROJECT_INITIALIZATION', reason: 'initialization signal detected' });
    return 'PROJECT_INITIALIZATION';
  }

  if (hasPattern(normalized, WORKSPACE_WRITE_PATTERNS)) {
    const mode = /\b(?:modify|update|edit|patch|change|replace|remove|delete|rename|refactor)\b/.test(normalized)
      ? 'WORKSPACE_EDIT'
      : 'WORKSPACE_CODING';
    console.log('[TASK_MODE_CLASSIFIED]', { taskMode: mode, reason: 'workspace write signal detected' });
    return mode;
  }

  if (hasPattern(normalized, READ_ONLY_PATTERNS) || /\b(?:doc|kiem tra|phan tich)\b/.test(normalized)) {
    console.log('[TASK_MODE_CLASSIFIED]', { taskMode: 'READ_ONLY_ANALYSIS', reason: 'read-only signal detected' });
    return 'READ_ONLY_ANALYSIS';
  }

  if (hasPattern(normalized, ANSWER_ONLY_PATTERNS)) {
    console.log('[TASK_MODE_CLASSIFIED]', { taskMode: 'ANSWER_ONLY', reason: 'direct answer signal detected' });
    return 'ANSWER_ONLY';
  }

  console.log('[TASK_MODE_CLASSIFIED]', { taskMode: 'ANSWER_ONLY', reason: 'default non-workspace response' });
  return 'ANSWER_ONLY';
}

export function isAnswerOnlyTask(objective = '', taskMode = null) {
  return upper(taskMode || classifyTaskMode(objective)) === 'ANSWER_ONLY';
}

export function isWorkspaceTask(objective = '', taskMode = null) {
  const mode = upper(taskMode || classifyTaskMode(objective));
  return ['WORKSPACE_CODING', 'WORKSPACE_EDIT', 'PROJECT_INITIALIZATION', 'VALIDATION_ONLY'].includes(mode);
}

export function explainTaskModeDecision(objective = '', taskMode = null) {
  const mode = upper(taskMode || classifyTaskMode(objective));
  if (mode === 'ANSWER_ONLY') return 'Direct answer requested without workspace interaction.';
  if (mode === 'READ_ONLY_ANALYSIS') return 'Read-only analysis requested.';
  if (mode === 'PROJECT_INITIALIZATION') return 'Workspace initialization requested.';
  if (mode === 'VALIDATION_ONLY') return 'Validation-only task requested.';
  if (mode === 'WORKSPACE_EDIT') return 'Workspace edit requested.';
  return 'Workspace coding requested.';
}

export function rejectPlannerForAnswerOnlyTask(objective = '', taskMode = 'ANSWER_ONLY') {
  const decision = {
    allowed: false,
    directAnswer: true,
    taskMode: upper(taskMode || 'ANSWER_ONLY'),
    reason: explainTaskModeDecision(objective, taskMode),
    objective: normalizeText(objective).slice(0, 160)
  };
  console.log('[PLANNER_ENTRY_BLOCKED_ANSWER_ONLY]', decision);
  return decision;
}

export function assertPlannerEntryAllowed(objective = '', taskMode = null) {
  const mode = upper(taskMode || classifyTaskMode(objective));
  if (mode === 'ANSWER_ONLY') {
    return rejectPlannerForAnswerOnlyTask(objective, mode);
  }
  return {
    allowed: true,
    directAnswer: false,
    taskMode: mode,
    reason: explainTaskModeDecision(objective, mode),
    objective: normalizeText(objective).slice(0, 160)
  };
}

export function validateLegacyTargetLeak({
  executionUnits = [],
  plannerApprovedArtifacts = [],
  executionCandidates = [],
  artifactCandidates = [],
  requestedFileDetails = [],
  plannedNewFiles = [],
  generatedFiles = [],
  plannedFiles = [],
  selectedImplementation = null,
  stage = 'planner',
  context = {}
} = {}) {
  const records = collectCandidateRecords({
    executionUnits,
    plannerApprovedArtifacts,
    executionCandidates,
    artifactCandidates,
    requestedFileDetails,
    plannedNewFiles,
    generatedFiles,
    plannedFiles
  });
  const leaks = [];

  console.log('[LEGACY_TARGET_LEAK_CHECK]', {
    stage,
    recordCount: records.length
  });

  for (const record of records) {
    const paths = collectRecordValues(record);
    if (paths.length === 0) continue;
    const source = getLegacyTargetSource(record);
    const sourceAllowed = LEGACY_TARGET_SOURCE_ALLOWLIST.has(source);
    const sourceBlocked = source === '' || LEGACY_TARGET_SOURCE_BLOCKLIST.has(source);
    for (const pathValue of paths) {
      const normalized = lower(pathValue);
      if (!LEGACY_TARGET_PATTERNS.includes(normalized)) continue;
      if (isApprovedProvenance(record, { selectedImplementation, ...context }) || hasLegacyTargetProvenance(record)) continue;
      if (!sourceBlocked && sourceAllowed) continue;
      leaks.push({
        path: pathValue,
        source: normalizeText(source || null),
        stage: record?.stage || stage || null,
        missingProvenanceField: getLeakMissingProvenanceField(record)
      });
    }
  }

  if (leaks.length > 0) {
    console.log('[LEGACY_TARGET_LEAK_DETECTED]', {
      stage,
      leaks
    });
    return {
      valid: false,
      blocked: true,
      reason: 'LEGACY_TARGET_LEAK_DETECTED',
      leaks
    };
  }

  return {
    valid: true,
    blocked: false,
    reason: null,
    leaks: []
  };
}
