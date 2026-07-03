import { buildObjectiveConstraintGraph, extractObjectiveConstraints, normalizeConstraint } from './objectiveConstraintExtractor.js';

const ALLOWED_CATEGORIES = new Set([
  'PRODUCT',
  'SECTION',
  'FEATURE',
  'UX',
  'UI',
  'ACCESSIBILITY',
  'PERFORMANCE',
  'QUALITY',
  'SECURITY',
  'DATA',
  'DEPLOYMENT',
  'TESTING',
  'DOCUMENTATION',
  'WORKFLOW',
  'ANIMATION',
  'CONTENT'
]);

const OBJECTIVE_TEXT_SOURCE = 'OBJECTIVE_TEXT';

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
  return /\b(?:npm|pnpm|yarn|bun|flutter\s+run|flutter\s+test|composer|php\s+-S|dotnet\s+build|node\s+--check|pytest|vitest|jest)\b/i.test(String(text || ''));
}

function containsWorkspaceEvidence(text = '') {
  return /\b(?:workspace|projectscan|verifiedfiles|verifiedcommands|entryfiles|buildcommands|runcommands|bootstrapprofile|knowledgegraph)\b/i.test(String(text || ''));
}

function clampConfidence(value, fallback = 0.5) {
  if (!Number.isFinite(Number(value))) return fallback;
  return Math.max(0, Math.min(1, Number(value)));
}

export function normalizeSemanticNode(node = {}, index = 0) {
  const category = normalizeText(node.category).toUpperCase();
  const capability = normalizeText(node.capability).toUpperCase();
  const description = normalizeText(node.description);
  const required = node.required !== false;
  const optional = node.optional === true;
  const dependencies = unique(node.dependencies || []);
  const evidence = unique(node.evidence || []);
  const source = normalizeText(node.source).toUpperCase() || OBJECTIVE_TEXT_SOURCE;

  return {
    id: normalizeText(node.id) || `semantic:${slugify(category || capability || `node-${index + 1}`)}`,
    category: ALLOWED_CATEGORIES.has(category) ? category : 'WORKFLOW',
    capability: capability || slugify(description).toUpperCase() || `SEMANTIC_${index + 1}`,
    description,
    required,
    optional,
    dependencies,
    priority: Number.isFinite(Number(node.priority)) ? Number(node.priority) : 50,
    confidence: clampConfidence(node.confidence, 0.5),
    evidence,
    source,
    metadata: node.metadata && typeof node.metadata === 'object' ? { ...node.metadata } : {}
  };
}

function inferProductDescriptor(objective = '') {
  const text = lower(objective);
  if (/\b(?:landing page|homepage|marketing site|saas landing|launch page)\b/.test(text)) {
    return { label: 'Landing Page', capability: 'APPLICATION_ENTRY', category: 'PRODUCT' };
  }
  if (/\b(?:admin panel)\b/.test(text)) {
    return { label: 'Admin Panel', capability: 'DASHBOARD', category: 'PRODUCT' };
  }
  if (/\b(?:dashboard|admin panel|admin dashboard|analytics portal|metrics portal)\b/.test(text)) {
    return { label: 'Dashboard', capability: 'DASHBOARD', category: 'PRODUCT' };
  }
  if (/\b(?:rest api|api\b|backend|server)\b/.test(text)) {
    return { label: 'REST API', capability: 'API_LAYER', category: 'PRODUCT' };
  }
  if (/\b(?:expense tracker|finance tracker|budget tracker)\b/.test(text)) {
    return { label: 'Expense Tracker', capability: 'DATA', category: 'PRODUCT' };
  }
  if (/\b(?:authentication dashboard|auth dashboard)\b/.test(text)) {
    return { label: 'Authentication Dashboard', capability: 'DASHBOARD', category: 'PRODUCT' };
  }
  if (/\bflutter\b/.test(text)) {
    return { label: 'Mobile App', capability: 'DATA', category: 'PRODUCT' };
  }
  return { label: 'Product Goal', capability: 'APPLICATION_ENTRY', category: 'PRODUCT' };
}

function collectMatches(text, patterns = []) {
  const lowerText = lower(text);
  const output = [];
  for (const entry of patterns) {
    if (entry.pattern.test(lowerText)) output.push(entry.value);
  }
  return unique(output);
}

export function extractUserIntent(objective = '') {
  const text = lower(objective);
  if (/\b(build|create|generate|implement|launch)\b/.test(text)) return 'BUILD';
  if (/\b(fix|repair|resolve|hotfix)\b/.test(text)) return 'FIX';
  if (/\b(refactor|restructure|simplify)\b/.test(text)) return 'REFACTOR';
  if (/\b(document|docs?|readme)\b/.test(text)) return 'DOCUMENT';
  return 'PLAN';
}

export function extractCapabilities(objective = '') {
  const text = lower(objective);
  const capabilityPatterns = [
    { pattern: /\bnavigation\b|\bnav\b|\bmenu\b/, value: 'Navigation' },
    { pattern: /\bhero\b/, value: 'Hero' },
    { pattern: /\bfeature(s)?\b/, value: 'Features' },
    { pattern: /\bpricing\b/, value: 'Pricing' },
    { pattern: /\btestimonial(s)?\b/, value: 'Testimonials' },
    { pattern: /\bfaq\b/, value: 'FAQ' },
    { pattern: /\bcta\b|\bcall to action\b/, value: 'CTA' },
    { pattern: /\bfooter\b/, value: 'Footer' },
    { pattern: /\bdashboard\b/, value: 'Dashboard' },
    { pattern: /\bauthentication\b|\bauth\b|\blogin\b|\bsign in\b/, value: 'Authentication' },
    { pattern: /\brole management\b/, value: 'Role Management' },
    { pattern: /\banalytics\b|\bmetrics\b/, value: 'Analytics' },
    { pattern: /\bchart(s)?\b/, value: 'Charts' },
    { pattern: /\bsecurity\b/, value: 'Security' },
    { pattern: /\bresponsive\b/, value: 'Responsive' },
    { pattern: /\baccessibility\b|\ba11y\b/, value: 'Accessibility' },
    { pattern: /\bperformance\b/, value: 'Performance' },
    { pattern: /\bseo\b/, value: 'SEO' },
    { pattern: /\bapi\b|\bbackend\b|\bserver\b/, value: 'API' },
    { pattern: /\bendpoint(s)?\b/, value: 'Endpoints' },
    { pattern: /\bvalidation\b/, value: 'Validation' },
    { pattern: /\bdocumentation\b|\bdocs?\b/, value: 'Documentation' },
    { pattern: /\btesting\b|\btests?\b/, value: 'Testing' },
    { pattern: /\berror handling\b|\berrors?\b/, value: 'Error Handling' },
    { pattern: /\breusable components\b/, value: 'Reusable Components' },
    { pattern: /\bshared layout\b/, value: 'Shared Layout' },
    { pattern: /\bbuttons?\b/, value: 'Buttons' },
    { pattern: /\bcards?\b/, value: 'Cards' },
    { pattern: /\bdialogs?\b/, value: 'Dialogs' },
    { pattern: /\btables?\b/, value: 'Tables' },
    { pattern: /\bforms?\b/, value: 'Forms' },
    { pattern: /\boffline support\b/, value: 'Offline Support' },
    { pattern: /\bmobile ux\b|\bmobile experience\b/, value: 'Mobile UX' },
    { pattern: /\btransactions\b/, value: 'Transactions' },
    { pattern: /\breports?\b/, value: 'Reports' },
    { pattern: /\bexpense tracking\b|\bexpense tracker\b/, value: 'Expense Tracking' },
    { pattern: /\bproduction ready\b/, value: 'Production Ready' },
    { pattern: /\blaunch ready\b/, value: 'Launch Ready' },
    { pattern: /\bmarketing copy\b/, value: 'Marketing Copy' },
    { pattern: /\bno placeholder\b/, value: 'No Placeholder' },
    { pattern: /\bno todo\b/, value: 'No TODO' }
  ];
  return collectMatches(text, capabilityPatterns);
}

export function extractDeliverables(objective = '') {
  const text = lower(objective);
  const deliverablePatterns = [
    { pattern: /\breusable components\b/, value: 'Reusable Components' },
    { pattern: /\bshared layout\b/, value: 'Shared Layout' },
    { pattern: /\bbuttons?\b/, value: 'Buttons' },
    { pattern: /\bcards?\b/, value: 'Cards' },
    { pattern: /\bdialogs?\b/, value: 'Dialogs' },
    { pattern: /\btables?\b/, value: 'Tables' },
    { pattern: /\bforms?\b/, value: 'Forms' },
    { pattern: /\blogin\b/, value: 'Login Flow' },
    { pattern: /\bsession\b/, value: 'Session Flow' },
    { pattern: /\bauthorization\b/, value: 'Authorization Flow' },
    { pattern: /\bcharts?\b/, value: 'Charts' },
    { pattern: /\banalytics\b/, value: 'Analytics View' },
    { pattern: /\btransactions\b/, value: 'Transactions' },
    { pattern: /\breports?\b/, value: 'Reports' }
  ];
  return collectMatches(text, deliverablePatterns);
}

export function extractConstraints(objective = '') {
  return extractObjectiveConstraints(objective).map(constraint => constraint.value);
}

export function extractQualityRequirements(objective = '') {
  const text = lower(objective);
  const qualityPatterns = [
    { pattern: /\baccessibility\b|\ba11y\b/, value: 'Accessibility' },
    { pattern: /\bperformance\b/, value: 'Performance' },
    { pattern: /\bseo\b/, value: 'SEO' },
    { pattern: /\bproduction ready\b/, value: 'Production Ready' },
    { pattern: /\bcode quality\b/, value: 'Code Quality' },
    { pattern: /\bmaintainability\b/, value: 'Maintainability' },
    { pattern: /\bscalability\b/, value: 'Scalability' },
    { pattern: /\bsecurity\b/, value: 'Security' },
    { pattern: /\blaunch ready\b/, value: 'Launch Ready' },
    { pattern: /\bno placeholder\b/, value: 'No Placeholder' },
    { pattern: /\bno todo\b/, value: 'No TODO' }
  ];
  return collectMatches(text, qualityPatterns);
}

export function extractNonFunctionalRequirements(objective = '') {
  const text = lower(objective);
  const nonFunctionalPatterns = [
    { pattern: /\baccessibility\b|\ba11y\b/, value: 'Accessibility' },
    { pattern: /\bseo\b/, value: 'SEO' },
    { pattern: /\bperformance\b/, value: 'Performance' },
    { pattern: /\bcode quality\b/, value: 'Code Quality' },
    { pattern: /\banimation\b|\bframer motion\b/, value: 'Animation' },
    { pattern: /\bresponsive\b/, value: 'Responsiveness' },
    { pattern: /\bsecurity\b/, value: 'Security' },
    { pattern: /\bmaintainability\b/, value: 'Maintainability' },
    { pattern: /\bscalability\b/, value: 'Scalability' }
  ];
  return collectMatches(text, nonFunctionalPatterns);
}

function buildNode(category, capability, description, {
  required = true,
  optional = false,
  dependencies = [],
  priority = 50,
  confidence = 0.7,
  evidence = [],
  source = OBJECTIVE_TEXT_SOURCE,
  metadata = {}
} = {}) {
  const normalizedCategory = normalizeText(category).toUpperCase();
  const normalizedCapability = normalizeText(capability);
  const normalizedDescription = normalizeText(description);
  return normalizeSemanticNode({
    id: `semantic:${slugify(normalizedCategory)}:${slugify(normalizedCapability || normalizedDescription)}`,
    category: normalizedCategory,
    capability: normalizedCapability,
    description: normalizedDescription,
    required,
    optional,
    dependencies,
    priority,
    confidence,
    evidence,
    source,
    metadata
  });
}

function addNode(nodes, node, byKey) {
  if (!node) return null;
  const normalized = normalizeSemanticNode(node, nodes.length);
  if (byKey.has(normalized.id)) return byKey.get(normalized.id);
  nodes.push(normalized);
  byKey.set(normalized.id, normalized);
  return normalized;
}

function connect(nodesById, fromId, toId, edges) {
  if (!fromId || !toId || fromId === toId) return;
  if (!nodesById.has(fromId) || !nodesById.has(toId)) return;
  edges.push({ from: fromId, to: toId, relation: 'depends_on' });
  console.log('[SEMANTIC_DEPENDENCY_CREATED]', { from: fromId, to: toId });
}

function mergeSemanticGraphWithConstraints(semanticGoalGraph = {}, constraintGraph = {}) {
  const goalNodes = Array.isArray(semanticGoalGraph?.nodes) ? semanticGoalGraph.nodes.map(node => normalizeSemanticNode(node)) : [];
  const constraintNodes = Array.isArray(constraintGraph?.constraints) ? constraintGraph.constraints.map((constraint, index) => normalizeConstraint(constraint, index)) : [];
  const mergedNodes = [
    ...goalNodes.map(node => ({ ...node, graphLayer: 'GOAL' })),
    ...constraintNodes.map(node => ({ ...node, graphLayer: 'CONSTRAINT' }))
  ];
  const mergedEdges = [
    ...(Array.isArray(semanticGoalGraph?.edges) ? semanticGoalGraph.edges : []),
    ...(Array.isArray(constraintGraph?.edges) ? constraintGraph.edges : [])
  ];

  console.log('[SEMANTIC_GRAPH_MERGED]', {
    goalNodeCount: goalNodes.length,
    constraintNodeCount: constraintNodes.length,
    mergedNodeCount: mergedNodes.length,
    mergedEdgeCount: mergedEdges.length
  });

  return {
    nodes: mergedNodes,
    edges: mergedEdges,
    goalNodes,
    constraintNodes,
    source: 'merged_semantic_graph'
  };
}

function buildCapabilityNodes(objective = '', root = null, nodes = [], byId = new Map(), edges = []) {
  const capabilities = extractCapabilities(objective);
  const deliverables = extractDeliverables(objective);
  const qualityRequirements = extractQualityRequirements(objective);
  const nonFunctionalRequirements = extractNonFunctionalRequirements(objective);

  const isLandingLike = /\b(?:landing page|homepage|marketing site|saas)\b/i.test(objective);
  const isDashboardLike = /\b(?:dashboard|admin panel|admin dashboard|analytics portal|metrics portal)\b/i.test(objective);
  const isApiLike = /\b(?:rest api|api\b|backend|server)\b/i.test(objective);
  const isExpenseLike = /\b(?:expense tracker|finance tracker|budget tracker)\b/i.test(objective);
  const isAdminPanel = /\b(?:admin panel|admin dashboard)\b/i.test(objective);

  const sectionDependencies = root ? [root.id] : [];

  const nodeGroups = [];

  if (root) {
    nodeGroups.push(root);
  }

  if (isLandingLike) {
    nodeGroups.push(
      buildNode('SECTION', 'Navigation', 'Navigation', { required: true, dependencies: sectionDependencies, priority: 98, confidence: 0.92, evidence: [`objective:${objective.slice(0, 120)}`] }),
      buildNode('SECTION', 'Hero', 'Hero', { required: true, dependencies: sectionDependencies, priority: 97, confidence: 0.92, evidence: [`objective:${objective.slice(0, 120)}`] }),
      buildNode('SECTION', 'Features', 'Features', { required: true, dependencies: sectionDependencies, priority: 96, confidence: 0.92, evidence: [`objective:${objective.slice(0, 120)}`] }),
      buildNode('SECTION', 'Pricing', 'Pricing', { required: true, dependencies: sectionDependencies, priority: 95, confidence: 0.92, evidence: [`objective:${objective.slice(0, 120)}`] }),
      buildNode('SECTION', 'Testimonials', 'Testimonials', { required: true, dependencies: sectionDependencies, priority: 94, confidence: 0.9, evidence: [`objective:${objective.slice(0, 120)}`] }),
      buildNode('SECTION', 'FAQ', 'FAQ', { required: true, dependencies: sectionDependencies, priority: 93, confidence: 0.9, evidence: [`objective:${objective.slice(0, 120)}`] }),
      buildNode('SECTION', 'CTA', 'CTA', { required: true, dependencies: sectionDependencies, priority: 92, confidence: 0.92, evidence: [`objective:${objective.slice(0, 120)}`] }),
      buildNode('SECTION', 'Footer', 'Footer', { required: true, dependencies: sectionDependencies, priority: 91, confidence: 0.92, evidence: [`objective:${objective.slice(0, 120)}`] }),
      buildNode('UX', 'Responsive', 'Responsive', { required: true, dependencies: sectionDependencies, priority: 90, confidence: 0.9, evidence: [`objective:${objective.slice(0, 120)}`] }),
      buildNode('ACCESSIBILITY', 'Accessibility', 'Accessibility', { required: true, dependencies: sectionDependencies, priority: 89, confidence: 0.9, evidence: [`objective:${objective.slice(0, 120)}`] }),
      buildNode('PERFORMANCE', 'Performance', 'Performance', { required: true, dependencies: sectionDependencies, priority: 88, confidence: 0.88, evidence: [`objective:${objective.slice(0, 120)}`] }),
      buildNode('QUALITY', 'SEO', 'SEO', { required: true, dependencies: sectionDependencies, priority: 87, confidence: 0.88, evidence: [`objective:${objective.slice(0, 120)}`] })
    );
  } else if (isDashboardLike) {
    nodeGroups.push(
      buildNode('FEATURE', 'Dashboard', 'Dashboard', { required: true, dependencies: sectionDependencies, priority: 98, confidence: 0.92, evidence: [`objective:${objective.slice(0, 120)}`] }),
      buildNode('FEATURE', 'Authentication', 'Authentication', { required: true, dependencies: sectionDependencies, priority: 97, confidence: 0.91, evidence: [`objective:${objective.slice(0, 120)}`] }),
      buildNode('FEATURE', 'Role Management', 'Role Management', { required: true, dependencies: sectionDependencies, priority: 96, confidence: 0.9, evidence: [`objective:${objective.slice(0, 120)}`] }),
      buildNode('FEATURE', 'Analytics', 'Analytics', { required: true, dependencies: sectionDependencies, priority: 95, confidence: 0.9, evidence: [`objective:${objective.slice(0, 120)}`] }),
      buildNode('FEATURE', 'Charts', 'Charts', { required: true, dependencies: sectionDependencies, priority: 94, confidence: 0.9, evidence: [`objective:${objective.slice(0, 120)}`] }),
      buildNode('SECURITY', 'Security', 'Security', { required: true, dependencies: sectionDependencies, priority: 93, confidence: 0.9, evidence: [`objective:${objective.slice(0, 120)}`] }),
      buildNode('UX', 'Responsive', 'Responsive', { required: true, dependencies: sectionDependencies, priority: 92, confidence: 0.9, evidence: [`objective:${objective.slice(0, 120)}`] })
    );
    if (isAdminPanel) {
      nodeGroups.push(
        buildNode('FEATURE', 'CRUD', 'CRUD', { required: true, dependencies: sectionDependencies, priority: 91, confidence: 0.9, evidence: [`objective:${objective.slice(0, 120)}`] })
      );
    }
  } else if (isApiLike) {
    nodeGroups.push(
      buildNode('FEATURE', 'API', 'API', { required: true, dependencies: sectionDependencies, priority: 98, confidence: 0.92, evidence: [`objective:${objective.slice(0, 120)}`] }),
      buildNode('FEATURE', 'Endpoints', 'Endpoints', { required: true, dependencies: sectionDependencies, priority: 97, confidence: 0.91, evidence: [`objective:${objective.slice(0, 120)}`] }),
      buildNode('FEATURE', 'Validation', 'Validation', { required: true, dependencies: sectionDependencies, priority: 96, confidence: 0.91, evidence: [`objective:${objective.slice(0, 120)}`] }),
      buildNode('FEATURE', 'Authentication', 'Authentication', { required: true, dependencies: sectionDependencies, priority: 95, confidence: 0.9, evidence: [`objective:${objective.slice(0, 120)}`] }),
      buildNode('DOCUMENTATION', 'Documentation', 'Documentation', { required: true, dependencies: sectionDependencies, priority: 94, confidence: 0.9, evidence: [`objective:${objective.slice(0, 120)}`] }),
      buildNode('TESTING', 'Testing', 'Testing', { required: true, dependencies: sectionDependencies, priority: 93, confidence: 0.9, evidence: [`objective:${objective.slice(0, 120)}`] }),
      buildNode('QUALITY', 'Error Handling', 'Error Handling', { required: true, dependencies: sectionDependencies, priority: 92, confidence: 0.9, evidence: [`objective:${objective.slice(0, 120)}`] })
    );
  } else if (isExpenseLike) {
    nodeGroups.push(
      buildNode('FEATURE', 'Expense Tracking', 'Expense Tracking', { required: true, dependencies: sectionDependencies, priority: 98, confidence: 0.92, evidence: [`objective:${objective.slice(0, 120)}`] }),
      buildNode('FEATURE', 'Transactions', 'Transactions', { required: true, dependencies: sectionDependencies, priority: 97, confidence: 0.91, evidence: [`objective:${objective.slice(0, 120)}`] }),
      buildNode('FEATURE', 'Dashboard', 'Dashboard', { required: true, dependencies: sectionDependencies, priority: 96, confidence: 0.9, evidence: [`objective:${objective.slice(0, 120)}`] }),
      buildNode('FEATURE', 'Reports', 'Reports', { required: true, dependencies: sectionDependencies, priority: 95, confidence: 0.9, evidence: [`objective:${objective.slice(0, 120)}`] }),
      buildNode('UX', 'Offline Support', 'Offline Support', { required: true, dependencies: sectionDependencies, priority: 94, confidence: 0.9, evidence: [`objective:${objective.slice(0, 120)}`] }),
      buildNode('UX', 'Mobile UX', 'Mobile UX', { required: true, dependencies: sectionDependencies, priority: 93, confidence: 0.9, evidence: [`objective:${objective.slice(0, 120)}`] })
    );
  }

  for (const capability of capabilities) {
    const category =
      ['Navigation', 'Hero', 'Features', 'Pricing', 'Testimonials', 'FAQ', 'CTA', 'Footer'].includes(capability) ? 'SECTION'
        : (['Responsive', 'Dark Mode', 'Smooth Scroll', 'Micro Interaction', 'Mobile UX', 'Offline Support'].includes(capability) ? 'UX'
          : (['Production Ready', 'Code Quality', 'Maintainability', 'Scalability', 'Security', 'Launch Ready', 'No Placeholder', 'No TODO', 'Accessibility', 'Performance', 'SEO'].includes(capability) ? 'QUALITY'
            : (['Marketing Copy'].includes(capability) ? 'CONTENT'
              : (['Reusable Components', 'Shared Layout', 'Buttons', 'Cards', 'Dialogs', 'Tables', 'Forms'].includes(capability) ? 'FEATURE'
                : (['Authentication', 'Analytics', 'Charts', 'Role Management', 'Transactions', 'Reports', 'Error Handling', 'Endpoints', 'Validation', 'Documentation', 'Testing', 'Expense Tracking'].includes(capability) ? 'FEATURE' : 'WORKFLOW')))));
    nodeGroups.push(buildNode(category, capability, capability, {
      required: true,
      dependencies: root ? sectionDependencies : [],
      priority: category === 'QUALITY' ? 90 : 80,
      confidence: 0.84,
      evidence: [`objective:${objective.slice(0, 120)}`]
    }));
  }

  for (const deliverable of deliverables) {
    const category = ['Reusable Components', 'Shared Layout', 'Buttons', 'Cards', 'Dialogs', 'Tables', 'Forms'].includes(deliverable) ? 'FEATURE' : 'WORKFLOW';
    nodeGroups.push(buildNode(category, deliverable, deliverable, {
      required: true,
      dependencies: root ? sectionDependencies : [],
      priority: 75,
      confidence: 0.78,
      evidence: [`objective:${objective.slice(0, 120)}`]
    }));
  }

  for (const quality of qualityRequirements) {
    nodeGroups.push(buildNode('QUALITY', quality, quality, {
      required: true,
      dependencies: root ? sectionDependencies : [],
      priority: 70,
      confidence: 0.86,
      evidence: [`objective:${objective.slice(0, 120)}`]
    }));
  }

  for (const nonFunctional of nonFunctionalRequirements) {
    const category = nonFunctional === 'Security' ? 'SECURITY' : (nonFunctional === 'Animation' ? 'ANIMATION' : (nonFunctional === 'Responsiveness' ? 'UX' : 'QUALITY'));
    nodeGroups.push(buildNode(category, nonFunctional, nonFunctional, {
      required: true,
      dependencies: root ? sectionDependencies : [],
      priority: 65,
      confidence: 0.82,
      evidence: [`objective:${objective.slice(0, 120)}`]
    }));
  }

  const ordered = [];
  const seen = new Set();
  for (const node of nodeGroups) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    ordered.push(node);
  }

  for (const node of ordered) {
    byId.set(node.id, node);
  }

  const rootId = root?.id || null;
  const byLabel = new Map(ordered.map(node => [node.description, node]));
  if (rootId) {
    for (const node of ordered) {
      if (node.id === rootId) continue;
      const shouldDependOnRoot = node.category !== 'PRODUCT' && !node.dependencies.length;
      if (shouldDependOnRoot) {
        node.dependencies = unique([...(node.dependencies || []), rootId]);
        connect(byId, rootId, node.id, edges);
      }
    }
  }

  if (isLandingLike) {
    const sequence = ['Navigation', 'Hero', 'Features', 'Pricing', 'Testimonials', 'FAQ', 'CTA', 'Footer'];
    for (let index = 1; index < sequence.length; index += 1) {
      const previous = byLabel.get(sequence[index - 1]);
      const current = byLabel.get(sequence[index]);
      if (previous && current) {
        current.dependencies = unique([...(current.dependencies || []), previous.id]);
        connect(byId, previous.id, current.id, edges);
      }
    }
  }

  if (isDashboardLike) {
    const sequence = ['Dashboard', 'Authentication', 'Role Management', 'Analytics', 'Charts'];
    for (let index = 1; index < sequence.length; index += 1) {
      const previous = byLabel.get(sequence[index - 1]);
      const current = byLabel.get(sequence[index]);
      if (previous && current) {
        current.dependencies = unique([...(current.dependencies || []), previous.id]);
        connect(byId, previous.id, current.id, edges);
      }
    }
  }

  if (isApiLike) {
    const sequence = ['API', 'Endpoints', 'Validation', 'Authentication', 'Documentation', 'Testing', 'Error Handling'];
    for (let index = 1; index < sequence.length; index += 1) {
      const previous = byLabel.get(sequence[index - 1]);
      const current = byLabel.get(sequence[index]);
      if (previous && current) {
        current.dependencies = unique([...(current.dependencies || []), previous.id]);
        connect(byId, previous.id, current.id, edges);
      }
    }
  }

  if (isExpenseLike) {
    const sequence = ['Expense Tracking', 'Transactions', 'Dashboard', 'Reports'];
    for (let index = 1; index < sequence.length; index += 1) {
      const previous = byLabel.get(sequence[index - 1]);
      const current = byLabel.get(sequence[index]);
      if (previous && current) {
        current.dependencies = unique([...(current.dependencies || []), previous.id]);
        connect(byId, previous.id, current.id, edges);
      }
    }
  }

  return {
    nodes: ordered,
    edges
  };
}

export function validateSemanticGraph(graph = {}) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const nodeIds = new Set(nodes.map(node => node.id));
  const errors = [];

  for (const node of nodes) {
    if (!ALLOWED_CATEGORIES.has(normalizeText(node.category).toUpperCase())) {
      errors.push(`Unsupported category: ${node.category}`);
    }
    if (normalizeText(node.source).toUpperCase() !== OBJECTIVE_TEXT_SOURCE) {
      errors.push(`Node ${node.id} must originate from objective text`);
    }
    const serialized = JSON.stringify(node);
    if (containsPathLikeText(serialized)) {
      errors.push(`Node ${node.id} contains a file path`);
    }
    if (containsCommandLikeText(serialized)) {
      errors.push(`Node ${node.id} contains a command`);
    }
    if (containsWorkspaceEvidence(serialized)) {
      errors.push(`Node ${node.id} contains workspace evidence`);
    }
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.from)) errors.push(`Missing edge source: ${edge.from}`);
    if (!nodeIds.has(edge.to)) errors.push(`Missing edge target: ${edge.to}`);
  }

  const visiting = new Set();
  const visited = new Set();
  const walk = (id, stack = []) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      errors.push(`Semantic cycle detected: ${[...stack, id].join(' -> ')}`);
      return;
    }
    visiting.add(id);
    const node = nodes.find(entry => entry.id === id);
    if (node) {
      for (const dep of Array.isArray(node.dependencies) ? node.dependencies : []) {
        walk(dep, [...stack, id]);
      }
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const node of nodes) walk(node.id);

  return { valid: errors.length === 0, errors };
}

export function decomposeObjective({
  objective = '',
  projectIntent = {}
} = {}) {
  const text = normalizeText(objective || projectIntent?.objective || projectIntent?.prompt || '');
  console.log('[OBJECTIVE_SEMANTIC_DECOMPOSITION_START]', {
    objectiveLength: text.length,
    source: OBJECTIVE_TEXT_SOURCE
  });

  const userIntent = extractUserIntent(text);
  const capabilities = extractCapabilities(text);
  const deliverables = extractDeliverables(text);
  const constraintGraph = buildObjectiveConstraintGraph({
    objective: text,
    projectIntent
  });
  const constraints = Array.isArray(constraintGraph?.constraints)
    ? constraintGraph.constraints.map(constraint => constraint.value)
    : extractConstraints(text);
  const qualityRequirements = extractQualityRequirements(text);
  const nonFunctionalRequirements = extractNonFunctionalRequirements(text);

  console.log('[SEMANTIC_CAPABILITY_EXTRACTED]', { count: capabilities.length, values: capabilities });
  console.log('[SEMANTIC_DELIVERABLE_EXTRACTED]', { count: deliverables.length, values: deliverables });
  console.log('[SEMANTIC_CONSTRAINT_EXTRACTED]', { count: constraints.length, values: constraints });
  console.log('[SEMANTIC_NONFUNCTIONAL_EXTRACTED]', { count: nonFunctionalRequirements.length, values: nonFunctionalRequirements });

  const product = inferProductDescriptor(text);
  const nodes = [];
  const byId = new Map();
  const edges = [];

  const rootEvidence = unique([
    `objective:${text.slice(0, 120)}`,
    `userIntent:${userIntent}`
  ]);
  const root = addNode(nodes, buildNode('PRODUCT', product.capability, product.label, {
    required: true,
    dependencies: [],
    priority: 100,
    confidence: 0.92,
    evidence: rootEvidence
  }), byId);

  const graph = buildCapabilityNodes(text, root, nodes, byId, edges);
  const allNodesById = new Map(graph.nodes.map(node => [node.id, node]));
  if (root) {
    for (const node of graph.nodes) {
      if (node.id === root.id) continue;
      if (!Array.isArray(node.dependencies) || node.dependencies.length === 0) {
        node.dependencies = [root.id];
        graph.edges.push({ from: root.id, to: node.id, relation: 'depends_on' });
        console.log('[SEMANTIC_DEPENDENCY_CREATED]', { from: root.id, to: node.id });
      }
    }
  }

  const semanticGraph = {
    objective: text,
    userIntent,
    capabilities,
    deliverables,
    constraints,
    qualityRequirements,
    nonFunctionalRequirements,
    nodes: graph.nodes.map(node => normalizeSemanticNode(node)),
    edges: unique(graph.edges.map(edge => `${edge.from}|${edge.to}`)).map(key => {
      const [from, to] = key.split('|');
      return { from, to, relation: 'depends_on' };
    })
  };

  console.log('[SEMANTIC_GOAL_GRAPH_CREATED]', {
    nodeCount: semanticGraph.nodes.length,
    edgeCount: semanticGraph.edges.length
  });

  const validation = validateSemanticGraph(semanticGraph);
  console.log(validation.valid ? '[SEMANTIC_GOAL_GRAPH_VALID]' : '[SEMANTIC_GOAL_GRAPH_INVALID]', {
    nodeCount: semanticGraph.nodes.length,
    errorCount: validation.errors.length
  });
  console.log('[SEMANTIC_GOAL_GRAPH_COMPLETE]', {
    nodeCount: semanticGraph.nodes.length,
    edgeCount: semanticGraph.edges.length,
    valid: validation.valid
  });

  const mergedSemanticGraph = mergeSemanticGraphWithConstraints(semanticGraph, constraintGraph);

  return {
    ...semanticGraph,
    constraintGraph,
    mergedSemanticGraph,
    semanticGoalGraph: semanticGraph,
    validation
  };
}

export function buildSemanticGoalGraph(options = {}) {
  return decomposeObjective(options);
}
