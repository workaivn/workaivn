import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPlanningContext } from '../planner/context/PlanningContextBuilder.js';
import { createExecutionPlanner } from '../executionPlanner/executionPlanner.js';

function createRequestedFileDetails() {
  return [
    {
      path: 'src/math.js',
      kind: 'EXPLICIT_CREATE',
      authoritySource: 'explicit_user_request',
      explicit: true,
      conditional: false,
      verified: false,
      plannedNewFile: true
    },
    {
      path: 'src/math.test.js',
      kind: 'EXPLICIT_CREATE',
      authoritySource: 'explicit_user_request',
      explicit: true,
      conditional: false,
      verified: false,
      plannedNewFile: true
    },
    {
      path: 'package.json',
      kind: 'DISCOVER_IF_EXISTS',
      authoritySource: 'explicit_user_request',
      explicit: true,
      conditional: false,
      verified: false,
      plannedNewFile: false
    }
  ];
}

function createPlanningContext() {
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

test('Phase 4.30-HF5: PlanningContext includes requested metadata before freeze', () => {
  const context = createPlanningContext();

  assert.equal(Object.isFrozen(context), true);
  assert.equal(Object.isFrozen(context.facts), true);
  assert.equal(Object.isFrozen(context.derived), true);
  assert.equal(Object.isFrozen(context.requestedFileDetails), true);

  assert.deepEqual(context.requestedFileDetails.map(entry => entry.path), [
    'src/math.js',
    'src/math.test.js',
    'package.json'
  ]);
  assert.deepEqual(context.explicitRequestedNewFiles, ['src/math.js', 'src/math.test.js']);
  assert.deepEqual(context.discoverIfExistsFiles, ['package.json']);
  assert.deepEqual(context.plannedNewFiles, ['src/math.js', 'src/math.test.js']);
});

test('Phase 4.30-HF5: PlanningContext rejects late mutation attempts', () => {
  const context = createPlanningContext();

  assert.throws(() => {
    context.requestedFileDetails = [];
  }, /getter|read only|not extensible|frozen/i);

  assert.throws(() => {
    context.explicitRequestedNewFiles.push('src/other.js');
  }, /read only|not extensible|frozen/i);
});

test('Phase 4.30-HF5: downstream execution planner reads immutable requested metadata', () => {
  const context = createPlanningContext();
  const plan = createExecutionPlanner({
    objective: 'Create src/math.js and src/math.test.js. Do not modify package.json unless necessary.',
    verifiedPlanningContext: context,
    canonicalFileUniverse: ['src/app.js', 'package.json'],
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true, ALLOW_EXISTING_PROJECT_MODIFICATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: {
      projectType: 'node',
      packageJsonFound: true,
      packageJsonPath: 'package.json'
    },
    explicitRequestedNewFiles: context.explicitRequestedNewFiles
  });

  const writeTargets = plan.tasks
    .filter(task => task.tool === 'WRITE_FILE' || task.tool === 'APPLY_PATCH')
    .map(task => task.targetFiles?.[0] || task.toolArgs?.path || '')
    .filter(Boolean);

  assert.ok(writeTargets.includes('src/math.js'));
  assert.ok(writeTargets.includes('src/math.test.js'));
  assert.equal(writeTargets.includes('package.json'), false);
});

test('Phase 4.30-HF5: package.json classification stays discover-only or conditional', () => {
  const context = createPlanningContext();
  const packageEntry = context.requestedFileDetails.find(entry => entry.path === 'package.json');

  assert.ok(packageEntry);
  assert.equal(
    [context.requestedFileKinds, context.discoverIfExistsFiles, context.referenceOnlyFiles, context.conditionalRequestedFiles]
      .flat()
      .includes('package.json'),
    true
  );
  assert.equal(packageEntry.kind, 'DISCOVER_IF_EXISTS');
  assert.equal(packageEntry.plannedNewFile, false);
});
