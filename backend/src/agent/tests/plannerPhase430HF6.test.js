import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPlanningContext } from '../planner/context/PlanningContextBuilder.js';
import { createExecutionPlanner } from '../executionPlanner/executionPlanner.js';

function createRequestedFileDetails() {
  return [
    {
      path: 'src/math.js',
      requestedKind: 'EXPLICIT_CREATE',
      authoritySource: 'explicit_user_request',
      explicit: true,
      conditional: false,
      verified: false,
      plannedNewFile: true
    },
    {
      path: 'src/math.test.js',
      requestedKind: 'EXPLICIT_CREATE',
      authoritySource: 'explicit_user_request',
      explicit: true,
      conditional: false,
      verified: false,
      plannedNewFile: true
    }
  ];
}

function buildRequestedPlanningContext() {
  return buildPlanningContext({
    workspaceState: {
      workspaceRoot: 'G:/langtuvn/ai_local',
      existingFiles: ['src/app.js']
    },
    projectScan: {
      projectType: 'node',
      packageJsonFound: true,
      packageJsonPath: 'package.json',
      discoveredFiles: ['src/app.js']
    },
    projectIntent: { goalType: 'LIBRARY' },
    validatedAssumptions: [],
    classifierRequestedFiles: createRequestedFileDetails(),
    plannedWriteTargets: ['src/math.js', 'src/math.test.js'],
    explicitRequestedNewFiles: ['src/math.js', 'src/math.test.js']
  }).context;
}

test('Phase 4.30-HF6: ExecutionPlanner consumes requestedFileDetails from PlanningContext', () => {
  const context = buildRequestedPlanningContext();
  const plan = createExecutionPlanner({
    objective: 'Create src/math.js and src/math.test.js.',
    verifiedPlanningContext: context,
    canonicalFileUniverse: ['src/app.js'],
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true, ALLOW_EXISTING_PROJECT_MODIFICATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' }
  });

  const writeTasks = plan.tasks.filter(task => task.tool === 'WRITE_FILE');
  const analyzeTasks = plan.tasks.filter(task => task.tool === 'LIST_FILES');

  assert.equal(writeTasks.length, 2);
  assert.equal(analyzeTasks.length, 0);
  assert.deepEqual(writeTasks.map(task => task.targetFiles?.[0]).sort(), ['src/math.js', 'src/math.test.js']);
});

test('Phase 4.30-HF6: requestedKind and authoritySource propagate to ExecutionUnit and Task', () => {
  const context = buildRequestedPlanningContext();
  const plan = createExecutionPlanner({
    objective: 'Create src/math.js and src/math.test.js.',
    verifiedPlanningContext: context,
    canonicalFileUniverse: ['src/app.js'],
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true, ALLOW_EXISTING_PROJECT_MODIFICATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' }
  });

  for (const task of plan.tasks.filter(task => task.tool === 'WRITE_FILE')) {
    assert.equal(task.requestedKind, 'EXPLICIT_CREATE');
    assert.equal(task.authoritySource, 'explicit_user_request');
    assert.equal(task.approvedByFirewall, true);
  }
});

test('Phase 4.30-HF6: legacy ANALYZE path does not replace explicit create requests', () => {
  const context = buildRequestedPlanningContext();
  const plan = createExecutionPlanner({
    objective: 'Create src/math.js and src/math.test.js.',
    verifiedPlanningContext: context,
    canonicalFileUniverse: ['src/app.js'],
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true, ALLOW_EXISTING_PROJECT_MODIFICATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' }
  });

  assert.equal(plan.tasks.some(task => task.tool === 'LIST_FILES'), false);
  assert.equal(plan.tasks.some(task => task.tool === 'READ_FILE' && task.targetFiles?.includes('src/math.js')), false);
});

test('Phase 4.30-HF6: integration failure is thrown when explicit requests do not produce writes', () => {
  const badContext = {
    workspace: {},
    verifiedFiles: [],
    verifiedCommands: [],
    requestedFileDetails: [
      {
        path: 'src/bad.js',
        requestedKind: 'DERIVED',
        authoritySource: 'verified_planning_context',
        explicit: false,
        conditional: false,
        verified: false,
        plannedNewFile: false
      }
    ],
    requestedFileKinds: ['DERIVED'],
    plannedNewFiles: [],
    explicitRequestedNewFiles: ['src/bad.js'],
    facts: {
      requestedFileDetails: [
        {
          path: 'src/bad.js',
          requestedKind: 'DERIVED',
          authoritySource: 'verified_planning_context',
          explicit: false,
          conditional: false,
          verified: false,
          plannedNewFile: false
        }
      ],
      requestedFiles: ['src/bad.js'],
      requestedFileKinds: ['DERIVED'],
      plannedNewFiles: [],
      entryFiles: []
    },
    derived: {
      verifiedFiles: [],
      verifiedCommands: [],
      verifiedRecommendations: [],
      blockedRecommendations: []
    },
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true, ALLOW_EXISTING_PROJECT_MODIFICATION: true }
  };

  assert.throws(() => {
    createExecutionPlanner({
      objective: 'Create src/bad.js',
      verifiedPlanningContext: badContext,
      canonicalFileUniverse: [],
      plannerPolicies: { ALLOW_NEW_FILE_CREATION: true, ALLOW_EXISTING_PROJECT_MODIFICATION: true },
      projectIntent: { goalType: 'LIBRARY' },
      projectScan: { projectType: 'node' }
    });
  }, error => error?.code === 'EXECUTION_PLANNER_INTEGRATION_FAILURE');
});
