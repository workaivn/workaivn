import assert from 'node:assert/strict';
import test from 'node:test';

import { buildArtifactRequirementGraph } from '../planning/artifactRequirementGraph.js';
import {
  buildSemanticGoalGraph,
  validateSemanticGraph
} from '../planning/objectiveSemanticDecomposer.js';

function captureLogs() {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.map(item => {
      if (typeof item === 'string') return item;
      try {
        return JSON.stringify(item);
      } catch {
        return String(item);
      }
    }).join(' '));
  };
  return {
    logs,
    restore() {
      console.log = originalLog;
    }
  };
}

function assertNodeDescriptions(graph, expectedDescriptions) {
  for (const description of expectedDescriptions) {
    assert.ok(
      graph.nodes.some(node => node.description === description),
      `Expected semantic node: ${description}`
    );
  }
}

function assertNoImplementationLeak(graph) {
  const serialized = JSON.stringify(graph);
  assert.equal(/(?:App\.tsx|page\.tsx|index\.html|index\.php|lib\/main\.dart|resources\/views|package\.json|composer\.json|vite\.config|tailwind\.config|main\.js|main\.ts|styles\.css)/i.test(serialized), false);
  assert.equal(/(?:Express|Fastify|React|Next\.js|Laravel|Flutter|workspace|projectScan|verifiedCommands|npm\s+run|flutter\s+run)/i.test(serialized), false);
}

test('Phase 5.09: landing page objective becomes a semantic goal graph before artifact reasoning', () => {
  const { logs, restore } = captureLogs();
  try {
    const graph = buildSemanticGoalGraph({
      objective: 'Build a World-Class SaaS Landing Page'
    });

    assert.ok(Array.isArray(graph.nodes));
    assert.ok(graph.nodes.length > 0);
    assertNodeDescriptions(graph, [
      'Landing Page',
      'Navigation',
      'Hero',
      'Features',
      'Pricing',
      'Testimonials',
      'FAQ',
      'CTA',
      'Footer',
      'Responsive',
      'Accessibility',
      'Performance',
      'SEO'
    ]);
    assertNoImplementationLeak(graph);
    assert.equal(validateSemanticGraph(graph).valid, true);
    assert.ok(logs.some(line => line.includes('[OBJECTIVE_SEMANTIC_DECOMPOSITION_START]')));
    assert.ok(logs.some(line => line.includes('[SEMANTIC_GOAL_GRAPH_CREATED]')));
    assert.ok(logs.some(line => line.includes('[SEMANTIC_GOAL_GRAPH_COMPLETE]')));
  } finally {
    restore();
  }
});

test('Phase 5.09: dashboard objectives infer auth, analytics, charts, security, and responsive semantics', () => {
  const graph = buildSemanticGoalGraph({
    objective: 'Create authentication dashboard.'
  });

  assertNodeDescriptions(graph, [
    'Dashboard',
    'Authentication',
    'Role Management',
    'Analytics',
    'Charts',
    'Security',
    'Responsive'
  ]);
  assertNoImplementationLeak(graph);
  assert.equal(validateSemanticGraph(graph).valid, true);
});

test('Phase 5.09: REST API objectives infer API semantics without framework leakage', () => {
  const graph = buildSemanticGoalGraph({
    objective: 'Build REST API.'
  });

  assertNodeDescriptions(graph, [
    'REST API',
    'API',
    'Endpoints',
    'Validation',
    'Authentication',
    'Documentation',
    'Testing',
    'Error Handling'
  ]);
  assertNoImplementationLeak(graph);
  assert.equal(validateSemanticGraph(graph).valid, true);
});

test('Phase 5.09: Flutter and Laravel constraints stay in the semantic layer without emitting framework files', () => {
  const flutterGraph = buildSemanticGoalGraph({
    objective: 'Create Flutter expense tracker.'
  });
  const laravelGraph = buildSemanticGoalGraph({
    objective: 'Create Laravel admin panel.'
  });

  assert.ok(flutterGraph.constraints.includes('Flutter'));
  assert.ok(laravelGraph.constraints.includes('Laravel'));
  assertNodeDescriptions(flutterGraph, [
    'Expense Tracker',
    'Transactions',
    'Dashboard',
    'Reports',
    'Offline Support',
    'Mobile UX'
  ]);
  assertNodeDescriptions(laravelGraph, [
    'Admin Panel',
    'Authentication',
    'Dashboard',
    'CRUD'
  ]);
  assert.equal(JSON.stringify(flutterGraph).includes('lib/main.dart'), false);
  assert.equal(JSON.stringify(laravelGraph).includes('resources/views'), false);
  assert.equal(validateSemanticGraph(flutterGraph).valid, true);
  assert.equal(validateSemanticGraph(laravelGraph).valid, true);
});

test('Phase 5.09: artifact requirement graph consumes the semantic goal graph and remains path-free', () => {
  const graph = buildArtifactRequirementGraph({
    objective: 'Build REST API.',
    goalType: 'API_SERVER',
    projectIntent: {
      prompt: 'Build REST API.',
      objective: 'Build REST API.'
    }
  });

  assert.ok(graph.semanticGoalGraph);
  assert.ok(Array.isArray(graph.semanticGoalGraph.nodes));
  assert.ok(graph.requirements.length > 0);
  assert.equal(graph.requirements.every(requirement => !('path' in requirement) && !('suggestedPath' in requirement)), true);
  assert.equal(graph.requirements.some(requirement => requirement.capability === 'API' || requirement.capability === 'API_LAYER'), true);
  assert.equal(validateSemanticGraph(graph.semanticGoalGraph).valid, true);
});
