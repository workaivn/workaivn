function normalizeText(value = '') {
  return String(value || '').trim();
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => normalizeText(value)).filter(Boolean))];
}

export function normalizeImplementationKey(value = '') {
  return normalizeText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function stringifyImplementationEvidence(values = []) {
  return unique(values).map(value => String(value)).filter(Boolean);
}

export function collectImplementationEvidence({
  objective = '',
  planningContext = {},
  projectScanSnapshot = {},
  requirement = null,
  strategy = null,
  variant = null,
  selectedVariant = null
} = {}) {
  const evidence = [
    `objective:${normalizeText(objective).slice(0, 160)}`,
    `projectType:${normalizeText(projectScanSnapshot?.projectType || planningContext?.facts?.projectType || planningContext?.projectType || 'generic')}`,
    `workspaceEmpty:${planningContext?.facts?.workspaceFileCount === 0 || planningContext?.workspaceFileCount === 0 || (Array.isArray(projectScanSnapshot?.discoveredFiles) ? projectScanSnapshot.discoveredFiles.length === 0 : false)}`,
    `packageJsonFound:${projectScanSnapshot?.packageJsonFound === true || planningContext?.facts?.packageJsonFound === true}`,
    `packageManager:${normalizeText(projectScanSnapshot?.packageManager || planningContext?.facts?.packageManager || '')}`,
    `initializationMode:${normalizeText(planningContext?.initializationMode || '')}`,
    `objectiveAuthorityEligible:${planningContext?.objectiveAuthorityEligible === true}`,
    `policy:ALLOW_PROJECT_INITIALIZATION=${planningContext?.plannerPolicies?.ALLOW_PROJECT_INITIALIZATION === true || planningContext?.policies?.ALLOW_PROJECT_INITIALIZATION === true}`,
    `policy:ALLOW_NEW_PROJECT_INITIALIZATION=${planningContext?.plannerPolicies?.ALLOW_NEW_PROJECT_INITIALIZATION === true || planningContext?.policies?.ALLOW_NEW_PROJECT_INITIALIZATION === true}`,
    ...(Array.isArray(planningContext?.objectiveConstraints) ? planningContext.objectiveConstraints.map(constraint => `constraint:${constraint.value || constraint.type || constraint.category || ''}`) : []),
    ...(Array.isArray(planningContext?.planningStrategies) ? planningContext.planningStrategies.map(item => `strategy:${item.strategy || ''}`) : []),
    ...(Array.isArray(planningContext?.initializationStrategies) ? planningContext.initializationStrategies.map(item => `initialization:${item.strategy || ''}`) : []),
    requirement?.id ? `requirementId:${requirement.id}` : null,
    requirement?.capability ? `requirementCapability:${normalizeImplementationKey(requirement.capability)}` : null,
    strategy?.id ? `strategyId:${strategy.id}` : null,
    strategy?.strategy ? `strategy:${strategy.strategy}` : null,
    variant?.id ? `variantId:${variant.id}` : null,
    variant?.variantKey ? `variantKey:${variant.variantKey}` : null,
    variant?.variant ? `variant:${variant.variant}` : null,
    selectedVariant?.id ? `selectedVariantId:${selectedVariant.id}` : null,
    selectedVariant?.variantKey ? `selectedVariantKey:${selectedVariant.variantKey}` : null,
    selectedVariant?.variant ? `selectedVariant:${selectedVariant.variant}` : null
  ];

  return stringifyImplementationEvidence(evidence);
}
