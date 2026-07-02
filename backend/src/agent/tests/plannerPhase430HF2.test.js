import test from 'node:test';
import assert from 'node:assert/strict';

import { createExecutionPlanner } from '../executionPlanner/executionPlanner.js';
import { decomposeGoalToExecutionUnits } from '../executionPlanner/goalDecomposer.js';
import { validatePlannerAuthority } from '../executionPlanner/plannerAuthorityFirewall.js';

function createBasicContext() {
  return {
    verifiedFiles: [],
    verifiedCommands: ['npm test'],
    facts: { requestedFiles: [], entryFiles: [] },
    explicitRequestedNewFiles: []
  };
}

// Test 1: Single explicit file produces WRITE candidate with explicit_user_request
test('Phase 4.30-HF2 Test 1 — single explicit file produces WRITE candidate with explicit_user_request', () => {
  const plan = createExecutionPlanner({
    objective: 'Create src/math.js',
    verifiedPlanningContext: createBasicContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' },
    explicitRequestedNewFiles: ['src/math.js']
  });

  assert.ok(plan.tasks.length >= 1, 'Should have at least one task');
  const writeTasks = plan.tasks.filter(t => t.tool === 'WRITE_FILE');
  assert.equal(writeTasks.length, 1, 'Expected exactly 1 WRITE_FILE task');
  const task = writeTasks[0];
  const path = task.targetFiles?.[0] || task.toolArgs?.path || '';
  assert.equal(path, 'src/math.js', 'WRITE task must target src/math.js');
  assert.equal(task.authoritySource, 'explicit_user_request', 'Authority must be explicit_user_request');
  assert.equal(task.unitType, 'WRITE', 'Task must be WRITE type');
  assert.equal(task.approvedByFirewall, true, 'Task must be approved by firewall');
  assert.equal(plan.rejectedUnits.length, 0, 'No units should be rejected');
});

// Test 2: Multiple explicit files produce WRITE, WRITE, VERIFY — candidateCount = 3
test('Phase 4.30-HF2 Test 2 — multiple explicit files produce WRITE, WRITE, VERIFY — candidateCount 3', () => {
  const units = decomposeGoalToExecutionUnits({
    objective: 'Create src/math.js, src/math.test.js',
    verifiedPlanningContext: {
      verifiedFiles: [],
      verifiedCommands: [],
      facts: { requestedFiles: [], entryFiles: [] },
      explicitRequestedNewFiles: []
    },
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' },
    explicitRequestedNewFiles: ['src/math.js', 'src/math.test.js']
  });

  const writeUnits = units.filter(u => u.type === 'WRITE');
  const verifyUnits = units.filter(u => u.type === 'VERIFY');
  const analyzeUnits = units.filter(u => u.type === 'ANALYZE');

  assert.equal(writeUnits.length, 2, 'Should have exactly 2 WRITE units');
  assert.equal(analyzeUnits.length, 0, 'No ANALYZE unit should be created when explicit writes exist');
  assert.equal(verifyUnits.length, 1, 'Should have exactly 1 VERIFY unit');
  // Multiply non-VERIFY units + 1 VERIFY = total. With no verifiedCommands, no VALIDATE.
  // WRITE + WRITE + VERIFY = 3 non-VERIFY units + 1 VERIFY
  const expectedTotal = 3;
  assert.equal(units.filter(u => u.type !== 'VERIFY').length + 1, expectedTotal,
    `Expected total unit count of ${expectedTotal}`);

  // Verify each WRITE unit has correct fields
  writeUnits.forEach(u => {
    assert.equal(u.authoritySource, 'explicit_user_request', 'Each WRITE unit must have explicit_user_request authority');
    assert.equal(u.metadata?.explicitUserRequest, true, 'Each WRITE unit must have explicitUserRequest metadata');
    assert.equal(u.metadata?.plannedNewFile, true, 'Each WRITE unit must be marked as plannedNewFile');
  });
});

// Test 3: Authority propagation survives until ExecutionUnit
test('Phase 4.30-HF2 Test 3 — explicit_user_request authority survives pipeline to ExecutionUnit', () => {
  const plan = createExecutionPlanner({
    objective: 'Create src/pipeline-check.js',
    verifiedPlanningContext: createBasicContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' },
    explicitRequestedNewFiles: ['src/pipeline-check.js']
  });

  // Check units (ExecutionUnits from graph)
  const writeUnits = plan.units.filter(u => u.type === 'WRITE');
  assert.equal(writeUnits.length, 1, 'Should have exactly 1 WRITE unit');
  const unit = writeUnits[0];
  // authoritySource could be on the unit itself or in metadata
  const source = unit.authoritySource || unit.metadata?.authoritySource || '';
  assert.equal(source, 'explicit_user_request', 'WRITE unit must retain explicit_user_request');

  // Check promoted tasks
  const writeTasks = plan.tasks.filter(t => t.tool === 'WRITE_FILE');
  assert.equal(writeTasks.length, 1, 'Should have exactly 1 WRITE_FILE task');
  const task = writeTasks[0];
  assert.equal(task.authoritySource, 'explicit_user_request', 'WRITE task must preserve explicit_user_request');
  assert.equal(task.approvedByFirewall, true, 'Task must be approved by firewall');

  // No rejected units
  assert.equal(plan.rejectedUnits.length, 0, 'No units should be rejected');
});

// Test 4: Protected scope — src/math.js is NOT protected, must be allowed
test('Phase 4.30-HF2 Test 4 — src/math.js is NOT protected, allowed through', () => {
  // Direct firewall check
  const candidate = {
    id: 'write:src/math.js',
    type: 'WRITE',
    targetFiles: ['src/math.js'],
    requiredWrites: ['src/math.js'],
    tool: 'WRITE_FILE',
    authoritySource: 'explicit_user_request',
    authorityState: 'candidate',
    metadata: { explicitUserRequest: true, requestedFile: true }
  };

  const result = validatePlannerAuthority(candidate, {
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true },
    canonicalFileUniverse: [],
    verifiedPlanningContext: { verifiedFiles: [], verifiedCommands: [] }
  });

  assert.equal(result.valid, true, 'src/math.js must be approved — NOT a protected file');
  assert.equal(result.reason, null, 'No rejection reason');
  assert.equal(result.source, 'explicit_user_request', 'Authority must remain explicit_user_request');

  // Now test through full planner pipeline
  const plan = createExecutionPlanner({
    objective: 'Create src/math.js',
    verifiedPlanningContext: createBasicContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' },
    explicitRequestedNewFiles: ['src/math.js']
  });

  assert.equal(plan.rejectedUnits.length, 0, 'src/math.js must NOT be rejected');
  const writeTasks = plan.tasks.filter(t => t.tool === 'WRITE_FILE');
  assert.equal(writeTasks.length, 1, 'Should produce a WRITE task for src/math.js');
  const mathTask = writeTasks.find(t => {
    const p = t.targetFiles?.[0] || t.toolArgs?.path || '';
    return p === 'src/math.js';
  });
  assert.ok(mathTask, 'src/math.js WRITE task must exist');
});

// Test 5: Protected scope — package.json explicit request must apply package policy
test('Phase 4.30-HF2 Test 5 — package.json explicit request is approved (explicit bypasses protected scope)', () => {
  const plan = createExecutionPlanner({
    objective: 'Create package.json with test script',
    verifiedPlanningContext: createBasicContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' },
    explicitRequestedNewFiles: ['package.json']
  });

  const writeTasks = plan.tasks.filter(t => t.tool === 'WRITE_FILE');
  const pkgTask = writeTasks.find(t => {
    const p = t.targetFiles?.[0] || t.toolArgs?.path || '';
    return p === 'package.json';
  });
  assert.ok(pkgTask, 'package.json explicit request should produce a WRITE task');
  assert.equal(pkgTask.authoritySource, 'explicit_user_request', 'package.json task must retain explicit_user_request');
  assert.equal(pkgTask.approvedByFirewall, true, 'package.json explicit request must be approved by firewall');
  assert.equal(plan.rejectedUnits.length, 0, 'No units rejected');

  // Verify src/math.js does NOT get package policy applied (it should just be allowed as normal)
  const plan2 = createExecutionPlanner({
    objective: 'Create src/math.js',
    verifiedPlanningContext: createBasicContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' },
    explicitRequestedNewFiles: ['src/math.js']
  });

  const mathTasks = plan2.tasks.filter(t => t.tool === 'WRITE_FILE');
  assert.ok(mathTasks.length > 0, 'src/math.js must still produce WRITE tasks');
  assert.equal(plan2.rejectedUnits.length, 0, 'src/math.js must not be rejected');
});

// Test 6: Planner Debug — WRITE candidate displayed, not ANALYZE
test('Phase 4.30-HF2 Test 6 — units contain WRITE not ANALYZE for explicit request', () => {
  const units = decomposeGoalToExecutionUnits({
    objective: 'Create src/debug-test.js',
    verifiedPlanningContext: {
      verifiedFiles: [],
      verifiedCommands: [],
      facts: { requestedFiles: [], entryFiles: [] },
      explicitRequestedNewFiles: []
    },
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' },
    explicitRequestedNewFiles: ['src/debug-test.js']
  });

  const unitTypes = units.map(u => u.type);
  assert.ok(unitTypes.includes('WRITE'), 'WRITE units must be present');
  assert.ok(!unitTypes.includes('ANALYZE'), 'ANALYZE must NOT be present when explicit writes exist');
  assert.ok(unitTypes.includes('VERIFY'), 'VERIFY unit must be present');
  assert.equal(unitTypes.filter(t => t === 'WRITE').length, 1, 'Exactly 1 WRITE unit');

  // WRITE unit must have explicit_user_request
  const writeUnit = units.find(u => u.type === 'WRITE');
  assert.equal(writeUnit.authoritySource, 'explicit_user_request', 'WRITE unit must have explicit_user_request');
  assert.equal(writeUnit.metadata?.explicitUserRequest, true);
});

// Test 7: Regression — Landing page prompt still produces proposals, not WRITE tasks
test('Phase 4.30-HF2 Test 7 — Landing page prompt produces proposals, not WRITE tasks', () => {
  const plan = createExecutionPlanner({
    objective: 'Build a premium SaaS landing page',
    verifiedPlanningContext: createBasicContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: false },
    projectIntent: { goalType: 'SAAS_APP' },
    projectScan: { projectType: 'node' },
    explicitRequestedNewFiles: []
  });

  const writeTasks = plan.tasks.filter(t => t.tool === 'WRITE_FILE' || t.tool === 'APPLY_PATCH');
  const hasHardcodedLandingFiles = writeTasks.some(t => {
    const path = t.targetFiles?.[0] || t.toolArgs?.path || '';
    return path.includes('Hero.jsx') || path.includes('Features.jsx') || path.includes('Pricing.jsx');
  });
  assert.equal(hasHardcodedLandingFiles, false, 'Landing page must not produce hardcoded WRITE tasks');
});

// Test 8: Regression — HF1 recovery passes (WRITE candidates created correctly)
test('Phase 4.30-HF2 Test 8 — HF1 recovery regression: WRITE candidates created correctly', () => {
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
  assert.equal(plan.rejectedUnits.length, 0, 'No rejected units');
});

// Test 9: Regression — HF2 raw validation: WRITE candidates survive firewall
test('Phase 4.30-HF2 Test 9 — HF2 raw validation: explicit WRITE survives firewall individually', () => {
  const candidate1 = {
    id: 'write:src/math.js',
    type: 'WRITE',
    targetFiles: ['src/math.js'],
    requiredWrites: ['src/math.js'],
    tool: 'WRITE_FILE',
    authoritySource: 'explicit_user_request',
    authorityState: 'candidate',
    metadata: { explicitUserRequest: true, requestedFile: true, plannedNewFile: true }
  };

  const candidate2 = {
    id: 'write:src/math.test.js',
    type: 'WRITE',
    targetFiles: ['src/math.test.js'],
    requiredWrites: ['src/math.test.js'],
    tool: 'WRITE_FILE',
    authoritySource: 'explicit_user_request',
    authorityState: 'candidate',
    metadata: { explicitUserRequest: true, requestedFile: true, plannedNewFile: true }
  };

  const context = {
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true },
    canonicalFileUniverse: [],
    verifiedPlanningContext: { verifiedFiles: [], verifiedCommands: [] }
  };

  const r1 = validatePlannerAuthority(candidate1, context);
  assert.equal(r1.valid, true, 'src/math.js must be approved by firewall');
  assert.equal(r1.source, 'explicit_user_request', 'Authority must remain explicit_user_request');

  const r2 = validatePlannerAuthority(candidate2, context);
  assert.equal(r2.valid, true, 'src/math.test.js must be approved by firewall');
  assert.equal(r2.source, 'explicit_user_request', 'Authority must remain explicit_user_request');

  // Neither file should trigger protected file rejection
  assert.equal(r1.reason, null, 'src/math.js must have no rejection reason');
  assert.equal(r2.reason, null, 'src/math.test.js must have no rejection reason');
});

// Test 10: Regression — VERIFY remains internal, tool:null impossible
test('Phase 4.30-HF2 Test 10 — VERIFY remains internal, no null tool in promoted tasks', () => {
  const plan = createExecutionPlanner({
    objective: 'Create src/math.js src/math.test.js',
    verifiedPlanningContext: createBasicContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' },
    explicitRequestedNewFiles: ['src/math.js', 'src/math.test.js']
  });

  // VERIFY should NOT be promoted to a task (internal to ExecutionGraph)
  const verifyTasks = plan.tasks.filter(t => t.unitType === 'VERIFY');
  assert.equal(verifyTasks.length, 0, 'VERIFY units must NOT be promoted to tasks');

  // No task should have null tool
  const nullToolTasks = plan.tasks.filter(t => !t.tool);
  assert.equal(nullToolTasks.length, 0, 'No task should have null/undefined tool');

  // All promoted tasks must have valid tools
  const allToolsValid = plan.tasks.every(t => Boolean(t.tool));
  assert.equal(allToolsValid, true, 'All promoted tasks must have valid tools');

  // WRITE tasks must have WRITE_FILE tool
  const writeTasks = plan.tasks.filter(t => t.unitType === 'WRITE');
  assert.ok(writeTasks.length >= 2, 'Should have at least 2 WRITE tasks');
  writeTasks.forEach(t => {
    assert.equal(t.tool, 'WRITE_FILE', 'WRITE unit must map to WRITE_FILE tool');
  });
});
