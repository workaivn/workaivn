const ALLOWED_INTENT_SOURCES = new Set([
  'EXPLICIT_USER_REQUEST',
  'VERIFIED_PLANNING_CONTEXT',
  'VERIFIED_WORKSPACE_EVIDENCE',
  'WORKSPACE_AUTHORITY',
  'VERIFIED_ARTIFACT_MAPPING',
  'VERIFIED_VALIDATION_COMMAND',
  'APPROVED_EXECUTION_CANDIDATE'
]);

const FORBIDDEN_INTENT_SOURCES = new Set([
  'BOOTSTRAP_PROFILE',
  'TEMPLATE_PROFILE',
  'DOMAIN_PROFILE',
  'PROJECT_TYPE_HINT',
  'LANDING_SIGNAL',
  'KNOWLEDGE_GRAPH',
  'FALLBACK_DEFAULT',
  'STATIC_PRESET',
  'UNVERIFIED_RECOMMENDATION'
]);

const FORBIDDEN_SOURCE_PATTERNS = [
  /bootstrap/i,
  /template/i,
  /domain/i,
  /project[_\s-]?type/i,
  /landing/i,
  /knowledge[_\s-]?graph/i,
  /fallback/i,
  /static[_\s-]?preset/i,
  /unverified[_\s-]?recommendation/i
];

function normalizeText(value = '') {
  return String(value || '').trim();
}

function upper(value = '') {
  return normalizeText(value).toUpperCase();
}

function lower(value = '') {
  return normalizeText(value).toLowerCase();
}

function collectSourceCandidates(value = {}) {
  const candidates = new Set();
  if (typeof value === 'string') {
    candidates.add(value);
  } else if (value && typeof value === 'object') {
    candidates.add(value.source);
    candidates.add(value.authoritySource);
    candidates.add(value.kind);
    candidates.add(value.requestedKind);
    candidates.add(value.origin);
    candidates.add(value.reason);
    candidates.add(value.profileId);
    candidates.add(value.framework);
    candidates.add(value.profile);
    candidates.add(value.metadata?.source);
    candidates.add(value.metadata?.authoritySource);
    candidates.add(value.metadata?.origin);
    candidates.add(value.metadata?.reason);
  }
  return [...candidates].map(entry => normalizeText(entry)).filter(Boolean);
}

function hasForbiddenSource(value = {}) {
  const candidates = collectSourceCandidates(value);
  for (const candidate of candidates) {
    const normalized = upper(candidate);
    if (FORBIDDEN_INTENT_SOURCES.has(normalized)) return normalized;
    if (FORBIDDEN_SOURCE_PATTERNS.some(pattern => pattern.test(candidate))) return normalized || candidate;
  }
  return null;
}

export function validateIntentSource(source = null, evidence = null) {
  const forbidden = hasForbiddenSource(source) || hasForbiddenSource(evidence);
  if (forbidden) {
    return {
      valid: false,
      source: normalizeText(source?.source || source?.authoritySource || source || ''),
      reason: `forbidden intent source: ${forbidden}`
    };
  }

  const normalized = upper(source?.source || source?.authoritySource || source || '');
  if (!normalized) {
    return { valid: false, source: null, reason: 'missing intent source' };
  }

  return {
    valid: ALLOWED_INTENT_SOURCES.has(normalized),
    source: normalized,
    reason: ALLOWED_INTENT_SOURCES.has(normalized) ? null : `unapproved intent source: ${normalized}`
  };
}

export function validateIntentCapability(capability = null, context = {}) {
  const normalized = normalizeText(capability);
  if (!normalized) {
    return { valid: true, capability: null, reason: null };
  }

  const verifiedFramework = normalizeText(context?.verifiedFramework || context?.planningContext?.verifiedFramework || context?.projectScanSnapshot?.verifiedFramework || context?.projectScanSnapshot?.projectType || '');
  if (!verifiedFramework) {
    return {
      valid: false,
      capability: normalized,
      reason: 'framework capability is not verified'
    };
  }

  return {
    valid: true,
    capability: normalized,
    reason: null
  };
}

export function validateIntentCommand(command = null, context = {}) {
  const normalized = normalizeText(command);
  if (!normalized) {
    return { valid: false, command: null, reason: 'missing validation command' };
  }

  const verifiedCommands = [
    ...(Array.isArray(context?.verifiedCommands) ? context.verifiedCommands : []),
    ...(Array.isArray(context?.planningContext?.verifiedCommands) ? context.planningContext.verifiedCommands : []),
    ...(Array.isArray(context?.verifiedValidation?.commands) ? context.verifiedValidation.commands : [])
  ].map(entry => normalizeText(entry).toLowerCase()).filter(Boolean);

  if (verifiedCommands.includes(normalized.toLowerCase())) {
    return { valid: true, command: normalized, reason: null };
  }

  return {
    valid: false,
    command: normalized,
    reason: 'command is not backed by verified validation evidence'
  };
}

export function validateIntentArtifact(artifact = null, context = {}) {
  const artifactObject = artifact && typeof artifact === 'object' ? artifact : {};
  const sourceValue = artifactObject?.source || artifactObject?.authoritySource || artifactObject?.metadata?.source || artifactObject?.metadata?.authoritySource || null;
  if (sourceValue) {
    const source = validateIntentSource(sourceValue, artifactObject);
    if (!source.valid) {
      return {
        valid: false,
        artifact,
        reason: source.reason
      };
    }
  }

  const path = normalizeText(artifactObject?.path || artifactObject?.file || artifactObject?.target || artifactObject?.name || artifact || '');
  if (!path) {
    return { valid: false, artifact, reason: 'missing artifact path' };
  }

  const approvedArtifacts = [
    ...(Array.isArray(context?.approvedArtifactCandidates) ? context.approvedArtifactCandidates : []),
    ...(Array.isArray(context?.verifiedArtifactMappings) ? context.verifiedArtifactMappings : []),
    ...(Array.isArray(context?.explicitRequestedFiles) ? context.explicitRequestedFiles : []),
    ...(Array.isArray(context?.verifiedFiles) ? context.verifiedFiles : [])
  ].map(entry => normalizeText(entry?.path || entry?.file || entry?.target || entry).toLowerCase()).filter(Boolean);

  if (approvedArtifacts.length === 0) {
    return { valid: true, artifact: { ...artifact, path }, reason: null };
  }

  if (approvedArtifacts.includes(path.toLowerCase())) {
    return { valid: true, artifact: { ...artifact, path }, reason: null };
  }

  return {
    valid: false,
    artifact: { ...artifact, path },
    reason: 'artifact is not backed by approved mapping'
  };
}

export function validateIntentGraphPurity(graph = {}, context = {}) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const errors = [];
  const provenanceArtifacts = Array.isArray(context?.plannerApprovedArtifacts) ? context.plannerApprovedArtifacts : [];

  for (const node of nodes) {
    const provenanceCheck = node?.provenance || node?.plannerArtifactId || node?.artifactHash
      ? validateExecutionIntentProvenance(node, { plannerApprovedArtifacts: provenanceArtifacts })
      : { valid: true, errors: [] };
    if (!provenanceCheck.valid) {
      for (const error of provenanceCheck.errors) {
        errors.push(`Node ${node?.id || '<unknown>'}: ${error}`);
      }
      continue;
    }

    if (!node?.provenance && !node?.plannerArtifactId && !node?.artifactHash) {
      const requestedKind = upper(node?.requestedKind || node?.metadata?.requestedKind || '');
      const authoritySource = lower(node?.authoritySource || node?.metadata?.authoritySource || '');
      const explicitUserRequest = requestedKind === 'EXPLICIT_CREATE' ||
        requestedKind === 'EXPLICIT_MODIFICATION' ||
        requestedKind === 'MODIFY' ||
        authoritySource === 'explicit_user_request' ||
        node?.metadata?.explicitUserRequest === true;

      const sourceCheck = validateIntentSource(node?.source || node?.authoritySource || node?.metadata?.source || null, node);
      if (!sourceCheck.valid && !explicitUserRequest) {
        errors.push(`Node ${node?.id || '<unknown>'}: ${sourceCheck.reason}`);
      }

      const capabilityCheck = validateIntentCapability(node?.capability || null, context);
      if (!capabilityCheck.valid && upper(node?.intent || '') === 'FRAMEWORK_DISCOVERY') {
        errors.push(`Node ${node?.id || '<unknown>'}: ${capabilityCheck.reason}`);
      }

      if (upper(node?.intent || '').startsWith('RUN_')) {
        const commandCheck = validateIntentCommand(node?.inputs?.command || node?.outputs?.command || node?.metadata?.command || null, context);
        if (!commandCheck.valid) {
          errors.push(`Node ${node?.id || '<unknown>'}: ${commandCheck.reason}`);
        }
      }

      if (['GENERATE_SOURCE', 'GENERATE_TEST', 'GENERATE_STYLE', 'GENERATE_ASSET', 'GENERATE_CONFIG', 'GENERATE_COMPONENTS', 'GENERATE_VIEW', 'GENERATE_CONTROLLER', 'GENERATE_ICON', 'GENERATE_IMAGE', 'GENERATE_HTML'].includes(upper(node?.intent || ''))) {
        const artifactCheck = validateIntentArtifact(node?.outputs?.path || node?.inputs?.path || node?.outputs?.file || node?.inputs?.file || null, context);
        if (!artifactCheck.valid) {
          errors.push(`Node ${node?.id || '<unknown>'}: ${artifactCheck.reason}`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function explainIntentRejection(reason = '', details = {}) {
  const normalized = normalizeText(reason) || 'intent rejected';
  const detailText = Object.entries(details && typeof details === 'object' ? details : {})
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(', ');
  return detailText ? `${normalized} (${detailText})` : normalized;
}
import { validateExecutionIntentProvenance } from './executionIntentProvenance.js';
