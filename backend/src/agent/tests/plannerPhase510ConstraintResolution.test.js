import assert from 'node:assert/strict';
import test from 'node:test';

import { buildObjectiveConstraintGraph } from '../planning/objectiveConstraintExtractor.js';
import { buildPlanningStrategyGraph, resolveConstraints, validateStrategyGraph } from '../planning/constraintResolver.js';
import { buildArtifactRequirementGraph } from '../planning/artifactRequirementGraph.js';

function nodeText(graph) {
  return JSON.stringify(graph);
}

test('Phase 5.10: React constraint resolves into a React SPA planning strategy', () => {
  const constraintGraph = buildObjectiveConstraintGraph({ objective: 'Use React.' });
  const strategyGraph = buildPlanningStrategyGraph({ objective: 'Use React.', constraintGraph });

  assert.ok(strategyGraph.strategies.some(strategy => strategy.strategy === 'React SPA'));
  assert.ok(strategyGraph.initializationStrategies.some(strategy => strategy.strategy === 'React Project Initialization'));
  assert.equal(validateStrategyGraph(strategyGraph).valid, true);
  assert.equal(/App\.tsx|package\.json|vite\.config\.ts/i.test(nodeText(strategyGraph)), false);
});

test('Phase 5.10: React, TypeScript, and TailwindCSS merge into coherent planning strategies', () => {
  const constraintGraph = buildObjectiveConstraintGraph({ objective: 'Use React + TypeScript + TailwindCSS.' });
  const strategyGraph = buildPlanningStrategyGraph({ objective: 'Use React + TypeScript + TailwindCSS.', constraintGraph });

  assert.ok(strategyGraph.strategies.some(strategy => strategy.strategy === 'React SPA'));
  assert.ok(strategyGraph.strategies.some(strategy => strategy.strategy === 'Typed Project'));
  assert.ok(strategyGraph.strategies.some(strategy => strategy.strategy === 'Utility CSS'));
  assert.equal(strategyGraph.strategies.filter(strategy => strategy.strategy === 'React SPA').length, 1);
  assert.equal(strategyGraph.strategies.filter(strategy => strategy.strategy === 'Typed Project').length, 1);
  assert.equal(strategyGraph.strategies.filter(strategy => strategy.strategy === 'Utility CSS').length, 1);
});

test('Phase 5.10: Framer Motion and Responsive constraints resolve to strategy nodes', () => {
  const constraintGraph = buildObjectiveConstraintGraph({ objective: 'Framer Motion Responsive' });
  const strategyGraph = buildPlanningStrategyGraph({ objective: 'Framer Motion Responsive', constraintGraph });

  assert.ok(strategyGraph.strategies.some(strategy => strategy.strategy === 'Animation Strategy'));
  assert.ok(strategyGraph.strategies.some(strategy => strategy.strategy === 'Responsive Layout Strategy'));
});

test('Phase 5.10: Production Ready, Performance, and Accessibility resolve deterministically', () => {
  const constraintGraph = buildObjectiveConstraintGraph({ objective: 'Production Ready Performance Accessibility' });
  const strategyGraph = buildPlanningStrategyGraph({ objective: 'Production Ready Performance Accessibility', constraintGraph });

  assert.ok(strategyGraph.strategies.some(strategy => strategy.strategy === 'Production Quality Strategy'));
  assert.ok(strategyGraph.strategies.some(strategy => strategy.strategy === 'Performance Strategy'));
  assert.ok(strategyGraph.strategies.some(strategy => strategy.strategy === 'Accessibility Strategy'));
});

test('Phase 5.10: strategy graph remains implementation independent and path-free', () => {
  const constraintGraph = buildObjectiveConstraintGraph({ objective: 'Use React + TypeScript + TailwindCSS.' });
  const strategyGraph = resolveConstraints({ objective: 'Use React + TypeScript + TailwindCSS.', constraintGraph });

  assert.equal(validateStrategyGraph(strategyGraph).valid, true);
  for (const node of strategyGraph.nodes) {
    assert.equal(node.executionEligible, false);
    assert.equal(Array.isArray(node.sourceConstraints) && node.sourceConstraints.length > 0, true);
    assert.equal(/(?:App\.tsx|main\.tsx|vite\.config\.ts|package\.json|index\.html|npm run|npm install)/i.test(JSON.stringify(node)), false);
  }
});

test('Phase 5.10: artifact requirement graph consumes planning strategy graph', () => {
  const constraintGraph = buildObjectiveConstraintGraph({ objective: 'Use React + TypeScript + TailwindCSS.' });
  const strategyGraph = buildPlanningStrategyGraph({ objective: 'Use React + TypeScript + TailwindCSS.', constraintGraph });
  const requirementGraph = buildArtifactRequirementGraph({
    objective: 'Use React + TypeScript + TailwindCSS.',
    goalType: 'LANDING_PAGE',
    planningStrategyGraph: strategyGraph,
    projectIntent: {
      prompt: 'Use React + TypeScript + TailwindCSS.',
      objective: 'Use React + TypeScript + TailwindCSS.',
      goalType: 'LANDING_PAGE'
    },
    policies: {
      ALLOW_PROJECT_INITIALIZATION: false
    }
  });

  assert.ok(requirementGraph.planningStrategyGraph);
  assert.equal(Array.isArray(requirementGraph.planningStrategyGraph.strategies), true);
  assert.ok(requirementGraph.requirements.length > 0);
  assert.equal(requirementGraph.requirements.some(requirement => /App\.tsx|package\.json|vite\.config\.ts/i.test(JSON.stringify(requirement))), false);
});
