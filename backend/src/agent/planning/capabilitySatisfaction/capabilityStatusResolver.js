function normalize(value = '') {
  return String(value || '').trim();
}

function upper(value = '') {
  return normalize(value).toUpperCase();
}

function lower(value = '') {
  return normalize(value).toLowerCase();
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => normalize(value)).filter(Boolean))];
}

function capabilityKey(value = '') {
  return upper(value).replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

const PARTIAL_RELATIONS = new Map([
  ['ROUTING', ['APPLICATION_ENTRY', 'ROOT_COMPONENT', 'LAYOUT', 'SEMANTIC_HTML']],
  ['APPLICATION_ENTRY', ['ROOT_COMPONENT', 'LAYOUT', 'SEMANTIC_HTML']],
  ['ROOT_COMPONENT', ['APPLICATION_ENTRY', 'LAYOUT']],
  ['GLOBAL_STYLE', ['STYLING', 'STYLING_SYSTEM', 'THEME']],
  ['STYLING', ['GLOBAL_STYLE', 'THEME']],
  ['THEME', ['GLOBAL_STYLE', 'STYLING', 'STYLING_SYSTEM']],
  ['NAVIGATION', ['APPLICATION_ENTRY', 'ROOT_COMPONENT', 'LAYOUT']],
  ['CTA', ['HERO', 'FEATURES', 'GLOBAL_STYLE']],
  ['FOOTER', ['NAVIGATION', 'LAYOUT']],
  ['AUTH', ['API_LAYER', 'STATE', 'VALIDATION']],
  ['TEST', ['VALIDATION']],
  ['BUILD', ['PROJECT_MANIFEST', 'DEPENDENCY_MANIFEST']],
  ['VALIDATION', ['TEST']],
  ['DATABASE_SCHEMA', ['API_LAYER', 'STATE']]
]);

function getWorkspaceArtifacts(workspaceCapabilities = [], capability = '') {
  const key = capabilityKey(capability);
  const record = (Array.isArray(workspaceCapabilities) ? workspaceCapabilities : []).find(entry => capabilityKey(entry?.capability) === key) || null;
  const existingArtifacts = Array.isArray(record?.existingArtifacts) ? record.existingArtifacts : [];
  const requestedArtifacts = Array.isArray(record?.requestedArtifacts) ? record.requestedArtifacts : [];
  const candidateArtifacts = Array.isArray(record?.candidateArtifacts) ? record.candidateArtifacts : [];
  return {
    record,
    existingArtifacts,
    requestedArtifacts,
    candidateArtifacts
  };
}

function hasExistingArtifacts(record = {}) {
  return Array.isArray(record?.existingArtifacts) && record.existingArtifacts.length > 0;
}

function hasAnyArtifacts(record = {}) {
  return hasExistingArtifacts(record) ||
    (Array.isArray(record?.candidateArtifacts) && record.candidateArtifacts.length > 0) ||
    (Array.isArray(record?.requestedArtifacts) && record.requestedArtifacts.length > 0);
}

function collectEvidence(record = {}, fallbackCapability = '') {
  const evidence = [
    ...(Array.isArray(record?.evidence) ? record.evidence : []),
    ...(Array.isArray(record?.existingArtifacts) ? record.existingArtifacts.flatMap(artifact => artifact?.evidence || []) : []),
    ...(Array.isArray(record?.requestedArtifacts) ? record.requestedArtifacts.flatMap(artifact => artifact?.evidence || []) : []),
    `capability:${capabilityKey(fallbackCapability)}`
  ];
  return unique(evidence);
}

function isInitializationAllowed(planningContext = {}) {
  const policies = planningContext?.policies || planningContext?.plannerPolicies || {};
  return (
    policies.ALLOW_PROJECT_INITIALIZATION === true ||
    policies.ALLOW_NEW_PROJECT_INITIALIZATION === true ||
    planningContext?.initializationMode === 'PROJECT_INITIALIZATION' ||
    planningContext?.objectiveAuthorityEligible === true
  );
}

function blockedReasonForRequirement(requirement = {}, planningContext = {}) {
  const capability = capabilityKey(requirement?.capability || '');
  const policyName = `ALLOW_${capability}`;
  const policies = planningContext?.policies || planningContext?.plannerPolicies || {};
  if (String(requirement?.policy || '').toUpperCase() === 'DISABLED') {
    return 'Capability disabled by policy';
  }
  if (Object.prototype.hasOwnProperty.call(policies, policyName) && policies[policyName] === false) {
    return 'Capability disabled by policy';
  }
  if (Object.prototype.hasOwnProperty.call(requirement || {}, 'blocked') && requirement.blocked === true) {
    return String(requirement?.blockedReason || 'Capability blocked');
  }
  return null;
}

function buildWorkspaceArtifactList(record = {}) {
  return [
    ...(Array.isArray(record?.existingArtifacts) ? record.existingArtifacts : []).map(artifact => ({
      ...artifact,
      kind: 'existing'
    })),
    ...(Array.isArray(record?.candidateArtifacts) ? record.candidateArtifacts : []).map(artifact => ({
      ...artifact,
      kind: artifact.kind || artifact.operation || 'create'
    })),
    ...(Array.isArray(record?.requestedArtifacts) ? record.requestedArtifacts : []).map(artifact => ({
      ...artifact,
      kind: 'requested'
    }))
  ];
}

function resolvePartialMatch(requirement = {}, workspaceCapabilities = []) {
  const capability = capabilityKey(requirement?.capability || '');
  const relatedKeys = PARTIAL_RELATIONS.get(capability) || [];
  for (const relatedKey of relatedKeys) {
    const related = getWorkspaceArtifacts(workspaceCapabilities, relatedKey);
    if (hasExistingArtifacts(related.record)) {
      return {
        relatedCapability: relatedKey,
        artifacts: buildWorkspaceArtifactList(related.record),
        reason: `Related capability ${relatedKey} exists`
      };
    }
  }
  return null;
}

export function resolveCapabilityStatus({
  requirement = {},
  workspaceCapabilities = [],
  planningContext = {},
  projectScanSnapshot = {},
  objective = ''
} = {}) {
  const capability = capabilityKey(requirement?.capability || requirement?.artifactKind || 'UNKNOWN');
  const exact = getWorkspaceArtifacts(workspaceCapabilities, capability);
  const workspaceEmpty = !Array.isArray(projectScanSnapshot?.discoveredFiles) || projectScanSnapshot.discoveredFiles.length === 0;
  const initializationEligible = workspaceEmpty && isInitializationAllowed(planningContext);
  const blockedReason = blockedReasonForRequirement(requirement, planningContext);
  const exactArtifacts = buildWorkspaceArtifactList(exact.record).filter(artifact => artifact.kind === 'existing');

  if (blockedReason) {
    return {
      requirementId: requirement?.id || null,
      capability,
      status: 'BLOCKED',
      confidence: Number.isFinite(Number(requirement?.confidence)) ? Number(requirement.confidence) : 0.5,
      evidence: collectEvidence(exact.record || {}, capability),
      workspaceArtifacts: exactArtifacts,
      initializationEligible: false,
      plannerAction: 'NONE',
      plannerRecommendation: 'NONE',
      reason: blockedReason,
      requirement: { ...requirement, capability }
    };
  }

  if (hasExistingArtifacts(exact.record)) {
    return {
      requirementId: requirement?.id || null,
      capability,
      status: 'SATISFIED',
      confidence: Math.max(Number(exact.record?.confidence || 0), Number(requirement?.confidence || 0)),
      evidence: collectEvidence(exact.record || {}, capability),
      workspaceArtifacts: exactArtifacts,
      initializationEligible: false,
      plannerAction: 'REUSE',
      plannerRecommendation: 'REUSE',
      reason: 'Exact workspace capability is satisfied',
      requirement: { ...requirement, capability }
    };
  }

  const partialMatch = resolvePartialMatch(requirement, workspaceCapabilities);
  if (partialMatch) {
    return {
      requirementId: requirement?.id || null,
      capability,
      status: 'PARTIALLY_SATISFIED',
      confidence: Math.max(Number(requirement?.confidence || 0), 0.55),
      evidence: unique([
        ...collectEvidence(exact.record || {}, capability),
        ...partialMatch.artifacts.flatMap(artifact => artifact?.evidence || []),
        `objective:${String(objective || '').slice(0, 120)}`
      ]),
      workspaceArtifacts: partialMatch.artifacts,
      initializationEligible,
      plannerAction: 'PATCH',
      plannerRecommendation: 'PATCH',
      reason: partialMatch.reason,
      requirement: { ...requirement, capability }
    };
  }

  return {
    requirementId: requirement?.id || null,
    capability,
    status: 'MISSING',
    confidence: Number.isFinite(Number(requirement?.confidence)) ? Number(requirement.confidence) : 0.5,
    evidence: unique([
      ...collectEvidence(exact.record || {}, capability),
      `objective:${String(objective || '').slice(0, 120)}`,
      `projectType:${String(projectScanSnapshot?.projectType || 'generic')}`
    ]),
    workspaceArtifacts: [],
    initializationEligible,
    plannerAction: initializationEligible ? 'INITIALIZE' : 'NONE',
    plannerRecommendation: initializationEligible ? 'INITIALIZE' : 'NONE',
    reason: workspaceEmpty
      ? 'Workspace contains no artifact satisfying the capability'
      : 'No workspace artifact satisfies the capability',
    requirement: { ...requirement, capability }
  };
}

export function resolveCapabilityStatuses({
  requirements = [],
  workspaceCapabilities = [],
  planningContext = {},
  projectScanSnapshot = {},
  objective = ''
} = {}) {
  return (Array.isArray(requirements) ? requirements : []).map(requirement => resolveCapabilityStatus({
    requirement,
    workspaceCapabilities,
    planningContext,
    projectScanSnapshot,
    objective
  }));
}
