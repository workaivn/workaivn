const OBJECTIVE_TEXT_SOURCE = 'OBJECTIVE_TEXT';

const STRATEGY_CATEGORIES = new Set([
  'PROJECT',
  'ARCHITECTURE',
  'INITIALIZATION',
  'COMPONENT',
  'LAYOUT',
  'STYLING',
  'STATE',
  'ROUTING',
  'ANIMATION',
  'DATA',
  'VALIDATION',
  'TESTING',
  'DEPLOYMENT',
  'BUILD',
  'QUALITY',
  'ACCESSIBILITY',
  'PERFORMANCE',
  'SECURITY'
]);

function normalizeText(value = '') {
  return String(value || '').trim();
}

function lower(value = '') {
  return normalizeText(value).toLowerCase();
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => normalizeText(value)).filter(Boolean))];
}

function slugify(value = '') {
  return normalizeText(value)
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function containsPathLikeText(text = '') {
  return /(?:^|[\s"'`([{])(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|html|css|php|py|cs|dart|yaml|yml|md|blade\.php|scss|sass|less)\b/i.test(String(text || '')) ||
    /(?:^|[\s"'`([{])(?:package\.json|composer\.json|vite\.config\.[a-z]+|tailwind\.config\.[a-z]+|app\.tsx|page\.tsx|index\.html|index\.php|lib\/main\.dart)\b/i.test(String(text || ''));
}

function containsCommandLikeText(text = '') {
  return /\b(?:npm|pnpm|yarn|bun|flutter\s+run|flutter\s+test|composer|php\s+-S|dotnet\s+build|node\s+--check|pytest|vitest|jest|run tests?|build app|deploy)\b/i.test(String(text || ''));
}

function containsExecutionLikeText(text = '') {
  return /\b(?:tool call|execution unit|intent node|read file|write file|apply patch|run terminal|validate)\b/i.test(String(text || ''));
}

function containsFrameworkFileText(text = '') {
  return /(?:^|[\s"'`([{])(?:package\.json|app\.tsx|main\.tsx|vite\.config\.ts|vite\.config\.js|tailwind\.config\.js|index\.html|composer\.json|index\.php|lib\/main\.dart)\b/i.test(String(text || ''));
}

function clampConfidence(value, fallback = 0.7) {
  if (!Number.isFinite(Number(value))) return fallback;
  return Math.max(0, Math.min(1, Number(value)));
}

function normalizeStrategy(strategy = {}, index = 0) {
  const sourceConstraints = unique(strategy.sourceConstraints || []);
  const dependencies = unique(strategy.dependencies || []);
  return {
    id: String(strategy.id || `strategy:${slugify(strategy.category || strategy.strategy || `item-${index + 1}`)}`),
    strategy: normalizeText(strategy.strategy) || 'Planning Strategy',
    category: STRATEGY_CATEGORIES.has(normalizeText(strategy.category).toUpperCase())
      ? normalizeText(strategy.category).toUpperCase()
      : 'PROJECT',
    purpose: normalizeText(strategy.purpose) || 'Implementation-independent planning strategy',
    required: strategy.required !== false,
    dependencies,
    sourceConstraints,
    confidence: clampConfidence(strategy.confidence, 0.7),
    implementationIndependent: strategy.implementationIndependent !== false,
    executionEligible: false,
    source: normalizeText(strategy.source).toUpperCase() || OBJECTIVE_TEXT_SOURCE,
    metadata: strategy.metadata && typeof strategy.metadata === 'object' ? { ...strategy.metadata } : {}
  };
}

function mergeStrategyGroup(items = []) {
  const merged = new Map();
  for (const strategy of Array.isArray(items) ? items : []) {
    const normalized = normalizeStrategy(strategy);
    const key = `${normalized.category}|${normalized.strategy}`.toLowerCase();
    if (!merged.has(key)) {
      merged.set(key, normalized);
      continue;
    }
    const current = merged.get(key);
    merged.set(key, normalizeStrategy({
      ...current,
      required: current.required || normalized.required,
      confidence: Math.max(current.confidence || 0, normalized.confidence || 0),
      dependencies: unique([...(current.dependencies || []), ...(normalized.dependencies || [])]),
      sourceConstraints: unique([...(current.sourceConstraints || []), ...(normalized.sourceConstraints || [])]),
      metadata: { ...(current.metadata || {}), ...(normalized.metadata || {}) }
    }));
  }
  return [...merged.values()];
}

function createStrategy({
  strategy,
  category,
  purpose,
  sourceConstraints = [],
  confidence = 0.8,
  dependencies = [],
  required = true,
  metadata = {}
} = {}) {
  return normalizeStrategy({
    strategy,
    category,
    purpose,
    sourceConstraints,
    confidence,
    dependencies,
    required,
    implementationIndependent: true,
    executionEligible: false,
    source: OBJECTIVE_TEXT_SOURCE,
    metadata
  });
}

function mapConstraintToStrategies(constraint = {}) {
  const value = lower(constraint?.value || constraint?.type || '');
  const sourceConstraintId = normalizeText(constraint?.id || '');
  const confidence = clampConfidence(constraint?.confidence, 0.8);
  const strategies = [];

  const push = (strategy) => {
    if (strategy) strategies.push(strategy);
  };

  if (value.includes('react')) {
    push(createStrategy({
      strategy: 'React SPA',
      category: 'PROJECT',
      purpose: 'Single-page React application strategy',
      sourceConstraints: [sourceConstraintId],
      confidence
    }));
  }
  if (value.includes('next')) {
    push(createStrategy({
      strategy: 'Next.js App',
      category: 'PROJECT',
      purpose: 'Next.js application strategy',
      sourceConstraints: [sourceConstraintId],
      confidence
    }));
  }
  if (value.includes('vue')) {
    push(createStrategy({
      strategy: 'Vue SPA',
      category: 'PROJECT',
      purpose: 'Vue single-page application strategy',
      sourceConstraints: [sourceConstraintId],
      confidence
    }));
  }
  if (value.includes('flutter')) {
    push(createStrategy({
      strategy: 'Flutter App',
      category: 'PROJECT',
      purpose: 'Flutter application strategy',
      sourceConstraints: [sourceConstraintId],
      confidence
    }));
  }
  if (value.includes('laravel')) {
    push(createStrategy({
      strategy: 'Laravel App',
      category: 'PROJECT',
      purpose: 'Laravel application strategy',
      sourceConstraints: [sourceConstraintId],
      confidence
    }));
  }
  if (value.includes('typescript')) {
    push(createStrategy({
      strategy: 'Typed Project',
      category: 'ARCHITECTURE',
      purpose: 'Type-safe implementation strategy',
      sourceConstraints: [sourceConstraintId],
      confidence
    }));
  }
  if (value.includes('tailwind')) {
    push(createStrategy({
      strategy: 'Utility CSS',
      category: 'STYLING',
      purpose: 'Utility-first styling strategy',
      sourceConstraints: [sourceConstraintId],
      confidence
    }));
  }
  if (value.includes('framer motion') || value === 'animation' || value.includes('animation')) {
    push(createStrategy({
      strategy: 'Animation Strategy',
      category: 'ANIMATION',
      purpose: 'Motion design strategy',
      sourceConstraints: [sourceConstraintId],
      confidence
    }));
  }
  if (value.includes('responsive') || value.includes('mobile friendly')) {
    push(createStrategy({
      strategy: 'Responsive Layout Strategy',
      category: 'LAYOUT',
      purpose: 'Responsive layout strategy',
      sourceConstraints: [sourceConstraintId],
      confidence
    }));
  }
  if (value.includes('accessibility') || value.includes('a11y')) {
    push(createStrategy({
      strategy: 'Accessibility Strategy',
      category: 'ACCESSIBILITY',
      purpose: 'Accessible interface strategy',
      sourceConstraints: [sourceConstraintId],
      confidence
    }));
  }
  if (value.includes('seo')) {
    push(createStrategy({
      strategy: 'SEO Strategy',
      category: 'QUALITY',
      purpose: 'Search optimization strategy',
      sourceConstraints: [sourceConstraintId],
      confidence
    }));
  }
  if (value.includes('reusable components')) {
    push(createStrategy({
      strategy: 'Component Reuse Strategy',
      category: 'COMPONENT',
      purpose: 'Shared component strategy',
      sourceConstraints: [sourceConstraintId],
      confidence
    }));
  }
  if (value.includes('performance')) {
    push(createStrategy({
      strategy: 'Performance Strategy',
      category: 'PERFORMANCE',
      purpose: 'Performance optimization strategy',
      sourceConstraints: [sourceConstraintId],
      confidence
    }));
  }
  if (value.includes('production ready') || value.includes('launch ready')) {
    push(createStrategy({
      strategy: 'Production Quality Strategy',
      category: 'QUALITY',
      purpose: 'Production quality strategy',
      sourceConstraints: [sourceConstraintId],
      confidence
    }));
  }
  if (value.includes('security')) {
    push(createStrategy({
      strategy: 'Security Strategy',
      category: 'SECURITY',
      purpose: 'Security hardening strategy',
      sourceConstraints: [sourceConstraintId],
      confidence
    }));
  }
  if (value.includes('no todo') || value.includes('no placeholder') || value.includes('code quality') || value.includes('maintainability') || value.includes('scalability')) {
    push(createStrategy({
      strategy: 'Quality Strategy',
      category: 'QUALITY',
      purpose: 'Quality-first implementation strategy',
      sourceConstraints: [sourceConstraintId],
      confidence
    }));
  }
  if (value.includes('testing') || value === 'tests') {
    push(createStrategy({
      strategy: 'Testing Strategy',
      category: 'TESTING',
      purpose: 'Testing-first implementation strategy',
      sourceConstraints: [sourceConstraintId],
      confidence
    }));
  }
  if (value.includes('build')) {
    push(createStrategy({
      strategy: 'Build Strategy',
      category: 'BUILD',
      purpose: 'Build and validation strategy',
      sourceConstraints: [sourceConstraintId],
      confidence
    }));
  }
  if (value.includes('dark mode')) {
    push(createStrategy({
      strategy: 'Dark Mode Styling Strategy',
      category: 'STYLING',
      purpose: 'Dark theme styling strategy',
      sourceConstraints: [sourceConstraintId],
      confidence
    }));
  }
  if (value.includes('landing page')) {
    push(createStrategy({
      strategy: 'Landing Page Strategy',
      category: 'PROJECT',
      purpose: 'Marketing landing page strategy',
      sourceConstraints: [sourceConstraintId],
      confidence
    }));
  }
  if (value.includes('dashboard')) {
    push(createStrategy({
      strategy: 'Dashboard Strategy',
      category: 'PROJECT',
      purpose: 'Dashboard application strategy',
      sourceConstraints: [sourceConstraintId],
      confidence
    }));
  }
  if (value.includes('admin panel')) {
    push(createStrategy({
      strategy: 'Admin Interface Strategy',
      category: 'PROJECT',
      purpose: 'Administrative interface strategy',
      sourceConstraints: [sourceConstraintId],
      confidence
    }));
  }

  return strategies;
}

function buildInitializationFromStrategy(strategy = {}) {
  const lowerStrategy = lower(strategy.strategy);
  const sourceConstraints = unique(strategy.sourceConstraints || []);
  const confidence = clampConfidence(strategy.confidence, 0.7);

  if (lowerStrategy.includes('react spa')) {
    return createStrategy({
      strategy: 'React Project Initialization',
      category: 'INITIALIZATION',
      purpose: 'React project initialization strategy',
      sourceConstraints,
      confidence,
      dependencies: [strategy.id]
    });
  }
  if (lowerStrategy.includes('next.js app')) {
    return createStrategy({
      strategy: 'Next.js Project Initialization',
      category: 'INITIALIZATION',
      purpose: 'Next.js project initialization strategy',
      sourceConstraints,
      confidence,
      dependencies: [strategy.id]
    });
  }
  if (lowerStrategy.includes('vue spa')) {
    return createStrategy({
      strategy: 'Vue Project Initialization',
      category: 'INITIALIZATION',
      purpose: 'Vue project initialization strategy',
      sourceConstraints,
      confidence,
      dependencies: [strategy.id]
    });
  }
  if (lowerStrategy.includes('flutter app')) {
    return createStrategy({
      strategy: 'Flutter Project Initialization',
      category: 'INITIALIZATION',
      purpose: 'Flutter project initialization strategy',
      sourceConstraints,
      confidence,
      dependencies: [strategy.id]
    });
  }
  if (lowerStrategy.includes('laravel app')) {
    return createStrategy({
      strategy: 'Laravel Project Initialization',
      category: 'INITIALIZATION',
      purpose: 'Laravel project initialization strategy',
      sourceConstraints,
      confidence,
      dependencies: [strategy.id]
    });
  }
  if (lowerStrategy.includes('landing page strategy')) {
    return createStrategy({
      strategy: 'Static Site Initialization',
      category: 'INITIALIZATION',
      purpose: 'Static site initialization strategy',
      sourceConstraints,
      confidence,
      dependencies: [strategy.id]
    });
  }
  return null;
}

export function mergeCompatibleStrategies(strategies = []) {
  return mergeStrategyGroup(strategies);
}

export function derivePlanningStrategies({
  constraintGraph = {},
  objective = '',
  projectIntent = {}
} = {}) {
  const constraints = Array.isArray(constraintGraph?.constraints)
    ? constraintGraph.constraints
    : (Array.isArray(constraintGraph?.nodes) ? constraintGraph.nodes : []);
  const strategies = [];

  for (const constraint of constraints) {
    const derived = mapConstraintToStrategies(constraint);
    for (const strategy of derived) {
      console.log('[PLANNING_STRATEGY_CREATED]', {
        strategy: strategy.strategy,
        category: strategy.category,
        sourceConstraints: strategy.sourceConstraints,
        executionEligible: strategy.executionEligible
      });
      strategies.push(strategy);
    }
  }

  const mergedStrategies = mergeCompatibleStrategies(strategies);
  if (mergedStrategies.length !== strategies.length) {
    console.log('[PLANNING_STRATEGY_MERGED]', {
      before: strategies.length,
      after: mergedStrategies.length
    });
  } else {
    console.log('[PLANNING_STRATEGY_MERGED]', {
      before: strategies.length,
      after: mergedStrategies.length
    });
  }

  const initializationStrategies = [];
  for (const strategy of mergedStrategies) {
    const init = buildInitializationFromStrategy(strategy);
    if (init) {
      initializationStrategies.push(init);
      console.log('[INITIALIZATION_STRATEGY_CREATED]', {
        strategy: init.strategy,
        category: init.category,
        sourceConstraints: init.sourceConstraints
      });
    }
  }

  return {
    objective: normalizeText(objective || projectIntent?.objective || projectIntent?.prompt || ''),
    source: OBJECTIVE_TEXT_SOURCE,
    constraints: unique(constraints.map(constraint => constraint.id || constraint.value || constraint.type)),
    strategies: mergedStrategies,
    initializationStrategies: mergeCompatibleStrategies(initializationStrategies)
  };
}

export function validateStrategyGraph(graph = {}) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const errors = [];

  for (const node of nodes) {
    if (!node || typeof node !== 'object') {
      errors.push('Strategy node must be an object');
      continue;
    }
    if (!Array.isArray(node.sourceConstraints) || node.sourceConstraints.length === 0) {
      errors.push(`Strategy ${node.id || node.strategy || 'unknown'} must reference source constraints`);
    }
    if (normalizeText(node.implementationIndependent).toLowerCase() === 'false') {
      errors.push(`Strategy ${node.id || node.strategy || 'unknown'} must remain implementation independent`);
    }
    if (node.executionEligible !== false) {
      errors.push(`Strategy ${node.id || node.strategy || 'unknown'} must never be execution eligible`);
    }
    const serialized = JSON.stringify(node);
    if (containsPathLikeText(serialized)) {
      errors.push(`Strategy ${node.id || node.strategy || 'unknown'} contains a file path`);
    }
    if (containsCommandLikeText(serialized)) {
      errors.push(`Strategy ${node.id || node.strategy || 'unknown'} contains a command`);
    }
    if (containsExecutionLikeText(serialized)) {
      errors.push(`Strategy ${node.id || node.strategy || 'unknown'} contains execution artifacts`);
    }
    if (containsFrameworkFileText(serialized)) {
      errors.push(`Strategy ${node.id || node.strategy || 'unknown'} contains a framework file`);
    }
    if (!STRATEGY_CATEGORIES.has(normalizeText(node.category).toUpperCase())) {
      errors.push(`Strategy ${node.id || node.strategy || 'unknown'} has unsupported category`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function buildPlanningStrategyGraph({
  constraintGraph = {},
  objective = '',
  projectIntent = {}
} = {}) {
  console.log('[CONSTRAINT_RESOLUTION_START]', {
    objectiveLength: normalizeText(objective || projectIntent?.objective || projectIntent?.prompt || '').length,
    constraintCount: Array.isArray(constraintGraph?.constraints) ? constraintGraph.constraints.length : 0
  });

  const resolved = derivePlanningStrategies({
    constraintGraph,
    objective,
    projectIntent
  });

  const nodes = [
    ...(Array.isArray(resolved.strategies) ? resolved.strategies : []),
    ...(Array.isArray(resolved.initializationStrategies) ? resolved.initializationStrategies : [])
  ];
  const edges = [];
  for (const node of nodes) {
    for (const dependency of Array.isArray(node.dependencies) ? node.dependencies : []) {
      edges.push({ from: dependency, to: node.id, relation: 'depends_on' });
    }
  }

  const graph = {
    objective: resolved.objective,
    source: OBJECTIVE_TEXT_SOURCE,
    constraintGraph,
    strategies: Array.isArray(resolved.strategies) ? resolved.strategies : [],
    initializationStrategies: Array.isArray(resolved.initializationStrategies) ? resolved.initializationStrategies : [],
    nodes,
    edges
  };

  console.log('[PLANNING_STRATEGY_GRAPH_CREATED]', {
    strategyCount: graph.strategies.length,
    initializationStrategyCount: graph.initializationStrategies.length,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length
  });

  const validation = validateStrategyGraph(graph);
  console.log(validation.valid ? '[PLANNING_STRATEGY_GRAPH_VALID]' : '[PLANNING_STRATEGY_GRAPH_INVALID]', {
    nodeCount: graph.nodes.length,
    errorCount: validation.errors.length
  });
  console.log('[PLANNING_STRATEGY_GRAPH_COMPLETE]', {
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    valid: validation.valid
  });
  console.log('[CONSTRAINT_RESOLUTION_COMPLETE]', {
    strategyCount: graph.strategies.length,
    initializationStrategyCount: graph.initializationStrategies.length,
    valid: validation.valid
  });

  return {
    ...graph,
    validation
  };
}

export function resolveConstraints(options = {}) {
  return buildPlanningStrategyGraph(options);
}
