import assert from 'node:assert/strict';
import test from 'node:test';

import { buildObjectiveConstraintGraph } from '../planning/objectiveConstraintExtractor.js';
import { buildPlanningStrategyGraph } from '../planning/constraintResolver.js';
import { buildArtifactRequirementGraph } from '../planning/artifactRequirementGraph.js';
import { buildRequirementGraph, translatePlanningStrategies, validateArtifactRequirements } from '../planning/strategyRequirementTranslator.js';
import { generateArtifactCandidates } from '../planner/artifactCandidateGenerator.js';

function asJson(value) {
  return JSON.stringify(value);
}

test('Phase 5.11: React SPA translates into implementation-independent requirements', () => {
  const constraintGraph = buildObjectiveConstraintGraph({ objective: 'Use React.' });
  const planningStrategyGraph = buildPlanningStrategyGraph({ objective: 'Use React.', constraintGraph });
  const requirementGraph = translatePlanningStrategies({ planningStrategyGraph });

  assert.equal(validateArtifactRequirements(requirementGraph).valid, true);
  assert.ok(requirementGraph.requirements.some(requirement => requirement.purpose === 'Application Entry'));
  assert.ok(requirementGraph.requirements.some(requirement => requirement.purpose === 'Root Component'));
  assert.ok(requirementGraph.requirements.some(requirement => requirement.purpose === 'Routing Capability'));
  assert.ok(requirementGraph.requirements.some(requirement => requirement.purpose === 'Styling Capability'));
  assert.ok(requirementGraph.requirements.some(requirement => requirement.purpose === 'Theme Capability'));
  assert.equal(/App\.tsx|main\.tsx|vite\.config\.ts|package\.json/i.test(asJson(requirementGraph)), false);
});

test('Phase 5.11: Responsive Layout strategy translates into layout requirements', () => {
  const planningStrategyGraph = buildPlanningStrategyGraph({
    objective: 'Responsive Layout',
    constraintGraph: buildObjectiveConstraintGraph({ objective: 'Responsive Layout' })
  });
  const requirementGraph = buildRequirementGraph({ planningStrategyGraph });

  assert.ok(requirementGraph.requirements.some(requirement => requirement.purpose === 'Responsive Layout'));
  assert.ok(requirementGraph.requirements.some(requirement => requirement.purpose === 'Breakpoint Support'));
  assert.equal(/App\.tsx|main\.tsx|vite\.config\.ts|package\.json/i.test(asJson(requirementGraph)), false);
});

test('Phase 5.11: React Project Initialization translates into manifest and structure requirements', () => {
  const planningStrategyGraph = buildPlanningStrategyGraph({
    objective: 'Use React.',
    constraintGraph: buildObjectiveConstraintGraph({ objective: 'Use React.' })
  });
  const requirementGraph = translatePlanningStrategies({ planningStrategyGraph });

  assert.ok(requirementGraph.requirements.some(requirement => requirement.purpose === 'Project Manifest'));
  assert.ok(requirementGraph.requirements.some(requirement => requirement.purpose === 'Dependency Manifest'));
  assert.ok(requirementGraph.requirements.some(requirement => requirement.purpose === 'Component Structure'));
  assert.equal(/package\.json/i.test(asJson(requirementGraph)), false);
});

test('Phase 5.11: requirement graph remains free of paths, commands, execution tools, and framework files', () => {
  const planningStrategyGraph = buildPlanningStrategyGraph({
    objective: 'Use React + TypeScript + TailwindCSS.',
    constraintGraph: buildObjectiveConstraintGraph({ objective: 'Use React + TypeScript + TailwindCSS.' })
  });
  const requirementGraph = translatePlanningStrategies({ planningStrategyGraph });
  const serialized = asJson(requirementGraph);

  assert.equal(/(?:src\/|app\/|package\.json|app\.tsx|main\.tsx|vite\.config|tailwind\.config|composer\.json|index\.html|index\.php)/i.test(serialized), false);
  assert.equal(/(?:write_file|patch_file|run_terminal|npm\s+run|npm\s+install|composer|flutter\s+run|flutter\s+test)/i.test(serialized), false);
});

test('Phase 5.11: natural language landing page objective produces requirements and workspace candidates', () => {
  const objective = 'Build a SaaS landing page';
  const constraintGraph = buildObjectiveConstraintGraph({ objective });
  const planningStrategyGraph = buildPlanningStrategyGraph({ objective, constraintGraph });
  const result = generateArtifactCandidates({
    objective,
    taskIntent: {
      prompt: objective,
      objective,
      goalType: 'LANDING_PAGE'
    },
    planningContext: {
      planningStrategyGraph,
      requestedFileDetails: []
    },
    projectScanSnapshot: {
      projectType: 'generic'
    },
    policies: {}
  });

  assert.ok(result.requirementGraph.requirements.length > 0);
  assert.ok(result.workspaceMapping.candidates.length > 0);
});

test('Phase 5.11: explicit file request merges with strategy requirements into one unified graph', () => {
  const objective = 'Use React.';
  const constraintGraph = buildObjectiveConstraintGraph({ objective });
  const planningStrategyGraph = buildPlanningStrategyGraph({ objective, constraintGraph });
  const explicitFileDetails = [
    {
      path: 'src/math.js',
      kind: 'EXPLICIT_CREATE',
      authoritySource: 'workspace_authority',
      explicit: true,
      verified: false
    }
  ];
  const translatedRequirementGraph = buildRequirementGraph({
    planningStrategyGraph,
    requestedFileDetails: explicitFileDetails
  });
  const requirementGraph = buildArtifactRequirementGraph({
    translatedRequirementGraph,
    planningStrategyGraph,
    objective,
    goalType: 'LANDING_PAGE',
    projectIntent: {
      prompt: objective,
      objective,
      goalType: 'LANDING_PAGE'
    }
  });

  assert.ok(translatedRequirementGraph.requirements.some(requirement => requirement.capability === 'EXPLICIT_FILE_REQUEST'));
  assert.ok(translatedRequirementGraph.requirements.some(requirement => requirement.purpose === 'Application Entry'));
  assert.equal(/src\/math\.js/i.test(asJson(translatedRequirementGraph)), false);
  assert.ok(requirementGraph.requirements.length >= translatedRequirementGraph.requirements.length);
  assert.equal(validateArtifactRequirements(requirementGraph).valid, true);
});
