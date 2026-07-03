import { normalizeImplementationKey } from './implementationEvidence.js';

function unique(values = []) {
  const seen = new Set();
  const output = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (!value || !value.id) continue;
    if (seen.has(value.id)) continue;
    seen.add(value.id);
    output.push(value);
  }
  return output;
}

function selectByFrameworkKey(variants = [], frameworkKey = '') {
  const normalized = normalizeImplementationKey(frameworkKey).toLowerCase();
  return variants.find(variant => normalizeImplementationKey(variant?.frameworkKey || variant?.variantKey || variant?.id || '').toLowerCase() === normalized) || null;
}

export function selectImplementationVariant({
  implementationStrategies = [],
  implementationVariants = [],
  policyDecision = null
} = {}) {
  const strategies = Array.isArray(implementationStrategies) ? implementationStrategies : [];
  const variants = Array.isArray(implementationVariants) ? implementationVariants : [];
  const flattenedStrategies = strategies.flatMap(strategy => Array.isArray(strategy.variants) ? strategy.variants : []);
  const allVariants = unique([
    ...variants,
    ...flattenedStrategies
  ].filter(Boolean));
  const workspaceHostKey = policyDecision?.workspaceHost?.hostKey || null;
  const objectiveFamilyKey = policyDecision?.objectiveFamily?.family || null;
  const objectiveFrameworkKey = policyDecision?.objectiveFamily?.frameworkKey || null;
  const objectiveVariantKey = policyDecision?.objectiveVariantKey || null;
  const objectiveText = String(policyDecision?.objectiveText || '').toLowerCase();
  const explicitViteVariant = /\breact\s+vite\b/.test(objectiveText) || /\bvite\b/.test(objectiveText)
    ? 'react-vite-ts'
    : null;
  const explicitCustomVariant = /\breact\b/.test(objectiveText) && /\bcustom\b/.test(objectiveText)
    ? 'react-custom'
    : (objectiveText.includes('react-custom') ? 'react-custom' : null);
  let selectedVariant = null;

  const preferredObjectiveVariantKey = objectiveVariantKey || explicitCustomVariant || explicitViteVariant;

  if (!selectedVariant && preferredObjectiveVariantKey) {
    selectedVariant = selectByFrameworkKey(allVariants, preferredObjectiveVariantKey);
  }

  if (!selectedVariant && workspaceHostKey === 'next') selectedVariant = selectByFrameworkKey(allVariants, 'nextjs-ts');
  else if (!selectedVariant && workspaceHostKey === 'astro') selectedVariant = selectByFrameworkKey(allVariants, 'astro-react');
  else if (!selectedVariant && workspaceHostKey === 'laravel') selectedVariant = selectByFrameworkKey(allVariants, 'laravel-react');
  else if (!selectedVariant && workspaceHostKey === 'react-vite') selectedVariant = selectByFrameworkKey(allVariants, 'react-vite-ts');

  if (!selectedVariant && policyDecision?.workspaceEmpty === true && String(objectiveFamilyKey || '').toLowerCase() === 'react') {
    selectedVariant = selectByFrameworkKey(allVariants, 'react-custom') || selectByFrameworkKey(allVariants, 'generic-static-html');
  }

  if (!selectedVariant && objectiveFrameworkKey) {
    selectedVariant = selectByFrameworkKey(allVariants, objectiveFrameworkKey);
  }

  if (!selectedVariant && allVariants.length > 0) {
    selectedVariant = allVariants[0];
  }

  if (!selectedVariant) {
    return {
      selectedVariant: null,
      selectionReason: 'No implementation variant available'
    };
  }

  const strategy = strategies.find(entry => Array.isArray(entry.variants) && entry.variants.some(variant => variant.id === selectedVariant.id)) || null;
  const selectionReason = selectedVariant.selectionReason || (
    workspaceHostKey
      ? `Selected ${selectedVariant.variant} from verified ${workspaceHostKey} workspace evidence`
      : `Selected ${selectedVariant.variant} from objective implementation evidence`
  );
  const selectedImplementation = {
    id: `selected-implementation:${normalizeImplementationKey(selectedVariant.frameworkKey || selectedVariant.id).toLowerCase()}`,
    strategy: strategy?.strategy || selectedVariant.strategy || 'Implementation Strategy',
    variant: selectedVariant.variant,
    variants: allVariants,
    selectedVariant,
    confidence: Math.max(Number(strategy?.confidence || 0), Number(selectedVariant.confidence || 0)),
    evidence: unique([...(Array.isArray(strategy?.evidence) ? strategy.evidence : []), ...(Array.isArray(selectedVariant.evidence) ? selectedVariant.evidence : [])]),
    selectionReason,
    plannerApproved: selectedVariant.plannerApproved === true
  };

  return {
    selectedVariant,
    selectedImplementation,
    selectionReason
  };
}
