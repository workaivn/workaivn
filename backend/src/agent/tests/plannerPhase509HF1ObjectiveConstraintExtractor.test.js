import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPlanningContext } from '../planner/context/PlanningContextBuilder.js';
import { buildSemanticGoalGraph } from '../planning/objectiveSemanticDecomposer.js';
import { buildObjectiveConstraintGraph, extractObjectiveConstraints, validateConstraint } from '../planning/objectiveConstraintExtractor.js';
import { mapRequirementsToWorkspace } from '../planning/workspaceMapper.js';

test('Phase 5.09-HF1: objective technology constraints are extracted independently of recommendations', () => {
  const constraints = extractObjectiveConstraints('Use React + TypeScript + TailwindCSS.');

  assert.ok(constraints.some(constraint => constraint.value === 'React'));
  assert.ok(constraints.some(constraint => constraint.value === 'TypeScript'));
  assert.ok(constraints.some(constraint => constraint.value === 'TailwindCSS'));
  assert.equal(constraints.every(constraint => constraint.source === 'OBJECTIVE_TEXT'), true);
  assert.equal(validateConstraint({ constraints }).valid, true);
});

test('Phase 5.09-HF1: constraint graph preserves quality and UX requirements', () => {
  const graph = buildObjectiveConstraintGraph({
    objective: 'Production Ready Responsive Dark Mode Accessibility'
  });

  assert.ok(graph.constraints.some(constraint => constraint.value === 'Production Ready'));
  assert.ok(graph.constraints.some(constraint => constraint.value === 'Responsive'));
  assert.ok(graph.constraints.some(constraint => constraint.value === 'Dark Mode'));
  assert.ok(graph.constraints.some(constraint => constraint.value === 'Accessibility'));
  assert.ok(graph.validation.valid);
});

test('Phase 5.09-HF1: semantic goal graph stays capability-only while merging constraints separately', () => {
  const graph = buildSemanticGoalGraph({
    objective: 'Build a SaaS Landing Page with React and TailwindCSS.',
    projectIntent: {
      prompt: 'Build a SaaS Landing Page with React and TailwindCSS.',
      objective: 'Build a SaaS Landing Page with React and TailwindCSS.'
    }
  });

  assert.ok(Array.isArray(graph.nodes));
  assert.ok(graph.nodes.some(node => node.capability === 'Landing Page' || node.capability === 'APPLICATION_ENTRY'));
  assert.ok(graph.constraintGraph);
  assert.ok(Array.isArray(graph.constraintGraph.constraints));
  assert.ok(graph.mergedSemanticGraph);
  assert.ok(Array.isArray(graph.mergedSemanticGraph.goalNodes));
  assert.ok(Array.isArray(graph.mergedSemanticGraph.constraintNodes));
});

test('Phase 5.09-HF1: workspace mapping keeps verified framework separate from required framework', () => {
  const planningContext = buildPlanningContext({
    workspaceState: {
      workspaceRoot: 'G:/langtuvn/ai_local',
      existingFiles: []
    },
    projectScan: {
      workspaceRoot: 'G:/langtuvn/ai_local',
      projectType: 'generic',
      packageJsonFound: false,
      discoveredFiles: []
    },
    projectIntent: {
      prompt: 'Use React and TypeScript.',
      objective: 'Use React and TypeScript.',
      goalType: 'LANDING_PAGE'
    },
    validatedAssumptions: []
  }).context;

  const mapping = mapRequirementsToWorkspace({
    requirements: [
      {
        id: 'requirement:semantic-product-application-entry',
        capability: 'APPLICATION_ENTRY',
        artifactType: 'source',
        required: true,
        confidence: 0.9,
        source: 'objective_semantic'
      }
    ],
    planningContext,
    projectScanSnapshot: {
      workspaceRoot: 'G:/langtuvn/ai_local',
      projectType: 'generic',
      packageJsonFound: false,
      discoveredFiles: []
    },
    projectIntent: {
      prompt: 'Use React and TypeScript.',
      objective: 'Use React and TypeScript.',
      goalType: 'LANDING_PAGE'
    },
    objective: 'Use React and TypeScript.'
  });

  assert.equal(planningContext.verifiedFramework, 'generic');
  assert.equal(planningContext.requiredFramework, 'React');
  assert.equal(mapping.verifiedFramework, 'generic');
  assert.equal(mapping.requiredFramework, 'react-vite-ts');
  assert.ok(mapping.frameworkResolution);
  assert.equal(mapping.frameworkResolution.verifiedFrameworkKey, 'generic');
  assert.equal(mapping.frameworkResolution.requiredFrameworkKey, 'react-vite-ts');
  assert.ok(mapping.candidates.some(candidate => candidate.path === 'src/App.tsx'));
});
