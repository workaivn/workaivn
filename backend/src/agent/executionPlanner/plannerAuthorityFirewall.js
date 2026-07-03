import crypto from 'node:crypto';
import { EXECUTION_UNIT_TYPES } from './executionUnit.js';
import { AuthoritySource, isExecutableAuthoritySource, normalizeAuthoritySource } from '../../planner/authority/AuthoritySource.js';

const ALLOWED_AUTHORITY_SOURCES = new Set([
  AuthoritySource.OBJECTIVE_AUTHORITY,
  AuthoritySource.WORKSPACE_AUTHORITY,
  AuthoritySource.VERIFIED_PLANNING_CONTEXT,
  AuthoritySource.VERIFIED_ARTIFACT_MAPPING
]);

const FORBIDDEN_AUTHORITY_SOURCES = new Set([
  'model output',
  'model_invented',
  'model_reasoning',
  'model-reasoning',
  'heuristic extraction',
  'framework guess',
  'template',
  'project type guess',
  'component guess',
  'natural language alone',
  'failure text alone',
  'stacktrace alone',
  'legacy parser'
]);

const EXECUTABLE_TYPES = new Set([
  EXECUTION_UNIT_TYPES.READ,
  EXECUTION_UNIT_TYPES.WRITE,
  EXECUTION_UNIT_TYPES.PATCH,
  EXECUTION_UNIT_TYPES.DELETE,
  EXECUTION_UNIT_TYPES.MOVE,
  EXECUTION_UNIT_TYPES.RENAME,
  EXECUTION_UNIT_TYPES.RUN_TERMINAL,
  EXECUTION_UNIT_TYPES.VALIDATE,
  EXECUTION_UNIT_TYPES.VERIFY
]);

function normalize(value = '') {
  return String(value || '').replace(/\\/g, '/').trim();
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => normalize(value)).filter(Boolean))];
}

function normalizeSource(value = '') {
  return normalizeAuthoritySource(normalize(value));
}

function collectTargets(candidate = {}) {
  return unique([
    ...(Array.isArray(candidate?.targetFiles) ? candidate.targetFiles : []),
    ...(Array.isArray(candidate?.requiredReads) ? candidate.requiredReads : []),
    ...(Array.isArray(candidate?.requiredWrites) ? candidate.requiredWrites : []),
    ...(Array.isArray(candidate?.inputs?.paths) ? candidate.inputs.paths : []),
    candidate?.inputs?.path,
    candidate?.inputs?.file,
    candidate?.inputs?.command,
    candidate?.outputs?.path,
    candidate?.outputs?.file,
    candidate?.outputs?.command,
    candidate?.toolArgs?.path,
    candidate?.toolArgs?.file,
    candidate?.toolArgs?.target,
    candidate?.toolArgs?.command
  ]);
}

function getAuthoritySource(candidate = {}) {
  return normalizeSource(
    candidate.authoritySource ||
    candidate.authority?.source ||
    candidate.metadata?.authoritySource ||
    candidate.metadata?.authority?.source ||
    candidate.source ||
    candidate.promotionSource ||
    ''
  );
}

function getRequestedKind(candidate = {}) {
  return normalizeSource(
    candidate.requestedKind ||
    candidate.metadata?.requestedKind ||
    candidate.inputs?.requestedKind ||
    candidate.requested?.kind ||
    ''
  ).toUpperCase();
}

function getInitializationMode(context = {}) {
  return String(
    context?.initializationMode ||
    context?.verifiedPlanningContext?.initializationMode ||
    context?.plannerPolicies?.initializationMode ||
    ''
  ).trim().toUpperCase();
}

function isInitializationAuthority(candidate = {}, context = {}) {
  const source = getAuthoritySource(candidate);
  const mode = getInitializationMode(context);
  const policies = context?.plannerPolicies || {};
  const allowed = policies.ALLOW_PROJECT_INITIALIZATION === true ||
    policies.ALLOW_NEW_PROJECT_INITIALIZATION === true ||
    policies.ALLOW_PROJECT_BOOTSTRAP === true;
  return source === AuthoritySource.OBJECTIVE_AUTHORITY && mode === 'PROJECT_INITIALIZATION' && allowed;
}

function isExplicitRequest(candidate = {}) {
  return candidate?.authority?.source === 'explicit_user_request' ||
    candidate?.metadata?.explicitUserRequest === true ||
    candidate?.metadata?.requestedFile === true;
}

function hasVerifiedEvidence(candidate = {}, context = {}) {
  const type = String(candidate?.type || candidate?.tool || '').toUpperCase();
  const verifiedFiles = unique([
    ...(Array.isArray(context?.verifiedPlanningContext?.verifiedFiles) ? context.verifiedPlanningContext.verifiedFiles : []),
    ...(Array.isArray(context?.verifiedFiles) ? context.verifiedFiles : []),
    ...(Array.isArray(context?.workspaceState?.existingFiles) ? context.workspaceState.existingFiles : []),
    ...(Array.isArray(context?.canonicalFileUniverse) ? context.canonicalFileUniverse : [])
  ]);
  const verifiedCommands = unique([
    ...(Array.isArray(context?.verifiedPlanningContext?.verifiedCommands) ? context.verifiedPlanningContext.verifiedCommands : []),
    ...(Array.isArray(context?.verifiedCommands) ? context.verifiedCommands : []),
    ...(Array.isArray(context?.projectScan?.testCommands) ? context.projectScan.testCommands : []),
    ...(Array.isArray(context?.projectScan?.buildCommands) ? context.projectScan.buildCommands : []),
    ...(Array.isArray(context?.projectScan?.runCommands) ? context.projectScan.runCommands : [])
  ]);
  const targets = collectTargets(candidate);
  const source = getAuthoritySource(candidate);

  if (source === 'validated_recovery') return true;
  if (isExplicitRequest(candidate)) return true;
  if (source === AuthoritySource.OBJECTIVE_AUTHORITY && isInitializationAuthority(candidate, context)) return true;
  if (source === AuthoritySource.VERIFIED_PLANNING_CONTEXT && (type === EXECUTION_UNIT_TYPES.READ || type === EXECUTION_UNIT_TYPES.VERIFY || type === EXECUTION_UNIT_TYPES.RUN_TERMINAL || type === EXECUTION_UNIT_TYPES.VALIDATE)) {
    return true;
  }
  if (source === AuthoritySource.VERIFIED_ARTIFACT_MAPPING) {
    return targets.length > 0;
  }
  if (source === AuthoritySource.WORKSPACE_AUTHORITY || source === AuthoritySource.VERIFIED_PLANNING_CONTEXT) {
    return targets.every(target => verifiedFiles.includes(target) || verifiedCommands.includes(target));
  }
  if (source === AuthoritySource.OBJECTIVE_AUTHORITY) return true;
  return false;
}

function hasCanonicalPathMatch(candidate = {}, context = {}) {
  const source = getAuthoritySource(candidate);
  const canonical = new Set(unique(context?.canonicalFileUniverse || []).map(normalize));
  const targets = collectTargets(candidate).map(normalize);
  if (targets.length === 0) return true;
  if (candidate?.tool === 'RUN_TERMINAL' || candidate?.type === EXECUTION_UNIT_TYPES.RUN_TERMINAL || candidate?.tool === 'VALIDATE') {
    return true;
  }
  if (candidate?.tool === 'READ_FILE' || candidate?.tool === 'WRITE_FILE' || candidate?.tool === 'APPLY_PATCH') {
    return targets.every(target =>
      canonical.size === 0 ||
      canonical.has(target) ||
      isExplicitRequest(candidate) ||
      source === AuthoritySource.OBJECTIVE_AUTHORITY ||
      source === AuthoritySource.WORKSPACE_AUTHORITY ||
      source === AuthoritySource.VERIFIED_PLANNING_CONTEXT ||
      source === AuthoritySource.VERIFIED_ARTIFACT_MAPPING
    );
  }
  return true;
}

function hasPlannerPolicy(candidate = {}, context = {}) {
  const policies = context?.plannerPolicies || {};
  const source = getAuthoritySource(candidate);
  if (candidate?.tool === 'WRITE_FILE' || candidate?.tool === 'APPLY_PATCH' || candidate?.type === EXECUTION_UNIT_TYPES.WRITE || candidate?.type === EXECUTION_UNIT_TYPES.PATCH) {
    if (candidate?.metadata?.explicitUserRequest === true || candidate?.metadata?.requestedFile === true) return true;
    if (source === AuthoritySource.OBJECTIVE_AUTHORITY && isInitializationAuthority(candidate, context)) return true;
    return policies.ALLOW_EXISTING_PROJECT_MODIFICATION === true ||
      policies.ALLOW_NEW_FILE_CREATION === true ||
      policies.ALLOW_PROJECT_BOOTSTRAP === true ||
      policies.ALLOW_NEW_PROJECT_INITIALIZATION === true ||
      policies.ALLOW_PROJECT_INITIALIZATION === true;
  }
  if (candidate?.tool === 'RUN_TERMINAL' || candidate?.tool === 'VALIDATE' || candidate?.type === EXECUTION_UNIT_TYPES.RUN_TERMINAL || candidate?.type === EXECUTION_UNIT_TYPES.VALIDATE) {
    return policies.ALLOW_TERMINAL_COMMANDS !== false;
  }
  return true;
}

function hasProtectedFileViolation(candidate = {}) {
  const targets = collectTargets(candidate).map(normalize).map(value => value.toLowerCase());
  return targets.some(target => /(?:^|\/)(?:package\.json|composer\.json|pom\.xml|tsconfig(?:\.[^.]+)?\.json|vite\.config\.[^.]+|index\.html)$/i.test(target));
}

export function validatePlannerAuthority(candidate = {}, context = {}) {
  const source = getAuthoritySource(candidate);
  const requestedKind = getRequestedKind(candidate);
  const approvalId = normalize(candidate.approvalId || candidate.authority?.approvalId || '');
  const approvalState = normalize(candidate.authorityState || candidate.authority?.approvalState || '').toLowerCase();
  const approvedByFirewall = candidate.approvedByFirewall === true || approvalState === 'approved';
  const type = String(candidate.type || candidate.tool || '').toUpperCase();
  const executable = EXECUTABLE_TYPES.has(type) || Boolean(candidate.tool);

  const targets = collectTargets(candidate);
  const hasPackageJson = targets.some(t => /(?:^|\/)package\.json$/i.test(t));
  const isExplicitNew = candidate?.authority?.source === 'explicit_user_request' ||
    candidate?.metadata?.explicitUserRequest === true ||
    candidate?.metadata?.requestedFile === true;

  if (isExplicitNew && hasPackageJson && !isExplicitRequest(candidate)) {
    console.log('[PACKAGE_JSON_INFERENCE_BLOCKED]', {
      candidateId: candidate.id || null,
      targets,
      reason: 'package.json was inferred, not explicitly requested'
    });
  }

  if (isExplicitNew) {
    console.log('[EXPLICIT_USER_AUTHORITY_DETECTED]', {
      candidateId: candidate.id || null,
      type: type || null,
      source,
      targets
    });
  }

  if (source === AuthoritySource.OBJECTIVE_AUTHORITY) {
    console.log('[OBJECTIVE_AUTHORITY_CREATED]', {
      candidateId: candidate.id || null,
      targets,
      initializationMode: getInitializationMode(context) || null
    });
  }

  if (targets.length > 0) {
    console.log('[PATH_EXTENSION_PRESERVED]', {
      candidateId: candidate.id || null,
      paths: targets,
      note: 'Extensions preserved exactly as specified'
    });
  }

  console.log('[AUTHORITY_FIREWALL_ENTER]', {
    candidateId: candidate.id || null,
    type: type || null,
    source: source || null,
    requestedKind: requestedKind || null
  });
  console.log('[AUTHORITY_SOURCE]', {
    candidateId: candidate.id || null,
    source: source || null,
    approvedByFirewall
  });

  if (!executable) {
    return { valid: true, reason: null, source: source || 'non_executable', approvalId: approvalId || null };
  }

  if (!source) {
    console.log('[AUTHORITY_REJECTED]', {
      candidateId: candidate.id || null,
      reason: 'authority missing'
    });
    return { valid: false, reason: 'authority missing', source: null, approvalId: null };
  }

  if (executable && !isExecutableAuthoritySource(source)) {
    console.log('[AUTHORITY_SOURCE_REJECTED]', {
      candidateId: candidate.id || null,
      source,
      reason: 'authority source is not executable'
    });
    return { valid: false, reason: 'authority source is not executable', source, approvalId: null };
  }

  if (FORBIDDEN_AUTHORITY_SOURCES.has(source)) {
    console.log('[AUTHORITY_REJECTED]', {
      candidateId: candidate.id || null,
      reason: 'forbidden authority source',
      source
    });
    return { valid: false, reason: 'forbidden authority source', source, approvalId: null };
  }

  if (type === EXECUTION_UNIT_TYPES.WRITE || type === EXECUTION_UNIT_TYPES.PATCH || candidate?.tool === 'WRITE_FILE' || candidate?.tool === 'APPLY_PATCH') {
    if (requestedKind === 'REFERENCE_ONLY' || requestedKind === 'DISCOVER_IF_EXISTS') {
      console.log('[REFERENCE_ONLY_FILE]', {
        candidateId: candidate.id || null,
        requestedKind,
        path: collectTargets(candidate)[0] || null
      });
      console.log('[AUTHORITY_REJECTED]', {
        candidateId: candidate.id || null,
        reason: 'reference-only file cannot become executable write',
        requestedKind
      });
      return { valid: false, reason: 'reference-only file cannot become executable write', source, approvalId: null };
    }
    if (requestedKind === 'DERIVED') {
      console.log('[DERIVED_FILE_BLOCKED]', {
        candidateId: candidate.id || null,
        path: collectTargets(candidate)[0] || null
      });
      console.log('[AUTHORITY_REJECTED]', {
        candidateId: candidate.id || null,
        reason: 'derived file cannot become executable write',
        requestedKind
      });
      return { valid: false, reason: 'derived file cannot become executable write', source, approvalId: null };
    }
    if (requestedKind === 'CONDITIONAL' && candidate.verified !== true && candidate.metadata?.verified !== true) {
      console.log('[CONDITIONAL_FILE]', {
        candidateId: candidate.id || null,
        path: collectTargets(candidate)[0] || null
      });
      console.log('[AUTHORITY_REJECTED]', {
        candidateId: candidate.id || null,
        reason: 'conditional file requires verified condition before write',
        requestedKind
      });
      return { valid: false, reason: 'conditional file requires verified condition before write', source, approvalId: null };
    }
  }

  if (!ALLOWED_AUTHORITY_SOURCES.has(source) && source !== 'planner_dependency') {
    if (isExplicitNew) {
      console.log('[EXPLICIT_USER_PATH_REJECTED]', {
        candidateId: candidate.id || null,
        reason: 'unknown authority source',
        source,
        targets
      });
    }
    console.log('[AUTHORITY_REJECTED]', {
      candidateId: candidate.id || null,
      reason: 'unknown authority source',
      source
    });
    return { valid: false, reason: 'unknown authority source', source, approvalId: null };
  }

  if (type === EXECUTION_UNIT_TYPES.VERIFY) {
    console.log('[AUTHORITY_VALID]', {
      candidateId: candidate.id || null,
      source,
      approvalId: approvalId || null
    });
    console.log('[AUTHORITY_APPROVED]', {
      candidateId: candidate.id || null,
      source,
      approvalId: approvalId || null
    });
    return { valid: true, reason: null, source, approvalId: approvalId || `approval:${crypto.randomUUID()}` };
  }

  if (candidate.proposal == null && candidate.approvedByFirewall !== true && source !== 'validated_recovery' && source !== AuthoritySource.OBJECTIVE_AUTHORITY && source !== AuthoritySource.WORKSPACE_AUTHORITY && source !== AuthoritySource.VERIFIED_PLANNING_CONTEXT && source !== AuthoritySource.VERIFIED_ARTIFACT_MAPPING) {
    console.log('[AUTHORITY_REJECTED]', {
      candidateId: candidate.id || null,
      reason: 'proposal missing',
      source
    });
    return { valid: false, reason: 'proposal missing', source, approvalId: null };
  }

  if (!hasPlannerPolicy(candidate, context)) {
    console.log('[AUTHORITY_POLICY]', {
      candidateId: candidate.id || null,
      source,
      reason: 'planner policy violation'
    });
    console.log('[AUTHORITY_REJECTED]', {
      candidateId: candidate.id || null,
      reason: 'planner policy violation'
    });
    return { valid: false, reason: 'planner policy violation', source, approvalId: null };
  }

  if (!hasVerifiedEvidence(candidate, context)) {
    console.log('[AUTHORITY_SCOPE]', {
      candidateId: candidate.id || null,
      source,
      reason: 'verified evidence required'
    });
    console.log('[AUTHORITY_REJECTED]', {
      candidateId: candidate.id || null,
      reason: 'verified evidence required'
    });
    return { valid: false, reason: 'verified evidence required', source, approvalId: null };
  }

  if (!hasCanonicalPathMatch(candidate, context)) {
    console.log('[AUTHORITY_PATH]', {
      candidateId: candidate.id || null,
      source,
      reason: 'canonical path mismatch'
    });
    console.log('[AUTHORITY_REJECTED]', {
      candidateId: candidate.id || null,
      reason: 'canonical path mismatch'
    });
    return { valid: false, reason: 'canonical path mismatch', source, approvalId: null };
  }

  {
    const protectedCheck = hasProtectedFileViolation(candidate);
    const isExplicit = isExplicitRequest(candidate);
    console.log('[PROTECTED_SCOPE_CHECK]', {
      candidateId: candidate.id || null,
      targets: collectTargets(candidate),
      hasProtectedViolation: protectedCheck,
      isExplicitRequest: isExplicit,
      source
    });
    if (protectedCheck && !(isExplicit || source === AuthoritySource.WORKSPACE_AUTHORITY || source === AuthoritySource.VERIFIED_PLANNING_CONTEXT || (source === AuthoritySource.OBJECTIVE_AUTHORITY && isInitializationAuthority(candidate, context)))) {
      console.log('[PROTECTED_SCOPE_REJECTED]', {
        candidateId: candidate.id || null,
        targets: collectTargets(candidate),
        source,
        reason: 'Protected file violation — file matched protected pattern and is not an explicit user request'
      });
      console.log('[AUTHORITY_PATH]', {
        candidateId: candidate.id || null,
        source,
        reason: 'protected file violation'
      });
      console.log('[AUTHORITY_REJECTED]', {
        candidateId: candidate.id || null,
        reason: 'protected file violation'
      });
      return { valid: false, reason: 'protected file violation', source, approvalId: null };
    }
    if (!protectedCheck || isExplicit) {
      console.log('[PROTECTED_SCOPE_ALLOWED]', {
        candidateId: candidate.id || null,
        targets: collectTargets(candidate),
        reason: protectedCheck ? 'Explicit request bypasses protected scope' : 'No protected file match'
      });
    }
  }

  if (isExplicitNew) {
    console.log('[EXPLICIT_USER_PATH_APPROVED]', {
      candidateId: candidate.id || null,
      targets,
      approvalId: approvalId || null
    });
  }

  console.log('[AUTHORITY_VALID]', {
    candidateId: candidate.id || null,
    source,
    approvalId: approvalId || null
  });
  console.log('[AUTHORITY_APPROVED]', {
    candidateId: candidate.id || null,
    source,
    approvalId: approvalId || null
  });
  if (source === AuthoritySource.OBJECTIVE_AUTHORITY) {
    console.log('[OBJECTIVE_AUTHORITY_APPROVED]', {
      candidateId: candidate.id || null,
      targets,
      approvalId: approvalId || null,
      initializationMode: getInitializationMode(context) || null
    });
  }

  return { valid: true, reason: null, source, approvalId: approvalId || `approval:${crypto.randomUUID()}` };
}

export function approvePlannerAuthority(candidate = {}, context = {}) {
  const validation = validatePlannerAuthority(candidate, context);
  if (!validation.valid) {
    return { valid: false, candidate, validation };
  }

  const approvalId = validation.approvalId || `approval:${crypto.randomUUID()}`;
  const approved = {
    ...candidate,
    authoritySource: validation.source,
    authorityState: 'approved',
    approvalId,
    approvedByFirewall: true,
    metadata: {
      ...(candidate.metadata && typeof candidate.metadata === 'object' ? candidate.metadata : {}),
      authoritySource: validation.source,
      authorityState: 'approved',
      approvalId,
      approvedByFirewall: true
    }
  };

  console.log('[EXECUTION_UNIT_APPROVED]', {
    candidateId: approved.id || null,
    source: validation.source,
    approvalId
  });

  return { valid: true, candidate: approved, validation };
}
