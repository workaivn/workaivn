import { normalizeImplementationKey, collectImplementationEvidence } from './implementationEvidence.js';

function normalizeText(value = '') {
  return String(value || '').trim();
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => normalizeText(value)).filter(Boolean))];
}

function makeVariant({
  id,
  variant,
  variantKey,
  frameworkKey,
  family,
  strategy,
  hostFrameworkKey = null,
  confidence = 0.8,
  evidence = [],
  selectionReason = '',
  plannerApproved = true
} = {}) {
  return {
    id: normalizeText(id),
    variant: normalizeText(variant),
    variantKey: normalizeImplementationKey(variantKey || frameworkKey || id),
    frameworkKey: normalizeText(frameworkKey || variantKey || id).trim().toLowerCase(),
    family: normalizeImplementationKey(family || strategy || '').toLowerCase(),
    strategy: normalizeText(strategy),
    hostFrameworkKey: hostFrameworkKey ? normalizeText(hostFrameworkKey).trim().toLowerCase() : null,
    confidence: Number.isFinite(Number(confidence)) ? Math.max(0, Math.min(1, Number(confidence))) : 0.5,
    evidence: unique(evidence),
    selectionReason: normalizeText(selectionReason),
    plannerApproved: plannerApproved === true
  };
}

function buildReactStandaloneVariants({
  strategyName,
  evidence = []
} = {}) {
  return [
    makeVariant({
      id: 'implementation-variant:react-vite-ts',
      variant: 'React + Vite',
      variantKey: 'react-vite-ts',
      frameworkKey: 'react-vite-ts',
      family: 'react',
      strategy: strategyName,
      hostFrameworkKey: 'vite',
      confidence: 0.98,
      evidence: [...evidence, 'variant:react-vite-ts'],
      selectionReason: 'Default React initialization'
    }),
    makeVariant({
      id: 'implementation-variant:react-cra-ts',
      variant: 'React + CRA',
      variantKey: 'react-cra-ts',
      frameworkKey: 'react-cra-ts',
      family: 'react',
      strategy: strategyName,
      hostFrameworkKey: 'cra',
      confidence: 0.78,
      evidence: [...evidence, 'variant:react-cra-ts'],
      selectionReason: 'Alternative React initialization'
    }),
    makeVariant({
      id: 'implementation-variant:react-rspack-ts',
      variant: 'React + Rspack',
      variantKey: 'react-rspack-ts',
      frameworkKey: 'react-rspack-ts',
      family: 'react',
      strategy: strategyName,
      hostFrameworkKey: 'rspack',
      confidence: 0.76,
      evidence: [...evidence, 'variant:react-rspack-ts'],
      selectionReason: 'Alternative React initialization'
    }),
    makeVariant({
      id: 'implementation-variant:react-rsbuild-ts',
      variant: 'React + RSBuild',
      variantKey: 'react-rsbuild-ts',
      frameworkKey: 'react-rsbuild-ts',
      family: 'react',
      strategy: strategyName,
      hostFrameworkKey: 'rsbuild',
      confidence: 0.75,
      evidence: [...evidence, 'variant:react-rsbuild-ts'],
      selectionReason: 'Alternative React initialization'
    }),
    makeVariant({
      id: 'implementation-variant:react-parcel-ts',
      variant: 'React + Parcel',
      variantKey: 'react-parcel-ts',
      frameworkKey: 'react-parcel-ts',
      family: 'react',
      strategy: strategyName,
      hostFrameworkKey: 'parcel',
      confidence: 0.74,
      evidence: [...evidence, 'variant:react-parcel-ts'],
      selectionReason: 'Alternative React initialization'
    }),
    makeVariant({
      id: 'implementation-variant:react-custom',
      variant: 'React + Custom',
      variantKey: 'react-custom',
      frameworkKey: 'react-custom',
      family: 'react',
      strategy: strategyName,
      hostFrameworkKey: 'custom',
      confidence: 0.72,
      evidence: [...evidence, 'variant:react-custom'],
      selectionReason: 'Alternative React initialization'
    })
  ];
}

function buildHostVariants({
  strategyName,
  hostFrameworkKey,
  evidence = []
} = {}) {
  switch (hostFrameworkKey) {
    case 'next':
      return [
        makeVariant({
          id: 'implementation-variant:nextjs-ts',
          variant: 'React + Next',
          variantKey: 'nextjs-ts',
          frameworkKey: 'nextjs-ts',
          family: 'react',
          strategy: strategyName,
          hostFrameworkKey: 'next',
          confidence: 0.99,
          evidence: [...evidence, 'variant:nextjs-ts'],
          selectionReason: 'Verified Next.js workspace evidence'
        })
      ];
    case 'astro':
      return [
        makeVariant({
          id: 'implementation-variant:astro-react',
          variant: 'Astro React Integration',
          variantKey: 'astro-react',
          frameworkKey: 'astro-react',
          family: 'react',
          strategy: strategyName,
          hostFrameworkKey: 'astro',
          confidence: 0.98,
          evidence: [...evidence, 'variant:astro-react'],
          selectionReason: 'Verified Astro workspace evidence'
        })
      ];
    case 'laravel':
      return [
        makeVariant({
          id: 'implementation-variant:laravel-react',
          variant: 'Laravel React Integration',
          variantKey: 'laravel-react',
          frameworkKey: 'laravel-react',
          family: 'react',
          strategy: strategyName,
          hostFrameworkKey: 'laravel',
          confidence: 0.98,
          evidence: [...evidence, 'variant:laravel-react'],
          selectionReason: 'Verified Laravel workspace evidence'
        })
      ];
    case 'react-vite':
      return [
        makeVariant({
          id: 'implementation-variant:react-vite-ts',
          variant: 'React + Vite',
          variantKey: 'react-vite-ts',
          frameworkKey: 'react-vite-ts',
          family: 'react',
          strategy: strategyName,
          hostFrameworkKey: 'vite',
          confidence: 0.98,
          evidence: [...evidence, 'variant:react-vite-ts'],
          selectionReason: 'Verified React/Vite workspace evidence'
        })
      ];
    default:
      return [];
  }
}

export function buildImplementationAlternatives({
  requirements = [],
  objective = '',
  planningContext = {},
  projectScanSnapshot = {},
  policyDecision = null
} = {}) {
  const normalizedRequirements = Array.isArray(requirements) ? requirements.filter(Boolean) : [];
  const objectiveFamily = policyDecision?.objectiveFamily?.family || '';
  const objectiveVariantKey = policyDecision?.objectiveVariantKey || null;
  const hostFrameworkKey = policyDecision?.workspaceHost?.hostKey || 'generic';
  const initializationAllowed = policyDecision?.initializationAllowed === true;
  const workspaceEmpty = policyDecision?.workspaceEmpty === true;
  const baseStrategyName = objectiveFamily === 'next'
    ? 'Next.js Application Strategy'
    : (hostFrameworkKey === 'astro'
      ? 'Astro Integration Strategy'
      : (hostFrameworkKey === 'laravel'
        ? 'Laravel Integration Strategy'
        : (objectiveFamily === 'react'
          ? 'React Application Strategy'
          : 'Implementation Strategy')));
  const evidence = collectImplementationEvidence({
    objective,
    planningContext,
    projectScanSnapshot
  });
  const requirementBuckets = normalizedRequirements.length > 0
    ? normalizedRequirements
    : [
        {
          id: 'requirement:objective',
          capability: 'APPLICATION_ENTRY',
          purpose: 'Objective derived implementation strategy'
        }
      ];

  const strategies = requirementBuckets.map(requirement => {
    let variants = [];
    if (hostFrameworkKey === 'next' || hostFrameworkKey === 'astro' || hostFrameworkKey === 'laravel' || hostFrameworkKey === 'react-vite') {
      variants = buildHostVariants({
        strategyName: baseStrategyName,
        hostFrameworkKey,
        evidence: [...evidence, `requirement:${requirement.capability || 'APPLICATION_ENTRY'}`]
      });
    } else if (objectiveFamily === 'react' && initializationAllowed && workspaceEmpty) {
      variants = buildReactStandaloneVariants({
        strategyName: baseStrategyName,
        evidence: [...evidence, 'workspace:empty', 'initialization:allowed', `requirement:${requirement.capability || 'APPLICATION_ENTRY'}`]
      });
    } else if (objectiveFamily === 'react') {
      variants = buildReactStandaloneVariants({
        strategyName: baseStrategyName,
        evidence: [...evidence, `requirement:${requirement.capability || 'APPLICATION_ENTRY'}`]
      });
    } else if (objectiveFamily === 'next') {
      variants = buildHostVariants({
        strategyName: baseStrategyName,
        hostFrameworkKey: 'next',
        evidence: [...evidence, `requirement:${requirement.capability || 'APPLICATION_ENTRY'}`]
      });
    }

    if (!Array.isArray(variants) || variants.length === 0) {
      return null;
    }

    if (objectiveVariantKey && (hostFrameworkKey === 'generic' || hostFrameworkKey === 'react-vite') && variants.length > 1) {
      const preferredVariant = variants.find(variant => normalizeImplementationKey(variant.frameworkKey || variant.variantKey || variant.id || '').toLowerCase() === normalizeImplementationKey(objectiveVariantKey).toLowerCase());
      if (preferredVariant) {
        console.log('[IMPLEMENTATION_VARIANT_OBJECTIVE_FILTERED]', {
          requirementId: requirement.id || null,
          objectiveVariantKey,
          beforeCount: variants.length,
          afterCount: 1
        });
        variants = [preferredVariant];
      }
    }

    return {
      id: `implementation-strategy:${normalizeImplementationKey(requirement.id || requirement.capability || 'objective').toLowerCase()}`,
      requirementId: requirement.id || null,
      capability: requirement.capability || null,
      strategy: baseStrategyName,
      confidence: Math.max(0.5, Number(requirement.confidence || 0.7)),
      evidence: unique([
        ...evidence,
        requirement.id ? `requirementId:${requirement.id}` : null,
        requirement.capability ? `requirementCapability:${requirement.capability}` : null,
        `strategy:${baseStrategyName}`
      ]),
      plannerApproved: true,
      variants,
      selectedVariantId: null
    };
  }).filter(Boolean);

  const variantById = new Map();
  for (const strategy of strategies) {
    for (const variant of Array.isArray(strategy.variants) ? strategy.variants : []) {
      if (!variantById.has(variant.id)) variantById.set(variant.id, variant);
    }
  }
  const variants = [...variantById.values()];

  return {
    implementationStrategies: strategies,
    implementationVariants: variants
  };
}
