import test from 'node:test';
import assert from 'node:assert/strict';

import { createExecutionPlanner } from '../executionPlanner/executionPlanner.js';
import { decomposeGoalToExecutionUnits } from '../executionPlanner/goalDecomposer.js';
import { buildPlanningContext } from '../planner/context/PlanningContextBuilder.js';
import { VerifiedPlanningContext } from '../planner/context/VerifiedPlanningContext.js';
import { validatePlannerAuthority } from '../executionPlanner/plannerAuthorityFirewall.js';
import { promoteProposalGraphToTasks } from '../planner/proposals/index.js';
import { checkProposalGraphAuthority, checkValidationCommandCandidate } from '../planner/context/PlannerAuthorityFirewall.js';

function createBasicVerifiedContext() {
  return {
    verifiedFiles: [],
    verifiedCommands: [],
    facts: { requestedFiles: [], entryFiles: [] },
    explicitRequestedNewFiles: []
  };
}

test('Phase 4.30 Test 1 — Explicit create file authority', () => {
  const plan = createExecutionPlanner({
    objective: 'Create src/math.js',
    verifiedPlanningContext: createBasicVerifiedContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' },
    explicitRequestedNewFiles: ['src/math.js']
  });

  assert.equal(plan.tasks.length >= 1, true);
  const writeTask = plan.tasks.find(t => t.tool === 'WRITE_FILE' && t.targetFiles?.includes('src/math.js'));
  assert.ok(writeTask, 'Expected WRITE_FILE task for src/math.js');
  assert.equal(writeTask.unitType, 'WRITE');
  assert.equal(writeTask.authoritySource, 'explicit_user_request');
});

test('Phase 4.30 Test 2 — Explicit create multiple files', () => {
  const plan = createExecutionPlanner({
    objective: 'Create src/math.js and src/math.test.js',
    verifiedPlanningContext: createBasicVerifiedContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' },
    explicitRequestedNewFiles: ['src/math.js', 'src/math.test.js']
  });

  assert.equal(plan.tasks.length >= 2, true);
  const writeFiles = plan.tasks.filter(t => t.tool === 'WRITE_FILE');
  assert.equal(writeFiles.length, 2);
  const paths = writeFiles.map(t => t.targetFiles?.[0] || t.toolArgs?.path).sort();
  assert.deepEqual(paths, ['src/math.js', 'src/math.test.js']);
  const schedule = plan.schedule;
  assert.ok(schedule.parallelGroups.length > 0);
});

test('Phase 4.30 Test 3 — Landing page remains proposal-only', () => {
  const plan = createExecutionPlanner({
    objective: 'Build a premium SaaS landing page',
    verifiedPlanningContext: createBasicVerifiedContext(),
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
  assert.equal(hasHardcodedLandingFiles, false);
});

test('Phase 4.30 Test 4 — package.json not inferred', () => {
  const plan = createExecutionPlanner({
    objective: 'Create src/math.js and run tests. Do not modify package.json unless necessary.',
    verifiedPlanningContext: createBasicVerifiedContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' },
    explicitRequestedNewFiles: ['src/math.js']
  });

  const writeFiles = plan.tasks.filter(t => t.tool === 'WRITE_FILE' || t.tool === 'APPLY_PATCH');
  const packageJsonWrite = writeFiles.some(t => {
    const path = t.targetFiles?.[0] || t.toolArgs?.path || '';
    return path.includes('package.json') || path.includes('package.js');
  });
  assert.equal(packageJsonWrite, false, 'package.json must not be a planned WRITE target');
});

test('Phase 4.30 Test 5 — package.json explicit create', () => {
  const plan = createExecutionPlanner({
    objective: 'Create package.json with a test script',
    verifiedPlanningContext: createBasicVerifiedContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' },
    explicitRequestedNewFiles: ['package.json']
  });

  const writeTask = plan.tasks.find(t => t.tool === 'WRITE_FILE');
  assert.ok(writeTask, 'Expected a WRITE_FILE task');
  const path = writeTask.targetFiles?.[0] || writeTask.toolArgs?.path || '';
  assert.equal(path.toLowerCase(), 'package.json');
  assert.equal(/^package\.js$/i.test(path), false, 'Must not become package.js');
});

test('Phase 4.30 Test 6 — package.json extension preservation', () => {
  const plan = createExecutionPlanner({
    objective: 'Create package.json, tsconfig.json, vite.config.ts, src/math.test.js',
    verifiedPlanningContext: createBasicVerifiedContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' },
    explicitRequestedNewFiles: ['package.json', 'tsconfig.json', 'vite.config.ts', 'src/math.test.js']
  });

  const writeFiles = plan.tasks.filter(t => t.tool === 'WRITE_FILE');
  const paths = writeFiles.map(t => t.targetFiles?.[0] || t.toolArgs?.path || '');
  const expected = ['package.json', 'tsconfig.json', 'vite.config.ts', 'src/math.test.js'];
  for (const exp of expected) {
    assert.ok(paths.includes(exp), `Expected ${exp} in write targets, got ${paths.join(', ')}`);
  }
  const packageJs = paths.some(p => /^package\.js$/.test(p));
  assert.equal(packageJs, false, 'package.js must never appear');
});

test('Phase 4.30 Test 7 — planner blocking new project without approval', () => {
  const units = decomposeGoalToExecutionUnits({
    objective: 'Build dashboard',
    verifiedPlanningContext: createBasicVerifiedContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_NEW_PROJECT_INITIALIZATION: false, ALLOW_NEW_FILE_CREATION: false },
    projectIntent: { goalType: 'DASHBOARD' },
    projectScan: { projectType: 'generic' },
    explicitRequestedNewFiles: []
  });

  const approvedWriteUnits = [];
  const rejectedUnits = [];
  for (const unit of units) {
    if (String(unit.type || '').toUpperCase() === 'ANALYZE' || String(unit.type || '').toUpperCase() === 'VERIFY') continue;
    const approval = validatePlannerAuthority(unit, { plannerPolicies: { ALLOW_NEW_PROJECT_INITIALIZATION: false, ALLOW_NEW_FILE_CREATION: false } });
    if (approval.valid) {
      approvedWriteUnits.push(unit);
    } else {
      rejectedUnits.push({ unitId: unit.id, reason: approval.reason });
    }
  }

  assert.equal(approvedWriteUnits.length, 0, 'No WRITE units should be approved without policies');
  assert.ok(rejectedUnits.length > 0, 'WRITE units should be rejected');
});

test('Phase 4.30 Test 8 — QualityGate no-task handling via plannerFatalBlock', () => {
  const plan = createExecutionPlanner({
    objective: 'Build a component library',
    verifiedPlanningContext: createBasicVerifiedContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: false, ALLOW_EXISTING_PROJECT_MODIFICATION: false },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'generic' },
    explicitRequestedNewFiles: []
  });

  const writeTasks = plan.tasks.filter(t => t.tool === 'WRITE_FILE' || t.tool === 'APPLY_PATCH');
  assert.equal(writeTasks.length, 0, 'No WRITE_FILE tasks should be approved without file creation policy');
  assert.ok((plan.rejectedUnits || []).length > 0 || plan.units.length <= 2, 'Write execution units should be rejected');
});

test('Phase 4.30 Test 9 — Explicit user authority validates authority source', () => {
  const candidate = {
    id: 'write:src/valid.js',
    type: 'WRITE',
    targetFiles: ['src/valid.js'],
    requiredWrites: ['src/valid.js'],
    tool: 'WRITE_FILE',
    authoritySource: 'explicit_user_request',
    authorityState: 'candidate',
    metadata: { explicitUserRequest: true }
  };

  const result = validatePlannerAuthority(candidate, {
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true },
    canonicalFileUniverse: []
  });

  assert.equal(result.valid, true, 'Explicit user request with valid path should be approved');
  assert.equal(result.source, 'explicit_user_request');
});

test('Phase 4.30 Test 10 — Regression: existing authorities still blocked', () => {
  const result = promoteProposalGraphToTasks({
    proposals: [
      {
        proposalId: 'model-proposal',
        proposalType: 'FILE',
        suggestedFiles: ['src/Hero.jsx'],
        source: 'model_output',
        authority: { source: 'model_output' }
      }
    ]
  }, {
    workspaceState: { existingFiles: [] },
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: false }
  });

  assert.equal(result.tasks.length, 0, 'Model output proposals must be rejected');
  assert.ok(result.rejected.length > 0 || result.diagnostics.length > 0, 'Should have rejection diagnostics');
});
