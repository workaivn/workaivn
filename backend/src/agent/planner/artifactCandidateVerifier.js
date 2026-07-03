import path from 'node:path';

function normalizePath(value = '') {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .trim();
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))];
}

function toLower(value = '') {
  return String(value || '').toLowerCase();
}

const ALLOWED_ORIGINS = new Set(['objective', 'workspace', 'model_candidate', 'verified_context', 'capability_graph']);
const FORBIDDEN_ORIGINS = new Set([
  'bootstrap_profile',
  'template',
  'goaltype_mapping',
  'landingsignals',
  'static_component_map',
  'framework_default'
]);
const ALLOWED_AUTHORITY_SOURCES = new Set([
  'OBJECTIVE_AUTHORITY',
  'WORKSPACE_AUTHORITY',
  'VERIFIED_PLANNING_CONTEXT',
  'VERIFIED_ARTIFACT_MAPPING'
]);
const FORBIDDEN_LEAK_PATTERNS = [/react-vite-ts/i, /bootstrap/i, /template/i, /static[_\s-]?component/i, /framework[_\s-]?default/i];

function collectWorkspaceFiles(projectScanSnapshot = {}, planningContext = {}) {
  return unique([
    ...(Array.isArray(projectScanSnapshot?.discoveredFiles) ? projectScanSnapshot.discoveredFiles : []),
    ...(Array.isArray(projectScanSnapshot?.files) ? projectScanSnapshot.files : []),
    ...(Array.isArray(planningContext?.verifiedFiles) ? planningContext.verifiedFiles : []),
    ...(Array.isArray(planningContext?.plannedFiles) ? planningContext.plannedFiles : []),
    ...(Array.isArray(planningContext?.facts?.discoveredFiles) ? planningContext.facts.discoveredFiles : [])
  ].map(normalizePath));
}

function isUnsafePath(candidatePath = '') {
  const normalized = normalizePath(candidatePath);
  return !normalized || path.isAbsolute(normalized) || normalized.startsWith('../') || normalized.includes('/../') || normalized.includes('\\..\\') || normalized.includes('..\\') || normalized.includes('://');
}

function normalizeOperation(candidate = {}) {
  return String(candidate?.suggestedOperation || candidate?.operation || 'create').trim().toLowerCase();
}

function validateDependencies(candidate = {}, candidatesById = new Map()) {
  const dependencies = unique(candidate?.dependencies || []);
  if (dependencies.some(dep => dep === candidate.id)) {
    return { valid: false, reason: 'dependency cycle detected' };
  }
  for (const dep of dependencies) {
    if (!candidatesById.has(dep)) continue;
    const dependent = candidatesById.get(dep);
    if (Array.isArray(dependent?.dependencies) && dependent.dependencies.includes(candidate.id)) {
      return { valid: false, reason: 'dependency cycle detected' };
    }
  }
  return { valid: true };
}

export function verifyArtifactCandidates(candidates = [], {
  projectScanSnapshot = {},
  planningContext = {},
  policies = {}
} = {}) {
  const workspaceFiles = new Set(collectWorkspaceFiles(projectScanSnapshot, planningContext).map(file => toLower(file)));
  const candidatesById = new Map((Array.isArray(candidates) ? candidates : []).map(candidate => [candidate.id, candidate]));
  const verifiedCandidates = [];
  const rejectedCandidates = [];
  const pathResolutionRequired = [];

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const origin = toLower(candidate?.origin || '');
    const authoritySource = String(candidate?.authoritySource || '').trim().toUpperCase();
    const pathValue = normalizePath(candidate?.suggestedPath || '');
    const operation = normalizeOperation(candidate);

    if (!ALLOWED_ORIGINS.has(origin) || FORBIDDEN_ORIGINS.has(origin)) {
      const reason = 'forbidden artifact origin';
      console.log('[ARTIFACT_CANDIDATE_REJECTED]', { id: candidate?.id || null, name: candidate?.name || null, reason, origin });
      rejectedCandidates.push({ ...candidate, verified: false, executable: false, rejectionReason: reason });
      continue;
    }

    if (!ALLOWED_AUTHORITY_SOURCES.has(authoritySource)) {
      const reason = 'invalid authority source';
      console.log('[ARTIFACT_CANDIDATE_REJECTED]', { id: candidate?.id || null, name: candidate?.name || null, reason, authoritySource });
      rejectedCandidates.push({ ...candidate, verified: false, executable: false, rejectionReason: reason });
      continue;
    }

    const dependencyCheck = validateDependencies(candidate, candidatesById);
    if (!dependencyCheck.valid) {
      console.log('[ARTIFACT_CANDIDATE_REJECTED]', {
        id: candidate?.id || null,
        name: candidate?.name || null,
        reason: dependencyCheck.reason
      });
      rejectedCandidates.push({ ...candidate, verified: false, executable: false, rejectionReason: dependencyCheck.reason });
      continue;
    }

    const leakDetected = [candidate?.name, candidate?.purpose, candidate?.suggestedPath, ...(Array.isArray(candidate?.evidence) ? candidate.evidence : [])]
      .some(value => FORBIDDEN_LEAK_PATTERNS.some(pattern => pattern.test(String(value || ''))));
    if (leakDetected) {
      const reason = 'forbidden profile or template leak';
      console.log('[ARTIFACT_CANDIDATE_REJECTED]', { id: candidate?.id || null, name: candidate?.name || null, reason });
      rejectedCandidates.push({ ...candidate, verified: false, executable: false, rejectionReason: reason });
      continue;
    }

    if (!pathValue) {
      console.log('[PATH_RESOLUTION_REQUIRED]', {
        id: candidate?.id || null,
        name: candidate?.name || null,
        origin,
        reason: 'suggestedPath missing'
      });
      pathResolutionRequired.push({ ...candidate, verified: false, executable: false, suggestedPath: null });
      continue;
    }

    if (isUnsafePath(pathValue)) {
      const reason = 'path escapes workspace';
      console.log('[ARTIFACT_CANDIDATE_REJECTED]', { id: candidate?.id || null, name: candidate?.name || null, reason, suggestedPath: pathValue });
      rejectedCandidates.push({ ...candidate, verified: false, executable: false, rejectionReason: reason, suggestedPath: pathValue });
      continue;
    }

    const normalizedPath = normalizePath(pathValue);
    const exists = workspaceFiles.has(toLower(normalizedPath));
    const initializationAllowed = policies?.ALLOW_PROJECT_INITIALIZATION === true ||
      policies?.ALLOW_NEW_PROJECT_INITIALIZATION === true ||
      policies?.ALLOW_PROJECT_BOOTSTRAP === true;
    if ((operation === 'create' || operation === 'write') && !initializationAllowed && origin !== 'workspace') {
      const reason = 'project initialization disabled';
      console.log('[ARTIFACT_CANDIDATE_REJECTED]', { id: candidate?.id || null, name: candidate?.name || null, reason, suggestedPath: normalizedPath });
      rejectedCandidates.push({ ...candidate, verified: false, executable: false, rejectionReason: reason, suggestedPath: normalizedPath });
      continue;
    }
    if (operation === 'patch' && !exists) {
      const reason = 'patch target does not exist';
      console.log('[ARTIFACT_CANDIDATE_REJECTED]', { id: candidate?.id || null, name: candidate?.name || null, reason, suggestedPath: normalizedPath });
      rejectedCandidates.push({ ...candidate, verified: false, executable: false, rejectionReason: reason, suggestedPath: normalizedPath });
      continue;
    }

    if ((operation === 'create' || operation === 'write') && exists && candidate?.origin !== 'workspace') {
      const reason = 'creation candidate conflicts with existing file';
      console.log('[ARTIFACT_CANDIDATE_REJECTED]', { id: candidate?.id || null, name: candidate?.name || null, reason, suggestedPath: normalizedPath });
      rejectedCandidates.push({ ...candidate, verified: false, executable: false, rejectionReason: reason, suggestedPath: normalizedPath });
      continue;
    }

    const verifiedCandidate = {
      ...candidate,
      origin,
      authoritySource,
      suggestedPath: normalizedPath,
      suggestedOperation: operation,
      verified: true,
      executable: false
    };
    console.log('[ARTIFACT_CANDIDATE_VERIFIED]', {
      id: verifiedCandidate.id || null,
      name: verifiedCandidate.name || null,
      origin: verifiedCandidate.origin,
      authoritySource: verifiedCandidate.authoritySource,
      suggestedPath: verifiedCandidate.suggestedPath || null,
      suggestedOperation: verifiedCandidate.suggestedOperation
    });
    verifiedCandidates.push(verifiedCandidate);
  }

  return {
    verifiedCandidates,
    rejectedCandidates,
    pathResolutionRequired
  };
}
