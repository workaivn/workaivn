import { collectImplementationEvidence } from './implementationEvidence.js';
import { resolveImplementationPolicy } from './implementationPolicy.js';
import { buildImplementationAlternatives } from './implementationAlternativeBuilder.js';
import { selectImplementationVariant } from './implementationSelector.js';
import { buildImplementationVariantGraph } from './implementationVariantGraph.js';
import { validateImplementationStrategy } from './implementationValidator.js';

export function resolveImplementationStrategy({
  objective = '',
  requirements = [],
  objectiveConstraints = [],
  planningStrategies = [],
  initializationStrategies = [],
  planningContext = {},
  projectScanSnapshot = {},
  projectIntent = {}
} = {}) {
  console.log('[IMPLEMENTATION_STRATEGY_START]', {
    objectiveLength: String(objective || projectIntent?.objective || projectIntent?.prompt || '').length,
    requirementCount: Array.isArray(requirements) ? requirements.length : 0,
    objectiveConstraintCount: Array.isArray(objectiveConstraints) ? objectiveConstraints.length : 0,
    planningStrategyCount: Array.isArray(planningStrategies) ? planningStrategies.length : 0,
    workspaceEmpty: (Array.isArray(projectScanSnapshot?.discoveredFiles) ? projectScanSnapshot.discoveredFiles.length : 0) === 0
  });

  const policyDecision = resolveImplementationPolicy({
    objective: objective || projectIntent?.objective || projectIntent?.prompt || '',
    objectiveConstraints,
    planningStrategies,
    initializationStrategies,
    projectScanSnapshot,
    planningContext
  });

  const { implementationStrategies, implementationVariants } = buildImplementationAlternatives({
    requirements,
    objective: objective || projectIntent?.objective || projectIntent?.prompt || '',
    planningContext,
    projectScanSnapshot,
    policyDecision
  });

  console.log('[IMPLEMENTATION_ALTERNATIVES_CREATED]', {
    strategyCount: implementationStrategies.length,
    variantCount: implementationVariants.length,
    requirementCount: Array.isArray(requirements) ? requirements.length : 0
  });
  for (const strategy of implementationStrategies) {
    for (const variant of Array.isArray(strategy.variants) ? strategy.variants : []) {
      console.log('[IMPLEMENTATION_VARIANT_DISCOVERED]', {
        strategyId: strategy.id,
        requirementId: strategy.requirementId,
        variantId: variant.id,
        variant: variant.variant,
        frameworkKey: variant.frameworkKey
      });
    }
  }

  const selection = selectImplementationVariant({
    implementationStrategies,
    implementationVariants,
    policyDecision
  });
  const implementationVariantGraph = buildImplementationVariantGraph({
    implementationStrategies,
    selectedImplementation: selection.selectedImplementation
  });
  const validation = validateImplementationStrategy({
    implementationStrategies,
    implementationVariants,
    selectedImplementation: selection.selectedImplementation,
    implementationVariantGraph
  });

  if (selection.selectedVariant) {
    console.log('[IMPLEMENTATION_VARIANT_SELECTED]', {
      variantId: selection.selectedVariant.id,
      variant: selection.selectedVariant.variant,
      frameworkKey: selection.selectedVariant.frameworkKey
    });
    console.log('[IMPLEMENTATION_SELECTION_REASON]', {
      variantId: selection.selectedVariant.id,
      reason: selection.selectionReason || selection.selectedImplementation?.selectionReason || 'Selected by planner policy'
    });
    console.log('[IMPLEMENTATION_EVIDENCE]', {
      variantId: selection.selectedVariant.id,
      evidence: collectImplementationEvidence({
        objective: objective || projectIntent?.objective || projectIntent?.prompt || '',
        planningContext,
        projectScanSnapshot,
        variant: selection.selectedVariant,
        selectedVariant: selection.selectedVariant
      })
    });
  }

  console.log('[IMPLEMENTATION_VARIANT_GRAPH_CREATED]', {
    nodeCount: Array.isArray(implementationVariantGraph.nodes) ? implementationVariantGraph.nodes.length : 0,
    edgeCount: Array.isArray(implementationVariantGraph.edges) ? implementationVariantGraph.edges.length : 0
  });
  console.log(validation.valid ? '[IMPLEMENTATION_STRATEGY_COMPLETE]' : '[IMPLEMENTATION_STRATEGY_COMPLETE]', {
    strategyCount: implementationStrategies.length,
    variantCount: implementationVariants.length,
    selected: selection.selectedVariant?.id || null,
    valid: validation.valid,
    errorCount: validation.errors.length
  });

  return {
    implementationStrategies,
    implementationVariants,
    selectedImplementation: validation.valid ? selection.selectedImplementation : null,
    implementationEvidence: selection.selectedVariant
      ? collectImplementationEvidence({
          objective: objective || projectIntent?.objective || projectIntent?.prompt || '',
          planningContext,
          projectScanSnapshot,
          selectedVariant: selection.selectedVariant,
          variant: selection.selectedVariant
        })
      : [],
    implementationPolicyDecision: policyDecision,
    implementationVariantGraph,
    validation
  };
}
