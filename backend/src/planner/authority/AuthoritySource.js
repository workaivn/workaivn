const AUTHORITY_VALUES = Object.freeze({
  OBJECTIVE_AUTHORITY: 'objective_authority',
  WORKSPACE_AUTHORITY: 'workspace_authority',
  VERIFIED_PLANNING_CONTEXT: 'verified_planning_context',
  VERIFIED_ARTIFACT_MAPPING: 'verified_artifact_mapping',
  RECOMMENDATION_ONLY: 'recommendation_only',
  TEMPLATE: 'template',
  FRAMEWORK_HINT: 'framework_hint',
  BOOTSTRAP_HINT: 'bootstrap_hint',
  DEFAULT_HINT: 'default_hint',
  MODEL_SUGGESTION: 'model_suggestion'
});

const AUTHORITY_ALIASES = new Map([
  ['objective_authority', AUTHORITY_VALUES.OBJECTIVE_AUTHORITY],
  ['objective-authority', AUTHORITY_VALUES.OBJECTIVE_AUTHORITY],
  ['objective', AUTHORITY_VALUES.OBJECTIVE_AUTHORITY],
  ['workspace_authority', AUTHORITY_VALUES.WORKSPACE_AUTHORITY],
  ['workspace-authority', AUTHORITY_VALUES.WORKSPACE_AUTHORITY],
  ['workspace_evidence', AUTHORITY_VALUES.WORKSPACE_AUTHORITY],
  ['workspace-evidence', AUTHORITY_VALUES.WORKSPACE_AUTHORITY],
  ['workspace_derived', AUTHORITY_VALUES.WORKSPACE_AUTHORITY],
  ['workspace-derived', AUTHORITY_VALUES.WORKSPACE_AUTHORITY],
  ['explicit_user_request', AUTHORITY_VALUES.WORKSPACE_AUTHORITY],
  ['explicit-user-request', AUTHORITY_VALUES.WORKSPACE_AUTHORITY],
  ['verified_planning_context', AUTHORITY_VALUES.VERIFIED_PLANNING_CONTEXT],
  ['verified-planning-context', AUTHORITY_VALUES.VERIFIED_PLANNING_CONTEXT],
  ['verified_artifact_mapping', AUTHORITY_VALUES.VERIFIED_ARTIFACT_MAPPING],
  ['verified-artifact-mapping', AUTHORITY_VALUES.VERIFIED_ARTIFACT_MAPPING],
  ['recommendation_only', AUTHORITY_VALUES.RECOMMENDATION_ONLY],
  ['recommendation-only', AUTHORITY_VALUES.RECOMMENDATION_ONLY],
  ['recommendation', AUTHORITY_VALUES.RECOMMENDATION_ONLY],
  ['template', AUTHORITY_VALUES.TEMPLATE],
  ['framework_hint', AUTHORITY_VALUES.FRAMEWORK_HINT],
  ['framework-hint', AUTHORITY_VALUES.FRAMEWORK_HINT],
  ['bootstrap_hint', AUTHORITY_VALUES.BOOTSTRAP_HINT],
  ['bootstrap-hint', AUTHORITY_VALUES.BOOTSTRAP_HINT],
  ['default_hint', AUTHORITY_VALUES.DEFAULT_HINT],
  ['default-hint', AUTHORITY_VALUES.DEFAULT_HINT],
  ['model_suggestion', AUTHORITY_VALUES.MODEL_SUGGESTION],
  ['model-suggestion', AUTHORITY_VALUES.MODEL_SUGGESTION],
  ['planner_derived', AUTHORITY_VALUES.MODEL_SUGGESTION],
  ['planner-derived', AUTHORITY_VALUES.MODEL_SUGGESTION],
  ['planner_promoter', AUTHORITY_VALUES.VERIFIED_PLANNING_CONTEXT],
  ['planner-promoter', AUTHORITY_VALUES.VERIFIED_PLANNING_CONTEXT]
]);

const EXECUTABLE_AUTHORITY_SOURCES = new Set([
  AUTHORITY_VALUES.OBJECTIVE_AUTHORITY,
  AUTHORITY_VALUES.WORKSPACE_AUTHORITY,
  AUTHORITY_VALUES.VERIFIED_PLANNING_CONTEXT,
  AUTHORITY_VALUES.VERIFIED_ARTIFACT_MAPPING
]);

function normalizeText(value = '') {
  return String(value || '').trim().toLowerCase();
}

export function normalizeAuthoritySource(value = '') {
  const normalized = normalizeText(value);
  if (!normalized) return AUTHORITY_VALUES.RECOMMENDATION_ONLY;
  return AUTHORITY_ALIASES.get(normalized) || normalized;
}

export function isExecutableAuthoritySource(value = '') {
  return EXECUTABLE_AUTHORITY_SOURCES.has(normalizeAuthoritySource(value));
}

export function isRecommendationAuthoritySource(value = '') {
  const normalized = normalizeAuthoritySource(value);
  return normalized === AUTHORITY_VALUES.RECOMMENDATION_ONLY ||
    normalized === AUTHORITY_VALUES.TEMPLATE ||
    normalized === AUTHORITY_VALUES.FRAMEWORK_HINT ||
    normalized === AUTHORITY_VALUES.BOOTSTRAP_HINT ||
    normalized === AUTHORITY_VALUES.DEFAULT_HINT ||
    normalized === AUTHORITY_VALUES.MODEL_SUGGESTION;
}

export function createRecommendationAuthority({
  authoritySource = AUTHORITY_VALUES.RECOMMENDATION_ONLY,
  reason = 'recommendation object is not executable',
  canPromote = false,
  isExecutable = false,
  metadata = {}
} = {}) {
  return {
    authoritySource: normalizeAuthoritySource(authoritySource),
    isExecutable: isExecutable === true && isExecutableAuthoritySource(authoritySource),
    canPromote: canPromote === true && isExecutableAuthoritySource(authoritySource),
    reason,
    metadata: {
      ...(metadata && typeof metadata === 'object' ? metadata : {}),
      authoritySource: normalizeAuthoritySource(authoritySource),
      reason,
      canPromote: canPromote === true && isExecutableAuthoritySource(authoritySource),
      isExecutable: isExecutable === true && isExecutableAuthoritySource(authoritySource)
    }
  };
}

export { AUTHORITY_VALUES as AuthoritySource };
