import { unique, normalizeLower } from '../projectIntelligence/inference.js';

const ALLOWED_CATEGORIES = new Set([
  'APPLICATION',
  'COMPONENT',
  'LAYOUT',
  'ROUTING',
  'ENTRY',
  'STATE',
  'STYLING',
  'THEME',
  'DATA',
  'API',
  'AUTHENTICATION',
  'VALIDATION',
  'DOCUMENTATION',
  'TESTING',
  'BUILD',
  'DEPLOYMENT',
  'ANIMATION',
  'ACCESSIBILITY',
  'SEO',
  'PERFORMANCE',
  'QUALITY',
  'CONTENT'
]);

const FORBIDDEN_TEXT_PATTERNS = [
  /(?:^|[\s"'`([{])(?:package\.json|composer\.json|vite\.config\.[a-z]+|tailwind\.config\.[a-z]+|app\.tsx|main\.tsx|index\.html|index\.php)\b/i,
  /(?:^|[\s"'`([{])(?:write_file|patch_file|run_terminal|apply_patch)\b/i,
  /\b(?:npm|pnpm|yarn|bun|composer|flutter\s+run|flutter\s+test|npm\s+install|npm\s+run|vitest|jest|playwright)\b/i,
  /\b(?:workspace|projectscan|verifiedfiles|verifiedcommands|entryfiles|bootstrapprofile|frameworkevidence)\b/i
];

function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizeId(value = '') {
  return normalizeText(value)
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function normalizeCategory(value = '') {
  const category = normalizeText(value).toUpperCase();
  return ALLOWED_CATEGORIES.has(category) ? category : 'CONTENT';
}

function normalizeCapability(value = '') {
  return normalizeText(value).toUpperCase();
}

function normalizeSourceStrategies(values = []) {
  return unique((Array.isArray(values) ? values : [])
    .map(value => normalizeText(value))
    .filter(Boolean));
}

function normalizeDependencies(values = []) {
  return unique((Array.isArray(values) ? values : [])
    .map(value => normalizeText(value))
    .filter(Boolean));
}

function makeRequirement(requirement = {}, index = 0) {
  const capability = normalizeCapability(requirement.capability || requirement.name || `Requirement ${index + 1}`);
  const category = normalizeCategory(requirement.category || requirement.kind || 'CONTENT');
  const purpose = normalizeText(requirement.purpose || requirement.description || capability || `Requirement ${index + 1}`);
  const sourceStrategies = Array.isArray(requirement.sourceStrategies) && requirement.sourceStrategies.length > 0
    ? normalizeSourceStrategies(requirement.sourceStrategies)
    : normalizeSourceStrategies(requirement.sourceStrategy ? [requirement.sourceStrategy] : []);
  const dependencies = normalizeDependencies(requirement.dependencies || []);

  return {
    id: normalizeText(requirement.id) || `requirement:${normalizeId(capability || `item-${index + 1}`)}`,
    capability,
    category,
    purpose,
    required: requirement.required !== false,
    dependencies,
    sourceStrategies,
    implementationIndependent: requirement.implementationIndependent !== false,
    executionEligible: false,
    artifactType: normalizeText(requirement.artifactType || requirement.type || 'source'),
    confidence: Number.isFinite(Number(requirement.confidence)) ? Math.max(0, Math.min(1, Number(requirement.confidence))) : 0.5,
    source: normalizeText(requirement.source || 'planning_strategy') || 'planning_strategy',
    priority: Number.isFinite(Number(requirement.priority)) ? Number(requirement.priority) : 50
  };
}

function createRequirement({
  capability,
  category,
  purpose,
  sourceStrategy,
  sourceStrategies = [],
  dependencies = [],
  confidence = 0.72,
  priority = 80,
  artifactType = 'source',
  source = 'planning_strategy'
} = {}) {
  return makeRequirement({
    capability,
    category,
    purpose,
    sourceStrategies: normalizeSourceStrategies([sourceStrategy, ...sourceStrategies]),
    dependencies,
    confidence,
    priority,
    artifactType,
    source
  });
}

function addRequirements(list, entries = []) {
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry) continue;
    list.push(makeRequirement(entry, list.length));
  }
}

function explicitFileRequirement(detail = {}, index = 0) {
  const requestedKind = normalizeText(detail?.kind || detail?.requestedKind || 'EXPLICIT_CREATE').toUpperCase();
  const explicitName = requestedKind === 'EXPLICIT_MODIFICATION'
    ? 'Explicit File Modification'
    : 'Explicit File Requirement';
  return makeRequirement({
    id: `requirement:explicit-file-${index + 1}`,
    capability: 'EXPLICIT_FILE_REQUEST',
    category: 'CONTENT',
    purpose: `${explicitName} ${index + 1}`.trim(),
    required: true,
    dependencies: [],
    sourceStrategies: [`explicit:${requestedKind || 'UNKNOWN'}`],
    implementationIndependent: true,
    executionEligible: false,
    artifactType: 'source',
    confidence: 0.62,
    source: 'explicit_file_request',
    priority: 40
  }, index);
}

function strategyToRequirements(strategy = {}, index = 0) {
  const strategyName = normalizeText(strategy?.strategy);
  const lowerStrategy = normalizeLower(strategyName);
  const common = {
    sourceStrategy: strategyName || `strategy-${index + 1}`,
    confidence: Number.isFinite(Number(strategy?.confidence)) ? Number(strategy.confidence) : 0.72,
    priority: Number.isFinite(Number(strategy?.priority)) ? Number(strategy.priority) : 80,
    source: 'planning_strategy'
  };

  const requirements = [];
  const push = (capability, category, purpose, artifactType = 'source', extra = {}) => {
    requirements.push(createRequirement({
      capability,
      category,
      purpose,
      artifactType,
      ...common,
      ...extra
    }));
  };

  if (lowerStrategy.includes('react spa')) {
    push('APPLICATION_ENTRY', 'ENTRY', 'Application Entry', 'source');
    push('ROOT_COMPONENT', 'COMPONENT', 'Root Component', 'component');
    push('COMPONENT_HIERARCHY', 'COMPONENT', 'Component Hierarchy', 'component');
    push('ROUTING', 'ROUTING', 'Routing Capability', 'source');
    push('STYLING', 'STYLING', 'Styling Capability', 'style');
    push('THEME', 'THEME', 'Theme Capability', 'source');
  } else if (lowerStrategy.includes('next.js app')) {
    push('APPLICATION_ENTRY', 'ENTRY', 'Application Entry', 'source');
    push('ROOT_COMPONENT', 'COMPONENT', 'Root Component', 'component');
    push('ROUTING', 'ROUTING', 'Routing Capability', 'source');
    push('STYLING', 'STYLING', 'Styling Capability', 'style');
    push('THEME', 'THEME', 'Theme Capability', 'source');
  } else if (lowerStrategy.includes('vue spa')) {
    push('APPLICATION_ENTRY', 'ENTRY', 'Application Entry', 'source');
    push('ROOT_COMPONENT', 'COMPONENT', 'Root Component', 'component');
    push('COMPONENT_HIERARCHY', 'COMPONENT', 'Component Hierarchy', 'component');
    push('ROUTING', 'ROUTING', 'Routing Capability', 'source');
    push('STYLING', 'STYLING', 'Styling Capability', 'style');
    push('THEME', 'THEME', 'Theme Capability', 'source');
  } else if (lowerStrategy.includes('flutter app')) {
    push('APPLICATION_ENTRY', 'ENTRY', 'Application Entry', 'source');
    push('STATE', 'STATE', 'State Capability', 'source');
    push('BUILD', 'BUILD', 'Build Capability', 'config');
  } else if (lowerStrategy.includes('laravel app')) {
    push('APPLICATION_ENTRY', 'ENTRY', 'Application Entry', 'source');
    push('ROUTING', 'ROUTING', 'Routing Capability', 'source');
    push('STYLING', 'STYLING', 'Styling Capability', 'style');
    push('BUILD', 'BUILD', 'Build Capability', 'config');
  } else if (lowerStrategy.includes('typed project')) {
    push('VALIDATION', 'VALIDATION', 'Validation Capability', 'source');
    push('TESTING', 'TESTING', 'Testing Capability', 'test');
  } else if (lowerStrategy.includes('utility css')) {
    push('STYLING_SYSTEM', 'STYLING', 'Styling System', 'style');
  } else if (lowerStrategy.includes('responsive layout strategy')) {
    push('RESPONSIVE_LAYOUT', 'LAYOUT', 'Responsive Layout', 'style');
    push('BREAKPOINT_SUPPORT', 'LAYOUT', 'Breakpoint Support', 'style');
  } else if (lowerStrategy.includes('animation strategy')) {
    push('ANIMATION_LAYER', 'ANIMATION', 'Animation Layer', 'source');
    push('MOTION_CAPABILITY', 'ANIMATION', 'Motion Capability', 'source');
  } else if (lowerStrategy.includes('accessibility strategy')) {
    push('SEMANTIC_STRUCTURE', 'ACCESSIBILITY', 'Semantic Structure', 'source');
    push('KEYBOARD_SUPPORT', 'ACCESSIBILITY', 'Keyboard Support', 'source');
    push('ARIA_SUPPORT', 'ACCESSIBILITY', 'ARIA Support', 'source');
  } else if (lowerStrategy.includes('performance strategy')) {
    push('CODE_SPLITTING', 'PERFORMANCE', 'Code Splitting', 'source');
    push('LAZY_LOADING', 'PERFORMANCE', 'Lazy Loading', 'source');
    push('PERFORMANCE_OPTIMIZATION', 'PERFORMANCE', 'Performance Optimization', 'source');
  } else if (lowerStrategy.includes('seo strategy')) {
    push('METADATA', 'SEO', 'Metadata', 'source');
    push('STRUCTURED_CONTENT', 'SEO', 'Structured Content', 'source');
    push('SEMANTIC_HTML', 'SEO', 'Semantic HTML', 'source');
  } else if (lowerStrategy.includes('production quality strategy') || lowerStrategy.includes('quality strategy')) {
    push('QUALITY', 'QUALITY', 'Quality Assurance', 'test');
    push('TESTING', 'TESTING', 'Testing Capability', 'test');
    push('BUILD', 'BUILD', 'Build Capability', 'config');
  } else if (lowerStrategy.includes('security strategy')) {
    push('AUTHENTICATION', 'AUTHENTICATION', 'Authentication Capability', 'source');
    push('VALIDATION', 'VALIDATION', 'Validation Capability', 'source');
  } else if (lowerStrategy.includes('testing strategy')) {
    push('TESTING', 'TESTING', 'Testing Capability', 'test');
  } else if (lowerStrategy.includes('build strategy')) {
    push('BUILD', 'BUILD', 'Build Capability', 'config');
  } else if (lowerStrategy.includes('react project initialization')) {
    push('PROJECT_MANIFEST', 'BUILD', 'Project Manifest', 'config');
    push('DEPENDENCY_MANIFEST', 'BUILD', 'Dependency Manifest', 'config');
    push('COMPONENT_STRUCTURE', 'COMPONENT', 'Component Structure', 'component');
  } else if (lowerStrategy.includes('static site initialization')) {
    push('PROJECT_MANIFEST', 'BUILD', 'Project Manifest', 'config');
    push('DEPENDENCY_MANIFEST', 'BUILD', 'Dependency Manifest', 'config');
    push('COMPONENT_STRUCTURE', 'COMPONENT', 'Component Structure', 'component');
  } else if (lowerStrategy.includes('landing page strategy')) {
    push('APPLICATION_ENTRY', 'ENTRY', 'Application Entry', 'source');
    push('ROOT_COMPONENT', 'COMPONENT', 'Root Component', 'component');
    push('COMPONENT_HIERARCHY', 'COMPONENT', 'Component Hierarchy', 'component');
    push('ROUTING', 'ROUTING', 'Routing Capability', 'source');
    push('STYLING', 'STYLING', 'Styling Capability', 'style');
    push('THEME', 'THEME', 'Theme Capability', 'source');
    push('RESPONSIVE_LAYOUT', 'LAYOUT', 'Responsive Layout', 'style');
    push('BREAKPOINT_SUPPORT', 'LAYOUT', 'Breakpoint Support', 'style');
    push('ANIMATION_LAYER', 'ANIMATION', 'Animation Layer', 'source');
    push('MOTION_CAPABILITY', 'ANIMATION', 'Motion Capability', 'source');
    push('SEMANTIC_STRUCTURE', 'ACCESSIBILITY', 'Semantic Structure', 'source');
    push('KEYBOARD_SUPPORT', 'ACCESSIBILITY', 'Keyboard Support', 'source');
    push('ARIA_SUPPORT', 'ACCESSIBILITY', 'ARIA Support', 'source');
    push('METADATA', 'SEO', 'Metadata', 'source');
    push('STRUCTURED_CONTENT', 'SEO', 'Structured Content', 'source');
    push('SEMANTIC_HTML', 'SEO', 'Semantic HTML', 'source');
  } else if (lowerStrategy.includes('dashboard strategy') || lowerStrategy.includes('admin interface strategy')) {
    push('APPLICATION_ENTRY', 'ENTRY', 'Application Entry', 'source');
    push('ROOT_COMPONENT', 'COMPONENT', 'Root Component', 'component');
    push('COMPONENT_HIERARCHY', 'COMPONENT', 'Component Hierarchy', 'component');
    push('ROUTING', 'ROUTING', 'Routing Capability', 'source');
    push('STATE', 'STATE', 'State Capability', 'source');
    push('AUTHENTICATION', 'AUTHENTICATION', 'Authentication Capability', 'source');
  }

  return requirements;
}

function dedupeKey(requirement = {}) {
  return [
    normalizeCapability(requirement.capability),
    normalizeCategory(requirement.category),
    normalizeText(requirement.purpose).toLowerCase(),
    normalizeText(requirement.source).toLowerCase()
  ].join('|');
}

export function normalizeRequirement(requirement = {}) {
  return makeRequirement(requirement);
}

export function mergeRequirements(requirements = []) {
  const merged = new Map();
  for (const requirement of Array.isArray(requirements) ? requirements : []) {
    const normalized = makeRequirement(requirement);
    const key = dedupeKey(normalized);
    if (!merged.has(key)) {
      merged.set(key, normalized);
      continue;
    }
    const existing = merged.get(key);
    merged.set(key, makeRequirement({
      ...existing,
      required: existing.required || normalized.required,
      dependencies: unique([...(existing.dependencies || []), ...(normalized.dependencies || [])]),
      sourceStrategies: unique([...(existing.sourceStrategies || []), ...(normalized.sourceStrategies || [])]),
      confidence: Math.max(existing.confidence || 0, normalized.confidence || 0),
      priority: Math.max(existing.priority || 0, normalized.priority || 0)
    }));
  }
  return [...merged.values()].sort((left, right) => (right.priority || 0) - (left.priority || 0) || (right.confidence || 0) - (left.confidence || 0));
}

export function deriveArtifactRequirements({
  planningStrategyGraph = null,
  requestedFileDetails = []
} = {}) {
  const strategyRequirements = [];
  const strategies = Array.isArray(planningStrategyGraph?.strategies) ? planningStrategyGraph.strategies : [];
  const initializationStrategies = Array.isArray(planningStrategyGraph?.initializationStrategies) ? planningStrategyGraph.initializationStrategies : [];

  strategies.forEach((strategy, index) => addRequirements(strategyRequirements, strategyToRequirements(strategy, index)));
  initializationStrategies.forEach((strategy, index) => {
    const baseIndex = strategies.length + index;
    addRequirements(strategyRequirements, strategyToRequirements(strategy, baseIndex));
  });

  const explicitRequirements = [];
  for (const [index, detail] of (Array.isArray(requestedFileDetails) ? requestedFileDetails : []).entries()) {
    explicitRequirements.push(explicitFileRequirement(detail, index));
  }

  return mergeRequirements([...strategyRequirements, ...explicitRequirements]);
}

export function validateArtifactRequirements(requirementGraph = {}) {
  const requirements = Array.isArray(requirementGraph?.requirements) ? requirementGraph.requirements : [];
  const errors = [];

  for (const requirement of requirements) {
    if (!requirement || typeof requirement !== 'object') {
      errors.push('Requirement must be an object');
      continue;
    }
    if (requirement.implementationIndependent === false) {
      errors.push(`Requirement ${requirement.id || requirement.capability || 'unknown'} must remain implementation independent`);
    }
    if (requirement.executionEligible === true) {
      errors.push(`Requirement ${requirement.id || requirement.capability || 'unknown'} must not be execution eligible`);
    }
    if (!Array.isArray(requirement.sourceStrategies) || requirement.sourceStrategies.length === 0) {
      errors.push(`Requirement ${requirement.id || requirement.capability || 'unknown'} must reference one or more planning strategies`);
    }
    const serialized = JSON.stringify(requirement);
    for (const pattern of FORBIDDEN_TEXT_PATTERNS) {
      if (pattern.test(serialized)) {
        errors.push(`Requirement ${requirement.id || requirement.capability || 'unknown'} contains forbidden implementation detail`);
        break;
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function buildRequirementGraph({
  planningStrategyGraph = null,
  requestedFileDetails = []
} = {}) {
  const requirements = deriveArtifactRequirements({
    planningStrategyGraph,
    requestedFileDetails
  });
  const graph = {
    requirements,
    edges: requirements.flatMap(requirement =>
      (Array.isArray(requirement.dependencies) ? requirement.dependencies : []).map(dependencyId => ({
        from: dependencyId,
        to: requirement.id,
        relation: 'depends_on'
      }))
    ),
    planningStrategyGraph: planningStrategyGraph || null,
    source: 'strategy_requirement_translation'
  };

  return graph;
}

export function translatePlanningStrategies({
  planningStrategyGraph = null,
  requestedFileDetails = []
} = {}) {
  console.log('[STRATEGY_REQUIREMENT_TRANSLATION_START]', {
    strategyCount: Array.isArray(planningStrategyGraph?.strategies) ? planningStrategyGraph.strategies.length : 0,
    initializationStrategyCount: Array.isArray(planningStrategyGraph?.initializationStrategies) ? planningStrategyGraph.initializationStrategies.length : 0,
    explicitFileCount: Array.isArray(requestedFileDetails) ? requestedFileDetails.length : 0
  });

  const graph = buildRequirementGraph({
    planningStrategyGraph,
    requestedFileDetails
  });

  let previousCount = 0;
  for (const requirement of graph.requirements) {
    console.log('[ARTIFACT_REQUIREMENT_CREATED]', {
      id: requirement.id,
      capability: requirement.capability,
      category: requirement.category,
      purpose: requirement.purpose,
      required: requirement.required,
      dependencies: requirement.dependencies,
      sourceStrategies: requirement.sourceStrategies,
      implementationIndependent: requirement.implementationIndependent,
      executionEligible: requirement.executionEligible
    });
  }

  if (Array.isArray(planningStrategyGraph?.strategies) || Array.isArray(planningStrategyGraph?.initializationStrategies)) {
    const rawCount = (Array.isArray(planningStrategyGraph?.strategies) ? planningStrategyGraph.strategies.length : 0) +
      (Array.isArray(planningStrategyGraph?.initializationStrategies) ? planningStrategyGraph.initializationStrategies.length : 0) +
      (Array.isArray(requestedFileDetails) ? requestedFileDetails.length : 0);
    previousCount = rawCount;
  }

  const mergedCount = graph.requirements.length;
  if (previousCount > 0 && mergedCount < previousCount) {
    console.log('[ARTIFACT_REQUIREMENT_MERGED]', {
      before: previousCount,
      after: mergedCount
    });
  }

  const validation = validateArtifactRequirements(graph);
  console.log('[REQUIREMENT_GRAPH_CREATED]', {
    requirementCount: graph.requirements.length,
    edgeCount: graph.edges.length
  });
  console.log('[REQUIREMENT_GRAPH_VALID]', {
    requirementCount: graph.requirements.length,
    valid: validation.valid,
    errorCount: validation.errors.length
  });
  console.log('[REQUIREMENT_GRAPH_COMPLETE]', {
    requirementCount: graph.requirements.length,
    edgeCount: graph.edges.length,
    valid: validation.valid
  });
  console.log('[STRATEGY_REQUIREMENT_TRANSLATION_COMPLETE]', {
    requirementCount: graph.requirements.length,
    edgeCount: graph.edges.length,
    valid: validation.valid
  });

  return {
    ...graph,
    validation
  };
}
