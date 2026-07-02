import test from 'node:test';
import assert from 'node:assert/strict';

import { createExecutionPlanner } from '../executionPlanner/executionPlanner.js';
import { Planner } from '../planner/planner.js';

function createVerifiedContext(files = []) {
  return {
    verifiedFiles: [...files],
    verifiedCommands: ['npm test'],
    facts: {
      requestedFiles: [...files],
      entryFiles: []
    }
  };
}

function getToolTargets(tasks = [], tool) {
  return tasks
    .filter(task => task.tool === tool)
    .map(task => task.targetFiles?.[0] || task.toolArgs?.path || '')
    .filter(Boolean);
}

test('Phase 4.30-HF3: explicit create keeps package.json out of write targets', () => {
  const plan = createExecutionPlanner({
    objective: 'Create src/math.js and src/math.test.js. Detect framework automatically. Do not modify package.json unless necessary.',
    verifiedPlanningContext: createVerifiedContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' }
  });

  const writeTargets = getToolTargets(plan.tasks, 'WRITE_FILE');
  assert.deepEqual(writeTargets.sort(), ['src/math.js', 'src/math.test.js']);
  assert.equal(writeTargets.some(path => /package\.json$/i.test(path)), false);
});

test('Phase 4.30-HF3: explicit modification reads first and then patches or writes the target file', () => {
  const plan = createExecutionPlanner({
    objective: 'Modify src/app.js',
    verifiedPlanningContext: createVerifiedContext(['src/app.js']),
    canonicalFileUniverse: ['src/app.js'],
    plannerPolicies: { ALLOW_EXISTING_PROJECT_MODIFICATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' }
  });

  const readTargets = getToolTargets(plan.tasks, 'READ_FILE');
  const writeTargets = [
    ...getToolTargets(plan.tasks, 'WRITE_FILE'),
    ...getToolTargets(plan.tasks, 'APPLY_PATCH')
  ];

  assert.equal(readTargets.includes('src/app.js'), true);
  assert.equal(writeTargets.includes('src/app.js'), true);
});

test('Phase 4.30-HF3: package.json if it exists remains read-only', () => {
  const plan = createExecutionPlanner({
    objective: 'Use package.json if it exists',
    verifiedPlanningContext: createVerifiedContext(['package.json']),
    canonicalFileUniverse: ['package.json'],
    plannerPolicies: { ALLOW_EXISTING_PROJECT_MODIFICATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' }
  });

  const readTargets = getToolTargets(plan.tasks, 'READ_FILE');
  const writeTargets = [
    ...getToolTargets(plan.tasks, 'WRITE_FILE'),
    ...getToolTargets(plan.tasks, 'APPLY_PATCH')
  ];

  assert.equal(readTargets.includes('package.json'), true);
  assert.equal(writeTargets.includes('package.json'), false);
});

test('Phase 4.30-HF3: conditional package.json requests stay read-only and derived package.json requests stay blocked', () => {
  const conditionalPlan = createExecutionPlanner({
    objective: 'Do not modify package.json unless necessary',
    verifiedPlanningContext: createVerifiedContext(['package.json']),
    canonicalFileUniverse: ['package.json'],
    plannerPolicies: { ALLOW_EXISTING_PROJECT_MODIFICATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' }
  });

  const conditionalReads = getToolTargets(conditionalPlan.tasks, 'READ_FILE');
  const conditionalWrites = [
    ...getToolTargets(conditionalPlan.tasks, 'WRITE_FILE'),
    ...getToolTargets(conditionalPlan.tasks, 'APPLY_PATCH')
  ];
  assert.equal(conditionalReads.includes('package.json'), true);
  assert.equal(conditionalWrites.includes('package.json'), false);

  const derivedPlan = createExecutionPlanner({
    objective: 'Infer package.json',
    verifiedPlanningContext: createVerifiedContext(),
    canonicalFileUniverse: ['package.json'],
    plannerPolicies: { ALLOW_EXISTING_PROJECT_MODIFICATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' }
  });

  const derivedWrites = [
    ...getToolTargets(derivedPlan.tasks, 'WRITE_FILE'),
    ...getToolTargets(derivedPlan.tasks, 'APPLY_PATCH')
  ];
  assert.equal(derivedWrites.includes('package.json'), false);
  assert.equal(derivedPlan.tasks.some(task => task.tool === 'READ_FILE'), false);
});

test('Phase 4.30-HF3: TaskGraph logs only after task nodes are added', () => {
  const logEntries = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logEntries.push(args);
  };

  try {
    new Planner([
      {
        id: 'write-a',
        kind: 'CODING',
        goal: 'Write src/a.js',
        tool: 'WRITE_FILE',
        toolArgs: { path: 'src/a.js' }
      },
      {
        id: 'write-b',
        kind: 'CODING',
        goal: 'Write src/b.js',
        tool: 'WRITE_FILE',
        toolArgs: { path: 'src/b.js' }
      }
    ]);
  } finally {
    console.log = originalLog;
  }

  const firstNodeIndex = logEntries.findIndex(([tag]) => tag === '[TASK_NODE_ADDED]');
  const graphCreatedIndex = logEntries.findIndex(([tag]) => tag === '[TASK_GRAPH_CREATED]');
  const nodeCountEntry = logEntries.find(([tag]) => tag === '[TASK_GRAPH_NODE_COUNT]');
  const finalizedIndex = logEntries.findIndex(([tag]) => tag === '[TASK_GRAPH_FINALIZED]');

  assert.ok(firstNodeIndex >= 0);
  assert.ok(graphCreatedIndex > firstNodeIndex);
  assert.ok(finalizedIndex > graphCreatedIndex);
  assert.equal(nodeCountEntry?.[1]?.nodes, 2);
});
