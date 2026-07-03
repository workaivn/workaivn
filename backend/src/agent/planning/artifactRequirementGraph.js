import crypto from 'node:crypto';

import { unique, normalizeLower } from '../projectIntelligence/inference.js';
import { GOAL_TYPES, getGoalKnowledge } from '../projectIntelligence/planningKnowledgeRegistry.js';
import { buildSemanticGoalGraph, normalizeSemanticNode } from './objectiveSemanticDecomposer.js';
import { buildPlanningStrategyGraph } from './constraintResolver.js';
import {
  buildRequirementGraph,
  mergeRequirements as mergeTranslatedRequirements,
  normalizeRequirement as normalizeTranslatedRequirement,
  validateArtifactRequirements
} from './strategyRequirementTranslator.js';

const CAPABILITY_META = {
  APPLICATION_ENTRY: { artifactType: 'source', purpose: 'Primary application entry surface' },
  GLOBAL_STYLE: { artifactType: 'style', purpose: 'Shared styling surface' },
  NAVIGATION: { artifactType: 'component', purpose: 'Navigation and routing surface' },
  HERO: { artifactType: 'component', purpose: 'Hero and landing message surface' },
  FEATURES: { artifactType: 'component', purpose: 'Feature presentation surface' },
  SHOWCASE: { artifactType: 'component', purpose: 'Showcase and demo surface' },
  DASHBOARD: { artifactType: 'component', purpose: 'Dashboard workspace surface' },
  STATISTICS: { artifactType: 'component', purpose: 'Metrics and data visualization surface' },
  TESTIMONIALS: { artifactType: 'component', purpose: 'Trust and social proof surface' },
  PRICING: { artifactType: 'component', purpose: 'Pricing and plan comparison surface' },
  FAQ: { artifactType: 'component', purpose: 'Frequently asked questions surface' },
  CTA: { artifactType: 'component', purpose: 'Primary call-to-action surface' },
  FOOTER: { artifactType: 'component', purpose: 'Footer and supporting navigation surface' },
  IMAGE_ASSET: { artifactType: 'asset', purpose: 'Illustration or hero image asset' },
  ICON_SET: { artifactType: 'asset', purpose: 'Icon or glyph asset collection' },
  ROUTER: { artifactType: 'source', purpose: 'Client routing surface' },
  STATE: { artifactType: 'source', purpose: 'Application state and orchestration surface' },
  API_LAYER: { artifactType: 'source', purpose: 'Backend or API surface' },
  DATABASE_SCHEMA: { artifactType: 'schema', purpose: 'Persistent data model surface' },
  AUTH: { artifactType: 'source', purpose: 'Authentication and authorization surface' },
  VALIDATION: { artifactType: 'source', purpose: 'Input and business-rule validation surface' },
  TEST: { artifactType: 'test', purpose: 'Automated test surface' },
  BUILD: { artifactType: 'config', purpose: 'Build and validation configuration surface' },
  DIRECTORY: { artifactType: 'directory', purpose: 'Workspace directory surface' }
};

const SEMANTIC_ARTIFACT_TYPES = {
  PRODUCT: 'source',
  SECTION: 'component',
  FEATURE: 'component',
  UX: 'source',
  UI: 'source',
  ACCESSIBILITY: 'source',
  PERFORMANCE: 'source',
  QUALITY: 'source',
  SECURITY: 'source',
  DATA: 'source',
  DEPLOYMENT: 'config',
  TESTING: 'test',
  DOCUMENTATION: 'documentation',
  WORKFLOW: 'source',
  ANIMATION: 'source',
  CONTENT: 'content'
};

const LAYOUT_REQUIREMENTS = {
  LANDING_PAGE: ['APPLICATION_ENTRY', 'GLOBAL_STYLE', 'NAVIGATION', 'HERO', 'FEATURES', 'PRICING', 'CTA', 'FOOTER'],
  SAAS_APP: ['APPLICATION_ENTRY', 'GLOBAL_STYLE', 'NAVIGATION', 'HERO', 'FEATURES', 'PRICING', 'TESTIMONIALS', 'CTA', 'FOOTER'],
  DASHBOARD: ['APPLICATION_ENTRY', 'GLOBAL_STYLE', 'NAVIGATION', 'DASHBOARD', 'STATISTICS', 'STATE', 'API_LAYER', 'AUTH', 'CTA', 'FOOTER'],
  ADMIN_PANEL: ['APPLICATION_ENTRY', 'GLOBAL_STYLE', 'NAVIGATION', 'DASHBOARD', 'STATISTICS', 'STATE', 'API_LAYER', 'AUTH', 'VALIDATION', 'CTA', 'FOOTER'],
  FULLSTACK_APP: ['APPLICATION_ENTRY', 'GLOBAL_STYLE', 'NAVIGATION', 'STATE', 'API_LAYER', 'DATABASE_SCHEMA', 'AUTH', 'TEST', 'BUILD'],
  API_SERVER: ['API_LAYER', 'VALIDATION', 'TEST', 'BUILD', 'DATABASE_SCHEMA', 'AUTH'],
  BUG_FIX: ['TEST', 'VALIDATION'],
  REFACTOR: ['APPLICATION_ENTRY', 'GLOBAL_STYLE', 'TEST', 'BUILD'],
  READ_ONLY: [],
  UNKNOWN: ['APPLICATION_ENTRY']
};

const OBJECTIVE_CAPABILITY_HINTS = [
  { pattern: /\bpricing\b/i, capability: 'PRICING' },
  { pattern: /\btestimonial(s)?\b/i, capability: 'TESTIMONIALS' },
  { pattern: /\bfaq\b/i, capability: 'FAQ' },
  { pattern: /\bcta\b|\bcall to action\b/i, capability: 'CTA' },
  { pattern: /\bhero\b/i, capability: 'HERO' },
  { pattern: /\bnavigation\b|\bnav\b|\bmenu\b/i, capability: 'NAVIGATION' },
  { pattern: /\bfeature(s)?\b/i, capability: 'FEATURES' },
  { pattern: /\bdashboard\b/i, capability: 'DASHBOARD' },
  { pattern: /\bstatistics\b|\bmetrics\b|\banalytics\b/i, capability: 'STATISTICS' },
  { pattern: /\bapi\b|\bbackend\b|\bserver\b/i, capability: 'API_LAYER' },
  { pattern: /\bauth\b|\blogin\b|\bsign in\b/i, capability: 'AUTH' },
  { pattern: /\btest\b|\btests\b|\bvalidation\b/i, capability: 'TEST' },
  { pattern: /\bbuild\b|\bship\b|\brelease\b/i, capability: 'BUILD' }
];

function normalizeRequirementId(value = '') {
  return String(value || '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function normalizeEvidence(values = []) {
  return unique((Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .map(value => value.slice(0, 160)));
}

function ensureRequirementShape(requirement = {}, index = 0) {
  const capability = String(requirement.capability || requirement.name || '').trim().toUpperCase();
  const meta = CAPABILITY_META[capability] || { artifactType: 'source', purpose: 'Required artifact surface' };
  const required = requirement.required !== false;
  const optional = requirement.optional === true;
  const dependencies = unique((Array.isArray(requirement.dependencies) ? requirement.dependencies : []).map(value => String(value || '').trim()).filter(Boolean));
  const sourceStrategies = unique(
    (Array.isArray(requirement.sourceStrategies) ? requirement.sourceStrategies : [])
      .concat(requirement.sourceStrategy ? [requirement.sourceStrategy] : [])
      .map(value => String(value || '').trim())
      .filter(Boolean)
  );
  return {
    id: String(requirement.id || `requirement:${normalizeRequirementId(capability || `item-${index + 1}`)}`),
    capability: capability || 'APPLICATION_ENTRY',
    artifactType: String(requirement.artifactType || meta.artifactType || 'source').trim(),
    purpose: String(requirement.purpose || meta.purpose || 'Required artifact surface').trim(),
    required,
    optional,
    evidence: normalizeEvidence(requirement.evidence || []),
    confidence: Number.isFinite(Number(requirement.confidence)) ? Math.max(0, Math.min(1, Number(requirement.confidence))) : 0.5,
    source: String(requirement.source || 'objective').trim() || 'objective',
    dependencies,
    sourceStrategies,
    implementationIndependent: requirement.implementationIndependent !== false,
    executionEligible: requirement.executionEligible === true ? true : false,
    priority: Number.isFinite(Number(requirement.priority)) ? Number(requirement.priority) : 50
  };
}

function pushRequirement(items, requirement) {
  if (!requirement) return;
  items.push(ensureRequirementShape(requirement, items.length));
}

function buildLandingRequirements({
  goalType,
  objective,
  source = 'objective',
  confidence = 0.92,
  required = true
} = {}) {
  const items = [];
  const evidence = normalizeEvidence([
    `goalType:${goalType || 'UNKNOWN'}`,
    `objective:${String(objective || '').slice(0, 120)}`,
    ...(getGoalKnowledge(goalType || GOAL_TYPES.UNKNOWN)?.validationHints || []).map(hint => `goalHint:${hint}`)
  ]);
  const base = [
    { capability: 'GLOBAL_STYLE', priority: 100 },
    { capability: 'APPLICATION_ENTRY', dependencies: ['requirement:global-style'], priority: 98 },
    { capability: 'NAVIGATION', dependencies: ['requirement:application-entry', 'requirement:global-style'], priority: 95 },
    { capability: 'HERO', dependencies: ['requirement:application-entry', 'requirement:global-style'], priority: 94 },
    { capability: 'FEATURES', dependencies: ['requirement:application-entry', 'requirement:global-style'], priority: 93 },
    { capability: 'PRICING', dependencies: ['requirement:application-entry', 'requirement:global-style'], priority: 92 },
    { capability: 'CTA', dependencies: ['requirement:application-entry', 'requirement:global-style'], priority: 91 },
    { capability: 'FOOTER', dependencies: ['requirement:application-entry', 'requirement:global-style'], priority: 90 }
  ];
  for (const entry of base) {
    pushRequirement(items, {
      ...entry,
      required,
      source,
      confidence,
      evidence
    });
  }
  return items;
}

function buildSaasRequirements(options = {}) {
  const items = buildLandingRequirements(options);
  pushRequirement(items, {
    capability: 'TESTIMONIALS',
    dependencies: ['requirement:application-entry', 'requirement:global-style'],
    required: true,
    source: options.source || 'objective',
    confidence: options.confidence ?? 0.88,
    evidence: normalizeEvidence([`goalType:${options.goalType || 'SAAS_APP'}`, `objective:${String(options.objective || '').slice(0, 120)}`]),
    priority: 89
  });
  return items;
}

function buildDashboardRequirements(options = {}) {
  const items = [];
  const evidence = normalizeEvidence([
    `goalType:${options.goalType || 'DASHBOARD'}`,
    `objective:${String(options.objective || '').slice(0, 120)}`
  ]);
  const entries = [
    { capability: 'GLOBAL_STYLE', priority: 100 },
    { capability: 'APPLICATION_ENTRY', dependencies: ['requirement:global-style'], priority: 99 },
    { capability: 'NAVIGATION', dependencies: ['requirement:application-entry', 'requirement:global-style'], priority: 98 },
    { capability: 'DASHBOARD', dependencies: ['requirement:application-entry', 'requirement:global-style'], priority: 96 },
    { capability: 'STATISTICS', dependencies: ['requirement:dashboard'], priority: 95 },
    { capability: 'STATE', dependencies: ['requirement:application-entry'], priority: 94 },
    { capability: 'API_LAYER', dependencies: ['requirement:state'], priority: 93 },
    { capability: 'AUTH', dependencies: ['requirement:api-layer'], priority: 92 },
    { capability: 'CTA', dependencies: ['requirement:dashboard'], priority: 90 },
    { capability: 'FOOTER', dependencies: ['requirement:dashboard'], priority: 89 }
  ];
  for (const entry of entries) {
    pushRequirement(items, {
      ...entry,
      required: true,
      source: options.source || 'objective',
      confidence: options.confidence ?? 0.9,
      evidence
    });
  }
  return items;
}

function buildApiRequirements(options = {}) {
  const items = [];
  const evidence = normalizeEvidence([
    `goalType:${options.goalType || 'API_SERVER'}`,
    `objective:${String(options.objective || '').slice(0, 120)}`
  ]);
  const entries = [
    { capability: 'API_LAYER', priority: 100 },
    { capability: 'VALIDATION', dependencies: ['requirement:api-layer'], priority: 98 },
    { capability: 'AUTH', dependencies: ['requirement:api-layer'], priority: 97 },
    { capability: 'DATABASE_SCHEMA', dependencies: ['requirement:api-layer'], priority: 96 },
    { capability: 'TEST', dependencies: ['requirement:validation'], priority: 95 },
    { capability: 'BUILD', dependencies: ['requirement:validation'], priority: 94 }
  ];
  for (const entry of entries) {
    pushRequirement(items, {
      ...entry,
      required: true,
      source: options.source || 'objective',
      confidence: options.confidence ?? 0.88,
      evidence
    });
  }
  return items;
}

function inferObjectiveRequirements({
  objective = '',
  goalType = GOAL_TYPES.UNKNOWN,
  source = 'objective'
} = {}) {
  const text = String(objective || '').trim();
  const lower = normalizeLower(text);
  const requirements = [];
  const goal = String(goalType || GOAL_TYPES.UNKNOWN).toUpperCase();
  const capabilityHints = new Set();

  for (const hint of OBJECTIVE_CAPABILITY_HINTS) {
    if (hint.pattern.test(lower)) capabilityHints.add(hint.capability);
  }

  const needsLandingExperience = /\b(?:landing page|homepage|marketing site|saas)\b/i.test(text);
  const needsAppShell = /\b(?:create|build|implement|ship|launch|generate)\b/i.test(text);

  if (goal === GOAL_TYPES.API_SERVER) {
    return buildApiRequirements({ goalType: goal, objective: text, source });
  }

  if (goal === GOAL_TYPES.DASHBOARD || goal === GOAL_TYPES.ADMIN_PANEL) {
    return buildDashboardRequirements({ goalType: goal, objective: text, source });
  }

  if (goal === GOAL_TYPES.SAAS_APP) {
    return buildSaasRequirements({ goalType: goal, objective: text, source });
  }

  if (goal === GOAL_TYPES.LANDING_PAGE || needsLandingExperience || needsAppShell) {
    return buildLandingRequirements({ goalType: goal, objective: text, source });
  }

  if (goal === GOAL_TYPES.FULLSTACK_APP) {
    return [
      ...buildLandingRequirements({ goalType: goal, objective: text, source }),
      ...buildApiRequirements({ goalType: goal, objective: text, source })
    ];
  }

  if (goal === GOAL_TYPES.BUG_FIX || goal === GOAL_TYPES.REFACTOR) {
    pushRequirement(requirements, {
      capability: 'TEST',
      required: true,
      source,
      confidence: 0.72,
      evidence: normalizeEvidence([`goalType:${goal}`, `objective:${text.slice(0, 120)}`]),
      priority: 100
    });
    pushRequirement(requirements, {
      capability: 'BUILD',
      required: goal === GOAL_TYPES.REFACTOR,
      source,
      confidence: 0.68,
      evidence: normalizeEvidence([`goalType:${goal}`, `objective:${text.slice(0, 120)}`]),
      priority: 90
    });
    return requirements;
  }

  if (capabilityHints.size > 0) {
    const ordered = [...capabilityHints];
    for (let index = 0; index < ordered.length; index += 1) {
      const capability = ordered[index];
      pushRequirement(requirements, {
        capability,
        required: true,
        source,
        confidence: 0.7,
        evidence: normalizeEvidence([`objective:${text.slice(0, 120)}`, `goalType:${goal}`]),
        priority: 100 - index
      });
    }
    return requirements;
  }

  if (goal === GOAL_TYPES.UNKNOWN) {
    pushRequirement(requirements, {
      capability: 'APPLICATION_ENTRY',
      required: true,
      source,
      confidence: 0.45,
      evidence: normalizeEvidence([`objective:${text.slice(0, 120)}`, `goalType:${goal}`]),
      priority: 100
    });
  }

  return requirements;
}

export function normalizeRequirement(requirement = {}) {
  return ensureRequirementShape(requirement);
}

export function deduplicateRequirements(requirements = []) {
  const merged = new Map();
  for (const requirement of Array.isArray(requirements) ? requirements : []) {
    const normalized = ensureRequirementShape(requirement);
    const key = `${normalized.capability}|${normalized.artifactType}|${normalized.source}`.toLowerCase();
    if (!merged.has(key)) {
      merged.set(key, normalized);
      continue;
    }
    merged.set(key, mergeRequirements([merged.get(key), normalized]));
  }
  return [...merged.values()].sort((left, right) => right.priority - left.priority || right.confidence - left.confidence);
}

export function mergeRequirements(requirements = []) {
  const list = Array.isArray(requirements) ? requirements.filter(Boolean) : [];
  if (list.length === 0) return null;
  const [first, ...rest] = list.map(ensureRequirementShape);
  const output = { ...first };
  for (const requirement of rest) {
    output.required = output.required || requirement.required;
    output.optional = output.optional && requirement.optional;
    output.evidence = unique([...(output.evidence || []), ...(requirement.evidence || [])]);
    output.dependencies = unique([...(output.dependencies || []), ...(requirement.dependencies || [])]);
    output.sourceStrategies = unique([...(output.sourceStrategies || []), ...(requirement.sourceStrategies || [])]);
    output.confidence = Math.max(output.confidence || 0, requirement.confidence || 0);
    output.priority = Math.max(output.priority || 0, requirement.priority || 0);
    output.implementationIndependent = output.implementationIndependent !== false && requirement.implementationIndependent !== false;
    output.executionEligible = output.executionEligible === true && requirement.executionEligible === true;
    if (!output.purpose && requirement.purpose) output.purpose = requirement.purpose;
    if (!output.artifactType && requirement.artifactType) output.artifactType = requirement.artifactType;
  }
  return ensureRequirementShape(output);
}

function normalizeSemanticRequirementId(value = '') {
  return `requirement:${normalizeRequirementId(value)}`;
}

function semanticNodeToRequirement(node = {}, objective = '') {
  const normalizedNode = normalizeSemanticNode(node);
  const capability = String(normalizedNode.capability || normalizedNode.description || 'APPLICATION_ENTRY').trim().toUpperCase();
  const artifactType = SEMANTIC_ARTIFACT_TYPES[normalizedNode.category] || CAPABILITY_META[capability]?.artifactType || 'source';
  return ensureRequirementShape({
    id: normalizeSemanticRequirementId(normalizedNode.id || capability),
    capability,
    artifactType,
    purpose: normalizedNode.description || CAPABILITY_META[capability]?.purpose || 'Semantic capability surface',
    required: normalizedNode.required !== false,
    optional: normalizedNode.optional === true,
    evidence: unique([
      ...(Array.isArray(normalizedNode.evidence) ? normalizedNode.evidence : []),
      `semantic:${normalizedNode.id}`,
      `objective:${String(objective || '').slice(0, 120)}`
    ]),
    confidence: normalizedNode.confidence ?? 0.5,
    source: 'objective_semantic',
    dependencies: [],
    priority: Number.isFinite(Number(normalizedNode.priority)) ? Number(normalizedNode.priority) : 50
  });
}

function semanticGraphToRequirements(semanticGoalGraph = {}, objective = '') {
  const nodes = Array.isArray(semanticGoalGraph?.nodes) ? semanticGoalGraph.nodes.map(node => normalizeSemanticNode(node)) : [];
  const requirementBySemanticId = new Map();
  const requirements = [];

  for (const node of nodes) {
    const requirement = semanticNodeToRequirement(node, objective);
    requirementBySemanticId.set(node.id, requirement.id);
    requirements.push(requirement);
  }

  for (const requirement of requirements) {
    const sourceNode = nodes.find(node => normalizeSemanticRequirementId(node.id) === requirement.id);
    if (!sourceNode) continue;
    requirement.dependencies = unique(
      (Array.isArray(sourceNode.dependencies) ? sourceNode.dependencies : [])
        .map(dependencyId => requirementBySemanticId.get(dependencyId))
        .filter(Boolean)
    );
  }

  return deduplicateRequirements(requirements);
}

function addStrategyRequirement(items, requirement) {
  if (!requirement) return;
  items.push(ensureRequirementShape(requirement, items.length));
}

function strategyNodeToRequirements(strategy = {}, objective = '') {
  const strategyName = String(strategy?.strategy || '').trim();
  const lowerStrategy = strategyName.toLowerCase();
  const sourceConstraints = unique(Array.isArray(strategy?.sourceConstraints) ? strategy.sourceConstraints : []);
  const confidence = Number.isFinite(Number(strategy?.confidence)) ? Number(strategy.confidence) : 0.7;
  const evidence = unique([
    ...(Array.isArray(strategy?.sourceConstraints) ? strategy.sourceConstraints.map(constraintId => `strategyConstraint:${constraintId}`) : []),
    `strategy:${strategyName}`,
    `objective:${String(objective || '').slice(0, 120)}`
  ]);
  const required = strategy?.required !== false;
  const common = {
    required,
    optional: false,
    confidence,
    source: 'planning_strategy',
    evidence,
    dependencies: [],
    priority: Number.isFinite(Number(strategy?.priority)) ? Number(strategy.priority) : 80
  };

  const items = [];
  const push = (capability, artifactType = 'source', purpose = '') => {
    addStrategyRequirement(items, {
      ...common,
      id: `requirement:${normalizeRequirementId(`${strategyName}-${capability}`)}`,
      capability,
      artifactType,
      purpose: purpose || `${strategyName} requirement`
    });
  };

  if (lowerStrategy.includes('react spa')) {
    push('APPLICATION_ENTRY', 'source', 'React SPA entry surface');
    push('ROUTER', 'source', 'React SPA routing surface');
    push('GLOBAL_STYLE', 'style', 'React SPA styling surface');
    push('STATE', 'source', 'React SPA state surface');
    push('BUILD', 'config', 'React SPA build surface');
  } else if (lowerStrategy.includes('next.js app')) {
    push('APPLICATION_ENTRY', 'source', 'Next.js app entry surface');
    push('ROUTER', 'source', 'Next.js routing surface');
    push('GLOBAL_STYLE', 'style', 'Next.js styling surface');
    push('BUILD', 'config', 'Next.js build surface');
  } else if (lowerStrategy.includes('vue spa')) {
    push('APPLICATION_ENTRY', 'source', 'Vue SPA entry surface');
    push('ROUTER', 'source', 'Vue SPA routing surface');
    push('GLOBAL_STYLE', 'style', 'Vue SPA styling surface');
    push('STATE', 'source', 'Vue SPA state surface');
    push('BUILD', 'config', 'Vue SPA build surface');
  } else if (lowerStrategy.includes('flutter app')) {
    push('APPLICATION_ENTRY', 'source', 'Flutter app entry surface');
    push('STATE', 'source', 'Flutter state surface');
    push('BUILD', 'config', 'Flutter build surface');
  } else if (lowerStrategy.includes('laravel app')) {
    push('APPLICATION_ENTRY', 'source', 'Laravel app entry surface');
    push('GLOBAL_STYLE', 'style', 'Laravel styling surface');
    push('ROUTER', 'source', 'Laravel routing surface');
    push('BUILD', 'config', 'Laravel build surface');
  } else if (lowerStrategy.includes('typed project')) {
    push('VALIDATION', 'source', 'Type-safe validation surface');
    push('TEST', 'test', 'Type-safe test surface');
  } else if (lowerStrategy.includes('utility css')) {
    push('GLOBAL_STYLE', 'style', 'Utility CSS styling surface');
  } else if (lowerStrategy.includes('animation strategy')) {
    push('ANIMATION', 'source', 'Motion design surface');
  } else if (lowerStrategy.includes('responsive layout strategy')) {
    push('GLOBAL_STYLE', 'style', 'Responsive layout surface');
  } else if (lowerStrategy.includes('accessibility strategy')) {
    push('ACCESSIBILITY', 'source', 'Accessible component surface');
  } else if (lowerStrategy.includes('seo strategy')) {
    push('QUALITY', 'source', 'SEO quality surface');
  } else if (lowerStrategy.includes('component reuse strategy')) {
    push('FEATURES', 'component', 'Reusable component surface');
  } else if (lowerStrategy.includes('performance strategy')) {
    push('PERFORMANCE', 'source', 'Performance optimization surface');
  } else if (lowerStrategy.includes('production quality strategy') || lowerStrategy.includes('quality strategy')) {
    push('TEST', 'test', 'Production quality test surface');
    push('BUILD', 'config', 'Production quality build surface');
  } else if (lowerStrategy.includes('security strategy')) {
    push('SECURITY', 'source', 'Security hardening surface');
    push('VALIDATION', 'source', 'Security validation surface');
  } else if (lowerStrategy.includes('testing strategy')) {
    push('TEST', 'test', 'Testing surface');
  } else if (lowerStrategy.includes('build strategy')) {
    push('BUILD', 'config', 'Build surface');
  } else if (lowerStrategy.includes('landing page strategy')) {
    push('APPLICATION_ENTRY', 'source', 'Landing page entry surface');
    push('GLOBAL_STYLE', 'style', 'Landing page styling surface');
    push('NAVIGATION', 'component', 'Landing page navigation surface');
    push('HERO', 'component', 'Landing page hero surface');
    push('FEATURES', 'component', 'Landing page features surface');
    push('CTA', 'component', 'Landing page CTA surface');
    push('FOOTER', 'component', 'Landing page footer surface');
  } else if (lowerStrategy.includes('dashboard strategy') || lowerStrategy.includes('admin interface strategy')) {
    push('APPLICATION_ENTRY', 'source', 'Workspace entry surface');
    push('GLOBAL_STYLE', 'style', 'Workspace styling surface');
    push('NAVIGATION', 'component', 'Workspace navigation surface');
    push('DASHBOARD', 'component', 'Workspace dashboard surface');
    push('AUTH', 'source', 'Workspace auth surface');
  }

  return items;
}

function strategyGraphToRequirements(strategyGraph = {}, objective = '') {
  const strategies = Array.isArray(strategyGraph?.strategies) ? strategyGraph.strategies : [];
  const initializationStrategies = Array.isArray(strategyGraph?.initializationStrategies) ? strategyGraph.initializationStrategies : [];
  const requirements = [];

  for (const strategy of strategies) {
    const derived = strategyNodeToRequirements(strategy, objective);
    requirements.push(...derived);
  }
  for (const strategy of initializationStrategies) {
    const derived = strategyNodeToRequirements(strategy, objective);
    requirements.push(...derived);
  }

  return deduplicateRequirements(requirements);
}

export function inferRequiredArtifacts({
  objective = '',
  goalType = GOAL_TYPES.UNKNOWN,
  planningContext = {},
  projectScanSnapshot = {},
  projectIntent = {},
  policies = {},
  semanticGoalGraph = null,
  planningStrategyGraph = null,
  translatedRequirementGraph = null,
  requestedFileDetails = []
} = {}) {
  const objectiveText = String(objective || projectIntent?.objective || projectIntent?.prompt || '').trim();
  const goal = String(goalType || projectIntent?.goalType || GOAL_TYPES.UNKNOWN).toUpperCase();
  const semanticBundle = semanticGoalGraph || buildSemanticGoalGraph({
    objective: objectiveText,
    projectIntent: {
      ...projectIntent,
      objective: objectiveText,
      prompt: objectiveText
    }
  });
  const semanticGraph = semanticBundle?.semanticGoalGraph || semanticBundle;
  const strategyBundle = planningStrategyGraph || semanticBundle?.planningStrategyGraph || buildPlanningStrategyGraph({
    objective: objectiveText,
    projectIntent: {
      ...projectIntent,
      objective: objectiveText,
      prompt: objectiveText
    }
  });
  const requirementGraph = translatedRequirementGraph || buildRequirementGraph({
    planningStrategyGraph: strategyBundle,
    requestedFileDetails
  });
  let normalized = deduplicateRequirements(
    Array.isArray(requirementGraph?.requirements)
      ? requirementGraph.requirements.map(requirement => normalizeTranslatedRequirement(requirement))
      : []
  );
  if (normalized.length === 0) {
    normalized = deduplicateRequirements([
      ...semanticGraphToRequirements(semanticGraph, objectiveText),
      ...strategyGraphToRequirements(strategyBundle, objectiveText)
    ]);
  }

  console.log('[ARTIFACT_REQUIREMENT_GRAPH_START]', {
    goalType: goal,
    requirementCount: normalized.length,
    semanticNodeCount: Array.isArray(semanticGraph?.nodes) ? semanticGraph.nodes.length : 0,
    initializationAllowed: policies?.ALLOW_PROJECT_INITIALIZATION === true || policies?.ALLOW_NEW_PROJECT_INITIALIZATION === true
  });

  for (const requirement of normalized) {
    console.log('[ARTIFACT_REQUIREMENT_CREATED]', {
      id: requirement.id,
      capability: requirement.capability,
      artifactType: requirement.artifactType,
      required: requirement.required,
      optional: requirement.optional,
      dependencies: requirement.dependencies,
      priority: requirement.priority,
      confidence: requirement.confidence,
      source: requirement.source
    });
  }

  const graph = {
    objective: objectiveText,
    goalType: goal,
    semanticGoalGraph: semanticGraph,
    planningStrategyGraph: strategyBundle,
    translatedRequirementGraph: requirementGraph,
    mergedSemanticGraph: semanticBundle?.mergedSemanticGraph || {
      nodes: [
        ...(Array.isArray(semanticGraph?.nodes) ? semanticGraph.nodes : []),
        ...(Array.isArray(strategyBundle?.strategies) ? strategyBundle.strategies : []),
        ...(Array.isArray(strategyBundle?.initializationStrategies) ? strategyBundle.initializationStrategies : [])
      ],
      edges: [
        ...(Array.isArray(semanticGraph?.edges) ? semanticGraph.edges : []),
        ...(Array.isArray(strategyBundle?.edges) ? strategyBundle.edges : [])
      ]
    },
    requirements: normalized,
    edges: normalized.flatMap(requirement =>
      (Array.isArray(requirement.dependencies) ? requirement.dependencies : []).map(dependencyId => ({
        from: dependencyId,
        to: requirement.id,
        relation: 'depends_on'
      }))
    ),
    source: 'strategy_requirement_translation'
  };

  const validation = validateArtifactRequirements(graph);
  if (!validation.valid) {
    console.log('[ARTIFACT_REQUIREMENT_GRAPH_INVALID]', {
      errorCount: validation.errors.length,
      errors: validation.errors
    });
  }

  console.log('[ARTIFACT_REQUIREMENT_GRAPH_COMPLETE]', {
    requirementCount: graph.requirements.length,
    edgeCount: graph.edges.length,
    capabilityCount: graph.requirements.length,
    dependencyCount: graph.edges.length,
    valid: validation.valid
  });

  return {
    ...graph,
    validation
  };
}

export function buildArtifactRequirementGraph(options = {}) {
  return inferRequiredArtifacts(options);
}
