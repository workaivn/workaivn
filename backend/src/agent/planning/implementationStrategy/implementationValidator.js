import { validateImplementationVariantGraph } from './implementationVariantGraph.js';

export function validateImplementationStrategy({
  implementationStrategies = [],
  implementationVariants = [],
  selectedImplementation = null,
  implementationVariantGraph = null
} = {}) {
  const graphValidation = validateImplementationVariantGraph(implementationVariantGraph || {});
  const errors = [...graphValidation.errors];

  if (Array.isArray(implementationStrategies) && implementationStrategies.length > 0) {
    for (const strategy of implementationStrategies) {
      if (!strategy?.strategy) errors.push('Implementation strategy must have a strategy name');
      if (!Array.isArray(strategy?.variants) || strategy.variants.length === 0) {
        errors.push(`Implementation strategy ${strategy?.id || 'unknown'} must include one or more variants`);
      }
    }
  }

  if (selectedImplementation) {
    if (!selectedImplementation.selectedVariant) {
      errors.push('Selected implementation must include a selected variant');
    } else if (!Array.isArray(selectedImplementation.selectedVariant.evidence) || selectedImplementation.selectedVariant.evidence.length === 0) {
      errors.push('Selected implementation variant must carry evidence');
    }
  } else if (implementationVariants.length > 0) {
    errors.push('Implementation resolution must select one variant');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
