import test from 'node:test';
import assert from 'node:assert/strict';

import { createExecutionPlanner } from '../executionPlanner/executionPlanner.js';
import { createExecutionGraph } from '../executionPlanner/executionGraph.js';
import { buildExecutionContract, projectMessagesToExecutionContract } from '../executionPlanner/executionContract.js';
import { scheduleExecutionUnits } from '../executionPlanner/executionScheduler.js';
import { verifyExecutionCompletion } from '../executionPlanner/executionVerifier.js';
import { buildPlan } from '../planner/planBuilder.js';
import { promoteProposalGraphToTasks } from '../planner/proposals/index.js';
import { tryRecovery } from '../planner/executionController.js';
import { Planner } from '../planner/planner.js';

function createVerifiedContext() {
  return {
    verifiedFiles: [],
    verifiedCommands: ['npm test'],
    facts: {
      requestedFiles: [],
      entryFiles: []
    }
  };
}

test('Phase 5.0: high-level goal decomposes into atomic execution units', () => {
  const plan = createExecutionPlanner({
    objective: 'Create src/math.js and src/math.test.js.',
    verifiedPlanningContext: createVerifiedContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_PROJECT_BOOTSTRAP: false },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' }
  });

  assert.equal(plan.validation.valid, true);
  assert.ok(plan.units.length >= 3);
  assert.equal(plan.units.some(unit => String(unit.type || '').toUpperCase() === 'CODING'), false);
  assert.deepEqual(
    plan.units.map(unit => String(unit.type || '').toUpperCase()),
    ['WRITE', 'WRITE', 'VALIDATE', 'VERIFY']
  );
});

test('Phase 5.0: execution graph preserves dependencies and validation waits for all writes', () => {
  const plan = createExecutionPlanner({
    objective: 'Create src/math.js and src/math.test.js.',
    verifiedPlanningContext: createVerifiedContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_PROJECT_BOOTSTRAP: false },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' }
  });

  const writeUnits = plan.units.filter(unit => String(unit.type || '').toUpperCase() === 'WRITE');
  const validateUnit = plan.units.find(unit => String(unit.type || '').toUpperCase() === 'VALIDATE');
  const verifyUnit = plan.units.find(unit => String(unit.type || '').toUpperCase() === 'VERIFY');

  assert.equal(writeUnits.length, 2);
  assert.ok(validateUnit);
  assert.ok(verifyUnit);
  assert.deepEqual(validateUnit.dependencies.sort(), writeUnits.map(unit => unit.id).sort());
  assert.deepEqual(verifyUnit.dependencies, [validateUnit.id]);
  assert.equal(typeof plan.graph.getUnit(validateUnit.id)?.completionCondition, 'function');
});

test('Phase 5.0: independent write tasks are schedulable in parallel', () => {
  const plan = createExecutionPlanner({
    objective: 'Create src/math.js and src/math.test.js.',
    verifiedPlanningContext: createVerifiedContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_PROJECT_BOOTSTRAP: false },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' }
  });

  const schedule = scheduleExecutionUnits(plan.graph);
  assert.equal(schedule.readyUnits.length, 2);
  assert.equal(schedule.parallelGroups.length > 0, true);
  assert.deepEqual(
    schedule.parallelGroups[0].map(unit => unit.targetFiles[0]).sort(),
    ['src/math.js', 'src/math.test.js']
  );
});

test('Phase 5.0: model receives only the execution contract, not the full objective', () => {
  const plan = createExecutionPlanner({
    objective: 'Create src/landing.js with hero, features, and pricing sections.',
    verifiedPlanningContext: createVerifiedContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_PROJECT_BOOTSTRAP: false },
    projectIntent: { goalType: 'SAAS_APP' },
    projectScan: { projectType: 'react' }
  });

  const writeTask = plan.tasks.find(task => String(task.unitType || '').toUpperCase() === 'WRITE');
  assert.ok(writeTask);
  assert.equal(writeTask.executionContract?.currentExecutionUnit?.id, writeTask.id);
  assert.equal(writeTask.executionContract?.objectiveSummary, writeTask.description);

  const transformed = projectMessagesToExecutionContract([
    { role: 'user', content: 'Create a SaaS Landing Page with hero, features, and pricing sections.' }
  ], writeTask.executionContract);

  assert.equal(String(transformed[0].content || '').includes('Create a SaaS Landing Page'), false);
  assert.equal(String(transformed[0].content || '').includes('Use only the execution contract.'), true);
  assert.equal(String(transformed[0].content || '').includes('Required files:'), true);
});

test('Phase 5.0: validation executes only after write completion', () => {
  const plan = createExecutionPlanner({
    objective: 'Create src/math.js and src/math.test.js.',
    verifiedPlanningContext: createVerifiedContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_PROJECT_BOOTSTRAP: false },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' }
  });

  const writeUnit = plan.graph.allUnits().find(unit => String(unit.type || '').toUpperCase() === 'WRITE');
  const validateUnit = plan.graph.allUnits().find(unit => String(unit.type || '').toUpperCase() === 'VALIDATE');
  assert.ok(writeUnit);
  assert.ok(validateUnit);
  assert.equal(validateUnit.prerequisites.includes(writeUnit.id), true);
  assert.equal(validateUnit.prerequisites.length, 2);
});

test('Phase 5.0: planner retries failed units without rebuilding the graph', () => {
  const plan = createExecutionPlanner({
    objective: 'Create src/math.js and src/math.test.js.',
    verifiedPlanningContext: createVerifiedContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_PROJECT_BOOTSTRAP: false },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' }
  });

  const writeUnit = plan.graph.allUnits().find(unit => String(unit.type || '').toUpperCase() === 'WRITE');
  assert.ok(writeUnit);
  const graphId = plan.graph.id;
  const unitCount = plan.graph.allUnits().length;

  assert.equal(plan.graph.failUnit(writeUnit.id, 'simulated failure'), true);
  assert.equal(plan.graph.retryUnit(writeUnit.id), true);

  const retriedUnit = plan.graph.getUnit(writeUnit.id);
  assert.equal(plan.graph.id, graphId);
  assert.equal(plan.graph.allUnits().length, unitCount);
  assert.equal(retriedUnit.retryCount, 1);
  assert.equal(retriedUnit.status, 'PENDING');
  assert.equal(scheduleExecutionUnits(plan.graph).readyUnits.some(unit => unit.id === writeUnit.id), true);
});

test('Phase 5.0: planner rejects cyclic execution graphs', () => {
  const graph = createExecutionGraph([
    { id: 'a', type: 'WRITE', dependencies: ['b'] },
    { id: 'b', type: 'WRITE', dependencies: ['a'] }
  ]);

  const validation = graph.validate();
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some(error => error.includes('Dependency cycle')));
});

test('Phase 5.0: planner refuses execution units without verified dependencies', () => {
  const graph = createExecutionGraph([
    { id: 'write:one', type: 'WRITE', dependencies: ['missing:dep'] }
  ]);

  const validation = graph.validate();
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some(error => error.includes('Missing dependency')));
});

test('Phase 5.0: execution graph completion requires every node to finish successfully', () => {
  const plan = createExecutionPlanner({
    objective: 'Create src/math.js and src/math.test.js.',
    verifiedPlanningContext: createVerifiedContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_PROJECT_BOOTSTRAP: false },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' }
  });

  const writeUnits = plan.graph.allUnits().filter(unit => String(unit.type || '').toUpperCase() === 'WRITE');
  const validateUnit = plan.graph.allUnits().find(unit => String(unit.type || '').toUpperCase() === 'VALIDATE');
  const verifyUnit = plan.graph.allUnits().find(unit => String(unit.type || '').toUpperCase() === 'VERIFY');
  for (const unit of writeUnits) {
    plan.graph.completeUnit(unit.id, { success: true });
  }
  if (validateUnit) {
    plan.graph.completeUnit(validateUnit.id, { success: true, command: validateUnit.outputs?.command || 'npm test' });
  }
  if (verifyUnit) {
    plan.graph.completeUnit(verifyUnit.id, { success: true });
  }
  const completion = verifyExecutionCompletion(plan.graph);
  assert.equal(completion.valid, true);
  assert.equal(plan.graph.finished, true);
});

test('Phase 5.0-HF1: legacy buildPlan redirects to ExecutionPlanner', () => {
  const result = buildPlan('Create src/math.js and src/math.test.js.', {
    projectScan: { projectType: 'node' },
    workspaceState: { existingFiles: [], workspaceRoot: '' },
    projectIntent: { goalType: 'LIBRARY' },
    bootstrapProfile: null
  }, null, createVerifiedContext());

  assert.ok(result.executionPlanner);
  assert.equal(Array.isArray(result.tasks), true);
  assert.equal(result.tasks.length, result.executionPlanner.tasks.length);
  assert.equal(result.tasks.some(task => task.kind === 'CODING'), false);
});

test('Phase 5.0-HF1: proposal promotion delegates to ExecutionPlanner', () => {
  const result = promoteProposalGraphToTasks({
    proposals: [
      {
        proposalId: 'proposal-1',
        proposalType: 'FILE',
        suggestedFiles: ['src/Hero.jsx'],
        authority: { source: 'bootstrap_proposal' },
        metadata: { contentByFile: { 'src/Hero.jsx': 'export default function Hero() { return null; }' } }
      },
      {
        proposalId: 'proposal-2',
        proposalType: 'EXECUTION',
        suggestedCommands: ['npm test'],
        authority: { source: 'bootstrap_proposal' }
      }
    ]
  }, {
    objective: 'Create a landing page with a test run.',
    workspaceState: { existingFiles: [], scan: { projectType: 'react' } },
    projectScan: { projectType: 'react' },
    plannerPolicies: { ALLOW_PROJECT_BOOTSTRAP: false },
    verifiedPlanningContext: createVerifiedContext()
  });

  assert.ok(result.executionPlanner);
  assert.equal(result.tasks.length, 0);
});

test('Phase 5.0-HF1: recovery retries the execution graph instead of creating new tasks', () => {
  const executionPlanner = createExecutionPlanner({
    objective: 'Create src/math.js and src/math.test.js.',
    verifiedPlanningContext: createVerifiedContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_PROJECT_BOOTSTRAP: false },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' }
  });
  const planner = new Planner(executionPlanner.tasks);
  planner.executionPlanner = executionPlanner;
  const failedTask = planner.getNextTask();
  assert.ok(failedTask);

  const result = tryRecovery(planner, failedTask, { workspaceRoot: '' });
  assert.equal(result.retryHandled, true);
  assert.equal(executionPlanner.graph.getUnit(failedTask.id)?.retryCount, 1);
});
