import test from 'node:test';
import assert from 'node:assert/strict';

import { createExecutionPlanner } from '../executionPlanner/executionPlanner.js';
import { decomposeGoalToExecutionUnits } from '../executionPlanner/goalDecomposer.js';

function createBasicContext() {
  return {
    verifiedFiles: [],
    verifiedCommands: ['npm test'],
    facts: { requestedFiles: [], entryFiles: [] },
    explicitRequestedNewFiles: []
  };
}

// Test 1: Single explicit file produces exactly 1 WRITE candidate
test('Phase 4.30-HF1 Test 1 — single explicit file produces WRITE candidate', () => {
  const plan = createExecutionPlanner({
    objective: 'Create src/math.js',
    verifiedPlanningContext: createBasicContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' },
    explicitRequestedNewFiles: ['src/math.js']
  });

  const writeTasks = plan.tasks.filter(t => t.tool === 'WRITE_FILE');
  assert.equal(writeTasks.length, 1, 'Expected exactly 1 WRITE_FILE task');
  const task = writeTasks[0];
  const path = task.targetFiles?.[0] || task.toolArgs?.path || '';
  assert.equal(path, 'src/math.js');
  assert.equal(task.authoritySource, 'explicit_user_request');
  assert.equal(task.approvedByFirewall, true);
  assert.equal(task.unitType, 'WRITE');
});

// Test 2: Multiple explicit files produce multiple parallel WRITE candidates
test('Phase 4.30-HF1 Test 2 — multiple explicit files produce parallel WRITE candidates', () => {
  const plan = createExecutionPlanner({
    objective: 'Create src/math.js and src/math.test.js',
    verifiedPlanningContext: createBasicContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' },
    explicitRequestedNewFiles: ['src/math.js', 'src/math.test.js']
  });

  const writeTasks = plan.tasks.filter(t => t.tool === 'WRITE_FILE');
  assert.equal(writeTasks.length, 2, 'Expected exactly 2 WRITE_FILE tasks');
  const paths = writeTasks.map(t => t.targetFiles?.[0] || t.toolArgs?.path || '');
  assert.ok(paths.includes('src/math.js'));
  assert.ok(paths.includes('src/math.test.js'));
  writeTasks.forEach(t => {
    assert.equal(t.authoritySource, 'explicit_user_request');
    assert.equal(t.approvedByFirewall, true);
    assert.equal(t.unitType, 'WRITE');
  });
});

// Test 3: Authority preservation through the pipeline
test('Phase 4.30-HF1 Test 3 — authority source preserved through pipeline', () => {
  const plan = createExecutionPlanner({
    objective: 'Create src/utils.js',
    verifiedPlanningContext: createBasicContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' },
    explicitRequestedNewFiles: ['src/utils.js']
  });

  assert.ok(plan.tasks.length > 0, 'Should have at least one task');
  const writeTasks = plan.tasks.filter(t => t.tool === 'WRITE_FILE');
  assert.equal(writeTasks.length, 1);
  writeTasks.forEach(t => {
    assert.equal(t.authoritySource, 'explicit_user_request', 'Authority must remain explicit_user_request');
    assert.equal(t.unitType, 'WRITE');
    assert.equal(t.approvedByFirewall, true);
  });
});

// Test 4: Protected file explicit request is blocked by firewall
test('Phase 4.30-HF1 Test 4 — protected file explicit request blocked by firewall', () => {
  const plan = createExecutionPlanner({
    objective: 'Create protected-file.js and package.json',
    verifiedPlanningContext: createBasicContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' },
    explicitRequestedNewFiles: ['package.json']
  });

  const writeTasks = plan.tasks.filter(t => t.tool === 'WRITE_FILE');
  const packageJsonTask = writeTasks.find(t => {
    const path = t.targetFiles?.[0] || t.toolArgs?.path || '';
    return path === 'package.json';
  });
  assert.ok(packageJsonTask, 'package.json explicit request should be approved');
  assert.equal(packageJsonTask.authoritySource, 'explicit_user_request');
  assert.equal(packageJsonTask.approvedByFirewall, true);
});

// Test 5: package.json never becomes package.js
test('Phase 4.30-HF1 Test 5 — package.json canonical extension preserved', () => {
  const plan = createExecutionPlanner({
    objective: 'Create package.json',
    verifiedPlanningContext: createBasicContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' },
    explicitRequestedNewFiles: ['package.json']
  });

  const writeTasks = plan.tasks.filter(t => t.tool === 'WRITE_FILE');
  assert.equal(writeTasks.length, 1, 'Expected 1 WRITE_FILE task for package.json');
  const path = writeTasks[0].targetFiles?.[0] || writeTasks[0].toolArgs?.path || '';
  assert.equal(path, 'package.json', 'Path must be exactly package.json');
  assert.equal(/^package\.js$/i.test(path), false, 'Must never become package.js');
});

// Test 6: Canonical parser produces consistent file extensions for known config files
test('Phase 4.30-HF1 Test 6 — canonical path parser preserves known config extensions', () => {
  const plan = createExecutionPlanner({
    objective: 'Create package.json, tsconfig.json, vite.config.ts, src/math.test.js',
    verifiedPlanningContext: createBasicContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' },
    explicitRequestedNewFiles: ['package.json', 'tsconfig.json', 'vite.config.ts', 'src/math.test.js']
  });

  const writeTasks = plan.tasks.filter(t => t.tool === 'WRITE_FILE');
  const paths = writeTasks.map(t => t.targetFiles?.[0] || t.toolArgs?.path || '');
  assert.ok(paths.includes('package.json'), 'package.json must be present');
  assert.ok(paths.includes('tsconfig.json'), 'tsconfig.json must be present');
  assert.ok(paths.includes('vite.config.ts'), 'vite.config.ts must be present');
  assert.ok(paths.includes('src/math.test.js'), 'src/math.test.js must be present');
  const packageJs = paths.some(p => /^package\.js$/i.test(p));
  assert.equal(packageJs, false, 'package.js must never appear');
});

// Test 7: Existing file modification produces READ + WRITE with verified_workspace authority
test('Phase 4.30-HF1 Test 7 — existing file modification uses verified_workspace authority', () => {
  const plan = createExecutionPlanner({
    objective: 'Modify src/app.js to add error handling',
    verifiedPlanningContext: {
      verifiedFiles: ['src/app.js'],
      verifiedCommands: ['npm test'],
      facts: { requestedFiles: [], entryFiles: [] },
      explicitRequestedNewFiles: []
    },
    canonicalFileUniverse: ['src/app.js'],
    plannerPolicies: { ALLOW_EXISTING_PROJECT_MODIFICATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' }
  });

  const tasks = plan.tasks;
  const writeTasks = tasks.filter(t => t.tool === 'WRITE_FILE' || t.tool === 'APPLY_PATCH');
  assert.ok(writeTasks.length > 0, 'Should have at least one write task for existing file');
  writeTasks.forEach(t => {
    const path = t.targetFiles?.[0] || t.toolArgs?.path || '';
    assert.equal(path, 'src/app.js');
    if (t.authoritySource) {
      assert.notEqual(t.authoritySource, 'explicit_user_request', 'Existing file should not use explicit_user_request');
    }
  });
});

// Test 8: Regression — VERIFY units remain internal, no null tool produced
test('Phase 4.30-HF1 Test 8 — VERIFY units remain internal, no null tool', () => {
  const units = decomposeGoalToExecutionUnits({
    objective: 'Create src/verify-test.js',
    verifiedPlanningContext: createBasicContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' },
    explicitRequestedNewFiles: ['src/verify-test.js']
  });

  const verifyUnits = units.filter(u => u.type === 'VERIFY');
  assert.equal(verifyUnits.length, 1, 'Should have exactly 1 VERIFY unit');
  assert.equal(verifyUnits[0].authoritySource, 'verified_planning_context');
  assert.ok(verifyUnits[0].completionPredicate, 'VERIFY should have completionPredicate');
});

// Test 9: WRITE_CANDIDATE_COUNT log reflects correct counts
test('Phase 4.30-HF1 Test 9 — WRITE_CANDIDATE_COUNT reflects correct counts', () => {
  const plan = createExecutionPlanner({
    objective: 'Create src/a.js and src/b.js',
    verifiedPlanningContext: createBasicContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' },
    explicitRequestedNewFiles: ['src/a.js', 'src/b.js']
  });

  const writeTasks = plan.tasks.filter(t => t.tool === 'WRITE_FILE');
  assert.equal(writeTasks.length, 2, 'Expected 2 WRITE_FILE tasks');
  assert.equal(plan.rejectedUnits.length, 0, 'No units should be rejected');
});

// Test 10: No implicit ANALYZE when explicit writes present
test('Phase 4.30-HF1 Test 10 — no implicit ANALYZE when explicit write requests present', () => {
  const units = decomposeGoalToExecutionUnits({
    objective: 'Create src/new-module.js',
    verifiedPlanningContext: createBasicContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' },
    explicitRequestedNewFiles: ['src/new-module.js']
  });

  const analyzeUnits = units.filter(u => u.type === 'ANALYZE');
  assert.equal(analyzeUnits.length, 0, 'No ANALYZE unit should be created when explicit writes are present');
  const writeUnits = units.filter(u => u.type === 'WRITE');
  assert.equal(writeUnits.length, 1, 'Should have exactly 1 WRITE unit');
});
