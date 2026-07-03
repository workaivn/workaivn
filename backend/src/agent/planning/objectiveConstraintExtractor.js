const OBJECTIVE_TEXT_SOURCE = 'OBJECTIVE_TEXT';

const ALLOWED_CATEGORIES = new Set([
  'TECHNOLOGY',
  'FRAMEWORK',
  'LANGUAGE',
  'UI',
  'UX',
  'DESIGN',
  'ACCESSIBILITY',
  'PERFORMANCE',
  'QUALITY',
  'SECURITY',
  'ARCHITECTURE',
  'DELIVERABLE',
  'EXECUTION',
  'STYLE',
  'CONTENT'
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

function containsWorkspaceEvidence(text = '') {
  return /\b(?:workspace|projectscan|verifiedfiles|verifiedcommands|entryfiles|buildcommands|runcommands|bootstrapprofile|knowledgegraph|frameworkcandidates|recommendationcandidates)\b/i.test(String(text || ''));
}

function clampConfidence(value, fallback = 0.5) {
  if (!Number.isFinite(Number(value))) return fallback;
  return Math.max(0, Math.min(1, Number(value)));
}

function normalizeCategory(value = '') {
  const category = normalizeText(value).toUpperCase();
  return ALLOWED_CATEGORIES.has(category) ? category : 'CONTENT';
}

function buildConstraintNode({
  category,
  type,
  value,
  required = true,
  confidence = 0.8,
  evidence = [],
  source = OBJECTIVE_TEXT_SOURCE,
  metadata = {}
} = {}, index = 0) {
  const normalizedValue = normalizeText(value);
  return {
    id: `constraint:${slugify(category || 'content')}:${slugify(type || normalizedValue || `item-${index + 1}`)}`,
    category: normalizeCategory(category),
    type: normalizeText(type || normalizedValue || 'Constraint'),
    value: normalizedValue,
    required: required !== false,
    confidence: clampConfidence(confidence, 0.8),
    source: normalizeText(source).toUpperCase() || OBJECTIVE_TEXT_SOURCE,
    evidence: unique(evidence),
    metadata: metadata && typeof metadata === 'object' ? { ...metadata } : {}
  };
}

function collectMatches(text = '', patterns = [], { category, required = true, confidence = 0.8, source = OBJECTIVE_TEXT_SOURCE } = {}) {
  const lowerText = lower(text);
  const constraints = [];
  for (const entry of patterns) {
    if (!entry?.pattern?.test(lowerText)) continue;
    constraints.push(buildConstraintNode({
      category: entry.category || category,
      type: entry.type || entry.value,
      value: entry.value,
      required: entry.required ?? required,
      confidence: entry.confidence ?? confidence,
      source,
      evidence: [
        `objective:${String(text || '').slice(0, 120)}`,
        ...(Array.isArray(entry.evidence) ? entry.evidence : [])
      ],
      metadata: entry.metadata || {}
    }, constraints.length));
  }
  return uniqueConstraints(constraints);
}

function uniqueConstraints(constraints = []) {
  const seen = new Set();
  const output = [];
  for (const constraint of Array.isArray(constraints) ? constraints : []) {
    if (!constraint || typeof constraint !== 'object') continue;
    const key = [
      normalizeText(constraint.category).toUpperCase(),
      normalizeText(constraint.type).toUpperCase(),
      normalizeText(constraint.value).toUpperCase()
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(constraint);
  }
  return output;
}

export function normalizeConstraint(constraint = {}, index = 0) {
  return buildConstraintNode(constraint, index);
}

export function extractTechnologyConstraints(objective = '') {
  return collectMatches(objective, [
    { pattern: /\breact\b/i, category: 'FRAMEWORK', type: 'Framework', value: 'React', evidence: ['objective:react'] },
    { pattern: /\bvue\b/i, category: 'FRAMEWORK', type: 'Framework', value: 'Vue', evidence: ['objective:vue'] },
    { pattern: /\bnext\.?js\b/i, category: 'FRAMEWORK', type: 'Framework', value: 'Next.js', evidence: ['objective:next.js'] },
    { pattern: /\bvite\b/i, category: 'TECHNOLOGY', type: 'Build Tool', value: 'Vite', evidence: ['objective:vite'] },
    { pattern: /\btypescript\b/i, category: 'LANGUAGE', type: 'Language', value: 'TypeScript', evidence: ['objective:typescript'] },
    { pattern: /\bjavascript\b/i, category: 'LANGUAGE', type: 'Language', value: 'JavaScript', evidence: ['objective:javascript'] },
    { pattern: /\btailwind(css)?\b/i, category: 'UI', type: 'UI Framework', value: 'TailwindCSS', evidence: ['objective:tailwindcss'] },
    { pattern: /\bframer motion\b/i, category: 'STYLE', type: 'Animation', value: 'Framer Motion', evidence: ['objective:framer motion'] },
    { pattern: /\bflutter\b/i, category: 'FRAMEWORK', type: 'Framework', value: 'Flutter', evidence: ['objective:flutter'] },
    { pattern: /\blaravel\b/i, category: 'FRAMEWORK', type: 'Framework', value: 'Laravel', evidence: ['objective:laravel'] },
    { pattern: /\bnode\.?js\b/i, category: 'TECHNOLOGY', type: 'Runtime', value: 'Node.js', evidence: ['objective:node.js'] },
    { pattern: /\bpython\b/i, category: 'LANGUAGE', type: 'Language', value: 'Python', evidence: ['objective:python'] }
  ], { category: 'TECHNOLOGY' });
}

export function extractDesignConstraints(objective = '') {
  return collectMatches(objective, [
    { pattern: /\bdark mode\b/i, category: 'DESIGN', type: 'Theme', value: 'Dark Mode', evidence: ['objective:dark mode'] },
    { pattern: /\bresponsive\b/i, category: 'UX', type: 'Responsive', value: 'Responsive', evidence: ['objective:responsive'] },
    { pattern: /\bmobile friendly\b/i, category: 'UX', type: 'Responsive', value: 'Mobile Friendly', evidence: ['objective:mobile friendly'] },
    { pattern: /\bmodern ui\b/i, category: 'UI', type: 'Visual Design', value: 'Modern UI', evidence: ['objective:modern ui'] },
    { pattern: /\bminimal(ist)?\b/i, category: 'DESIGN', type: 'Visual Design', value: 'Minimal UI', evidence: ['objective:minimal ui'] },
    { pattern: /\banimation(s)?\b/i, category: 'STYLE', type: 'Animation', value: 'Animation', evidence: ['objective:animation'] },
    { pattern: /\bframer motion\b/i, category: 'STYLE', type: 'Animation', value: 'Framer Motion', evidence: ['objective:framer motion'] }
  ], { category: 'DESIGN' });
}

export function extractArchitectureConstraints(objective = '') {
  return collectMatches(objective, [
    { pattern: /\breusable components\b/i, category: 'ARCHITECTURE', type: 'Component Reuse', value: 'Reusable Components', evidence: ['objective:reusable components'] },
    { pattern: /\bshared layout\b/i, category: 'ARCHITECTURE', type: 'Layout', value: 'Shared Layout', evidence: ['objective:shared layout'] },
    { pattern: /\bcomponent-based\b/i, category: 'ARCHITECTURE', type: 'Component Model', value: 'Component-based Architecture', evidence: ['objective:component-based'] },
    { pattern: /\bmodular\b/i, category: 'ARCHITECTURE', type: 'Structure', value: 'Modular Structure', evidence: ['objective:modular'] },
    { pattern: /\bapi[- ]first\b/i, category: 'ARCHITECTURE', type: 'Integration', value: 'API-first Architecture', evidence: ['objective:api-first'] },
    { pattern: /\bmvc\b/i, category: 'ARCHITECTURE', type: 'Pattern', value: 'MVC', evidence: ['objective:mvc'] }
  ], { category: 'ARCHITECTURE' });
}

export function extractQualityConstraints(objective = '') {
  return collectMatches(objective, [
    { pattern: /\bproduction ready\b/i, category: 'QUALITY', type: 'Quality', value: 'Production Ready', evidence: ['objective:production ready'] },
    { pattern: /\blaunch ready\b/i, category: 'QUALITY', type: 'Quality', value: 'Launch Ready', evidence: ['objective:launch ready'] },
    { pattern: /\bno todo\b/i, category: 'QUALITY', type: 'Quality', value: 'No TODO', evidence: ['objective:no todo'] },
    { pattern: /\bno placeholder\b/i, category: 'QUALITY', type: 'Quality', value: 'No Placeholder', evidence: ['objective:no placeholder'] },
    { pattern: /\bcode quality\b/i, category: 'QUALITY', type: 'Quality', value: 'Code Quality', evidence: ['objective:code quality'] },
    { pattern: /\bmaintainability\b/i, category: 'QUALITY', type: 'Quality', value: 'Maintainability', evidence: ['objective:maintainability'] },
    { pattern: /\bscalability\b/i, category: 'QUALITY', type: 'Quality', value: 'Scalability', evidence: ['objective:scalability'] },
    { pattern: /\bperformance\b/i, category: 'PERFORMANCE', type: 'Performance', value: 'Performance', evidence: ['objective:performance'] },
    { pattern: /\bsecurity\b/i, category: 'SECURITY', type: 'Security', value: 'Security', evidence: ['objective:security'] },
    { pattern: /\baccessibility\b|\ba11y\b/i, category: 'ACCESSIBILITY', type: 'Accessibility', value: 'Accessibility', evidence: ['objective:accessibility'] },
    { pattern: /\bseo\b/i, category: 'QUALITY', type: 'SEO', value: 'SEO', evidence: ['objective:seo'] }
  ], { category: 'QUALITY' });
}

export function extractExecutionConstraints(objective = '') {
  return collectMatches(objective, [
    { pattern: /\bno explanations\b/i, category: 'EXECUTION', type: 'Output Control', value: 'No Explanations', evidence: ['objective:no explanations'] },
    { pattern: /\bonly code\b/i, category: 'EXECUTION', type: 'Output Control', value: 'Only Code', evidence: ['objective:only code'] },
    { pattern: /\bgenerate only\b/i, category: 'EXECUTION', type: 'Scope Control', value: 'Generate Only', evidence: ['objective:generate only'] },
    { pattern: /\bdo not regenerate\b/i, category: 'EXECUTION', type: 'Scope Control', value: 'Do Not Regenerate', evidence: ['objective:do not regenerate'] },
    { pattern: /\brun tests?\b/i, category: 'EXECUTION', type: 'Validation', value: 'Run Tests', evidence: ['objective:run tests'] },
    { pattern: /\bship\b|\bdeploy\b/i, category: 'EXECUTION', type: 'Delivery', value: 'Ship Ready', evidence: ['objective:ship'] }
  ], { category: 'EXECUTION' });
}

export function extractExplicitDeliverables(objective = '') {
  return collectMatches(objective, [
    { pattern: /\blanding page\b/i, category: 'DELIVERABLE', type: 'Deliverable', value: 'Landing Page', evidence: ['objective:landing page'] },
    { pattern: /\bdashboard\b/i, category: 'DELIVERABLE', type: 'Deliverable', value: 'Dashboard', evidence: ['objective:dashboard'] },
    { pattern: /\badmin panel\b/i, category: 'DELIVERABLE', type: 'Deliverable', value: 'Admin Panel', evidence: ['objective:admin panel'] },
    { pattern: /\bapi\b|\bbackend\b|\bserver\b/i, category: 'DELIVERABLE', type: 'Deliverable', value: 'API', evidence: ['objective:api'] },
    { pattern: /\bmobile app\b/i, category: 'DELIVERABLE', type: 'Deliverable', value: 'Mobile App', evidence: ['objective:mobile app'] },
    { pattern: /\bdocumentation\b|\bdocs?\b/i, category: 'DELIVERABLE', type: 'Deliverable', value: 'Documentation', evidence: ['objective:documentation'] },
    { pattern: /\btests?\b/i, category: 'DELIVERABLE', type: 'Deliverable', value: 'Tests', evidence: ['objective:tests'] }
  ], { category: 'DELIVERABLE' });
}

export function extractObjectiveConstraints(objective = '') {
  const text = normalizeText(objective);
  const constraints = uniqueConstraints([
    ...extractTechnologyConstraints(text),
    ...extractDesignConstraints(text),
    ...extractArchitectureConstraints(text),
    ...extractQualityConstraints(text),
    ...extractExecutionConstraints(text),
    ...extractExplicitDeliverables(text)
  ]);
  return constraints.map((constraint, index) => normalizeConstraint(constraint, index));
}

export function validateConstraint(constraintOrGraph = {}) {
  const constraints = Array.isArray(constraintOrGraph?.constraints)
    ? constraintOrGraph.constraints
    : (Array.isArray(constraintOrGraph?.nodes) ? constraintOrGraph.nodes : [constraintOrGraph]);
  const errors = [];

  for (const constraint of constraints) {
    if (!constraint || typeof constraint !== 'object') {
      errors.push('Constraint must be an object');
      continue;
    }
    const source = normalizeText(constraint.source).toUpperCase();
    if (source !== OBJECTIVE_TEXT_SOURCE) {
      errors.push(`Constraint ${constraint.id || constraint.value || 'unknown'} must originate from objective text`);
    }
    const serialized = JSON.stringify(constraint);
    if (containsPathLikeText(serialized)) {
      errors.push(`Constraint ${constraint.id || constraint.value || 'unknown'} contains a file path`);
    }
    if (containsCommandLikeText(serialized)) {
      errors.push(`Constraint ${constraint.id || constraint.value || 'unknown'} contains a command`);
    }
    if (containsWorkspaceEvidence(serialized)) {
      errors.push(`Constraint ${constraint.id || constraint.value || 'unknown'} contains workspace evidence`);
    }
    if (!ALLOWED_CATEGORIES.has(normalizeText(constraint.category).toUpperCase())) {
      errors.push(`Constraint ${constraint.id || constraint.value || 'unknown'} has unsupported category`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function buildObjectiveConstraintGraph({
  objective = '',
  projectIntent = {}
} = {}) {
  const text = normalizeText(objective || projectIntent?.objective || projectIntent?.prompt || '');
  console.log('[OBJECTIVE_CONSTRAINT_EXTRACTION_START]', {
    objectiveLength: text.length,
    source: OBJECTIVE_TEXT_SOURCE
  });

  const constraints = extractObjectiveConstraints(text);
  console.log('[OBJECTIVE_CONSTRAINT_EXTRACTED]', {
    count: constraints.length,
    values: constraints.map(constraint => constraint.value)
  });

  for (const constraint of constraints) {
    console.log('[CONSTRAINT_SOURCE_VERIFIED]', {
      id: constraint.id,
      category: constraint.category,
      type: constraint.type,
      value: constraint.value,
      source: constraint.source
    });
  }

  const graph = {
    objective: text,
    source: OBJECTIVE_TEXT_SOURCE,
    constraints,
    nodes: constraints,
    edges: []
  };

  console.log('[OBJECTIVE_CONSTRAINT_GRAPH_CREATED]', {
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length
  });

  const validation = validateConstraint(graph);
  if (!validation.valid) {
    for (const error of validation.errors) {
      console.log('[CONSTRAINT_REJECTED]', { reason: error });
    }
  }

  console.log('[OBJECTIVE_CONSTRAINT_GRAPH_COMPLETE]', {
    nodeCount: graph.nodes.length,
    valid: validation.valid,
    errorCount: validation.errors.length
  });

  return {
    ...graph,
    validation
  };
}
