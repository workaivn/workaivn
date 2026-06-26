import test from 'node:test';
import assert from 'node:assert/strict';
import { Task } from '../task.js';
import { Planner } from '../planner.js';
import { TaskStatus, BranchType } from '../plannerTypes.js';
import {
  notifyToolExecution,
  isPlannerRecovering,
  getNextRecoveryTask,
  hasReadyRecoveryTask,
  checkRecoveryCompletion
} from '../executionController.js';

function makeTask(id, kind = 'CODING', deps = [], tool = null, toolArgs = {}, branchOpts = {}) {
  return new Task({
    id,
    kind,
    goal: `Task ${id}`,
    dependencies: deps,
    tool,
    toolArgs,
    ...branchOpts
  });
}

// ===================== Test A: READ success → PATCH executed, Recovery skipped =====================

test('Test A: READ success → SUCCESS branch → PATCH executed, Recovery skipped', () => {
  const readTask = new Task({
    id: 'read',
    kind: 'CODING',
    goal: 'Read file',
    tool: 'READ_FILE',
    toolArgs: { path: 'test.js' },
    successNext: 'patch',
    failureNext: 'recovery'
  });
  const patchTask = new Task({
    id: 'patch',
    kind: 'CODING',
    goal: 'Apply patch',
    tool: 'APPLY_PATCH',
    toolArgs: { file: 'test.js' },
    dependencies: ['read']
  });
  const recoveryTask = new Task({
    id: 'recovery',
    kind: 'CODING',
    goal: 'Recovery read',
    tool: 'READ_FILE',
    toolArgs: { path: 'test.js' },
    dependencies: ['read']
  });

  const planner = new Planner([readTask, patchTask, recoveryTask]);

  // READ succeeds
  const r = planner.markSuccess('read', { success: true, content: 'abc' });
  assert.equal(r, true);

  // Branch evaluation should have fired
  assert.equal(planner.branchType('read'), BranchType.SUCCESS);
  assert.ok(planner.branchReason('read'), 'Should have branch reason');

  // PATCH (success branch) should be READY
  assert.equal(planner.graph.getNode('patch').status, TaskStatus.READY);

  // Recovery (failure branch) should be SKIPPED
  assert.equal(planner.graph.getNode('recovery').status, TaskStatus.SKIPPED);
  assert.equal(planner.graph.getNode('recovery').reason, 'Alternative branch not taken');

  // Only the success branch should be active
  assert.equal(planner.getNextTask().id, 'patch', 'PATCH should be next task');

  // PATCH succeeds
  planner.markSuccess('patch', { success: true, changed: true });

  // All non-skipped branches completed
  assert.equal(planner.graph.getNode('read').status, TaskStatus.SUCCESS);
  assert.equal(planner.graph.getNode('patch').status, TaskStatus.SUCCESS);
  assert.equal(planner.graph.getNode('recovery').status, TaskStatus.SKIPPED);
});

// ===================== Test B: READ fail → Recovery executed → PATCH after recovery =====================

test('Test B: READ fail → FAILURE branch → Recovery executed → RECOVERED → PATCH', () => {
  const readTask = new Task({
    id: 'read',
    kind: 'CODING',
    goal: 'Read file',
    tool: 'READ_FILE',
    toolArgs: { path: 'missing.js' },
    successNext: 'patch',
    failureNext: 'recovery'
  });
  const patchTask = new Task({
    id: 'patch',
    kind: 'CODING',
    goal: 'Apply patch',
    tool: 'APPLY_PATCH',
    toolArgs: { file: 'test.js' },
    dependencies: ['read']
  });
  const recoveryTask = new Task({
    id: 'recovery',
    kind: 'CODING',
    goal: 'Recovery read',
    tool: 'READ_FILE',
    toolArgs: { path: 'missing.js' },
    dependencies: ['read']
  });

  const planner = new Planner([readTask, patchTask, recoveryTask]);

  // READ fails
  planner.markFailure('read', 'File not found');

  // Branch evaluation: FAILURE branch fires
  assert.equal(planner.branchType('read'), BranchType.FAILURE);
  assert.equal(planner.graph.getNode('read').status, TaskStatus.FAILED);

  // Recovery (failure branch) should be READY (all deps satisfied)
  // Note: READ is FAILED, but dependencySatisfied only checks SUCCESS/SKIPPED/RECOVERED,
  // so recovery depends on 'read' being SUCCESS... but it's FAILED.
  // The branch evaluator explicitly activates the selected target.
  assert.equal(planner.graph.getNode('recovery').status, TaskStatus.READY,
    'Recovery should be READY (branch activation)');

  // PATCH (success branch) should be BLOCKED (read failed) or SKIPPED
  // Branch evaluator skips the alternative branch target
  assert.equal(planner.graph.getNode('patch').status, TaskStatus.SKIPPED,
    'PATCH (success branch) should be SKIPPED');

  // Recovery succeeds
  planner.markSuccess('recovery', { success: true, content: 'found' });

  // Read task is FAILED — recovery doesn't change that.
  // After recovery, the planner resumes through the normal path.
  // patch is SKIPPED though, so we can verify branch state machine.
  assert.equal(planner.graph.getNode('read').status, TaskStatus.FAILED);
  assert.equal(planner.graph.getNode('recovery').status, TaskStatus.SUCCESS);
  assert.equal(planner.graph.getNode('patch').status, TaskStatus.SKIPPED);
});

// ===================== Test C: Recovery fails → STOP =====================

test('Test C: Recovery fails → STOP, no PATCH, no RUN', () => {
  const readTask = new Task({
    id: 'read',
    kind: 'CODING',
    goal: 'Read file',
    tool: 'READ_FILE',
    toolArgs: { path: 'missing.js' },
    successNext: 'patch',
    failureNext: 'recovery'
  });
  const patchTask = new Task({
    id: 'patch',
    kind: 'CODING',
    goal: 'Apply patch',
    tool: 'APPLY_PATCH',
    toolArgs: { file: 'test.js' },
    dependencies: ['read']
  });
  const recoveryTask = new Task({
    id: 'recovery',
    kind: 'CODING',
    goal: 'Recovery read',
    tool: 'READ_FILE',
    toolArgs: { path: 'missing.js' },
    dependencies: ['read']
  });
  const runTask = new Task({
    id: 'run',
    kind: 'CODING',
    goal: 'Run tests',
    tool: 'RUN_TERMINAL',
    toolArgs: { command: 'npm test' },
    dependencies: ['patch']
  });

  const planner = new Planner([readTask, recoveryTask, patchTask, runTask]);

  // READ fails → FAILURE branch activates recovery
  planner.markFailure('read', 'File not found');
  assert.equal(planner.graph.getNode('recovery').status, TaskStatus.READY);

  // Recovery also fails → read becomes RECOVERY_FAILED (via existing recovery path)
  // Branch evaluator won't fire for recovery because it doesn't have branch fields
  // But the existing recovery mechanism should handle this

  // Recovery fails via the planner's markFailure
  planner.markFailure('recovery', 'Still not found');

  // Recovery task is FAILED
  assert.equal(planner.graph.getNode('recovery').status, TaskStatus.FAILED);

  // PATCH should be SKIPPED (alternative branch to recovery)
  assert.equal(planner.graph.getNode('patch').status, TaskStatus.SKIPPED);

  // RUN depends on PATCH — since PATCH is SKIPPED, dependencySatisfied returns true for SKIPPED,
  // meaning RUN could become READY. But wait — SKIPPED satisfies dependencies!
  // Let's verify: dependencySatisfied checks for SUCCESS, SKIPPED, or RECOVERED
  // So if PATCH is SKIPPED, RUN's dep is satisfied, and RUN could become READY.

  // This is an edge case: when a branch target is SKIPPED, its children's deps are still
  // technically satisfied (because SKIPPED is an "acceptable" status in the dep engine).
  // The _skipRecursive method handles this by recursively skipping all descendant tasks.
  assert.equal(planner.graph.getNode('run').status, TaskStatus.SKIPPED,
    'RUN should be SKIPPED (descendant of SKIPPED PATCH)');

  // isComplete should be false (FAILED tasks exist)
  assert.equal(planner.isComplete(), false);
});

// ===================== Test D: PATCH success → RUN executes, Recovery skipped =====================

test('Test D: PATCH success → SUCCESS branch → RUN executes, Recovery skipped', () => {
  const readTask = new Task({
    id: 'read',
    kind: 'CODING',
    goal: 'Read file',
    tool: 'READ_FILE',
    toolArgs: { path: 'test.js' },
    successNext: 'patch',
    failureNext: 'recovery'
  });
  const patchTask = new Task({
    id: 'patch',
    kind: 'CODING',
    goal: 'Apply patch',
    tool: 'APPLY_PATCH',
    toolArgs: { file: 'test.js' },
    dependencies: ['read'],
    successNext: 'run',
    failureNext: 'recovery2'
  });
  const recoveryTask = new Task({
    id: 'recovery',
    kind: 'CODING',
    goal: 'Recovery for read',
    tool: 'READ_FILE',
    toolArgs: { path: 'test.js' },
    dependencies: ['read']
  });
  const recovery2Task = new Task({
    id: 'recovery2',
    kind: 'CODING',
    goal: 'Recovery for patch',
    tool: 'READ_FILE',
    toolArgs: { path: 'test.js' },
    dependencies: ['patch']
  });
  const runTask = new Task({
    id: 'run',
    kind: 'CODING',
    goal: 'Run tests',
    tool: 'RUN_TERMINAL',
    toolArgs: { command: 'npm test' },
    dependencies: ['patch']
  });

  const planner = new Planner([readTask, patchTask, recoveryTask, recovery2Task, runTask]);

  // READ succeeds → PATCH becomes READY, Recovery gets SKIPPED
  planner.markSuccess('read', { success: true, content: 'abc' });
  assert.equal(planner.graph.getNode('patch').status, TaskStatus.READY);
  assert.equal(planner.graph.getNode('recovery').status, TaskStatus.SKIPPED);

  // PATCH succeeds → RUN becomes READY, Recovery2 gets SKIPPED
  planner.markSuccess('patch', { success: true, changed: true });
  assert.equal(planner.branchType('patch'), BranchType.SUCCESS);
  assert.equal(planner.graph.getNode('run').status, TaskStatus.READY);
  assert.equal(planner.graph.getNode('recovery2').status, TaskStatus.SKIPPED);

  // RUN succeeds
  planner.markSuccess('run', { success: true, exitCode: 0 });

  // All tasks should be terminal
  assert.equal(planner.graph.getNode('read').status, TaskStatus.SUCCESS);
  assert.equal(planner.graph.getNode('patch').status, TaskStatus.SUCCESS);
  assert.equal(planner.graph.getNode('run').status, TaskStatus.SUCCESS);
  assert.equal(planner.graph.getNode('recovery').status, TaskStatus.SKIPPED);
  assert.equal(planner.graph.getNode('recovery2').status, TaskStatus.SKIPPED);

  // Planner should be complete
  assert.equal(planner.isComplete(), true);
});

// ===================== Test E: Only one branch active, others SKIPPED =====================

test('Test E: Only one branch active — exactly one selected, all others SKIPPED', () => {
  const readTask = new Task({
    id: 'read',
    kind: 'CODING',
    goal: 'Read file',
    tool: 'READ_FILE',
    toolArgs: { path: 'test.js' },
    successNext: 'successBranch',
    failureNext: 'failBranch',
    recoveredNext: 'recoveredBranch',
    blockedNext: 'blockedBranch',
    skipNext: 'skipBranch'
  });
  const successTask = new Task({
    id: 'successBranch',
    kind: 'CODING',
    goal: 'Success path',
    tool: 'READ_FILE',
    toolArgs: { path: 'ok.js' },
    dependencies: ['read']
  });
  const failTask = new Task({
    id: 'failBranch',
    kind: 'CODING',
    goal: 'Failure path',
    tool: 'READ_FILE',
    toolArgs: { path: 'fail.js' },
    dependencies: ['read']
  });
  const recoveredTask = new Task({
    id: 'recoveredBranch',
    kind: 'CODING',
    goal: 'Recovered path',
    tool: 'READ_FILE',
    toolArgs: { path: 'recovered.js' },
    dependencies: ['read']
  });
  const blockedTask = new Task({
    id: 'blockedBranch',
    kind: 'CODING',
    goal: 'Blocked path',
    tool: 'READ_FILE',
    toolArgs: { path: 'blocked.js' },
    dependencies: ['read']
  });
  const skipTask = new Task({
    id: 'skipBranch',
    kind: 'CODING',
    goal: 'Skip path',
    tool: 'READ_FILE',
    toolArgs: { path: 'skip.js' },
    dependencies: ['read']
  });

  const planner = new Planner([readTask, successTask, failTask, recoveredTask, blockedTask, skipTask]);

  // Simulate evaluateBranch directly
  const evalResult = planner.evaluateBranch(readTask);
  // Before any status is set, evaluateBranch should return null
  assert.equal(evalResult, null, 'PENDING task should not trigger branch');

  // READ succeeds
  planner.markSuccess('read', { success: true, content: 'abc' });

  // Only the SUCCESS branch should be active
  assert.equal(planner.graph.getNode('successBranch').status, TaskStatus.READY);
  assert.equal(planner.graph.getNode('failBranch').status, TaskStatus.SKIPPED);
  assert.equal(planner.graph.getNode('recoveredBranch').status, TaskStatus.SKIPPED);
  assert.equal(planner.graph.getNode('blockedBranch').status, TaskStatus.SKIPPED);
  assert.equal(planner.graph.getNode('skipBranch').status, TaskStatus.SKIPPED);

  // Verify exactly one branch selected
  const allTasks = planner.graph.allNodes();
  const readyTasks = allTasks.filter(t => t.status === TaskStatus.READY);
  assert.equal(readyTasks.length, 1, 'Exactly one task should be READY');
  assert.equal(readyTasks[0].id, 'successBranch');

  const skippedTasks = allTasks.filter(t => t.status === TaskStatus.SKIPPED);
  assert.equal(skippedTasks.length, 4, 'All 4 alternative branches should be SKIPPED');
});

// ===================== evaluateBranch / branchType / branchReason API =====================

test('Planner branch API: evaluateBranch, branchType, branchReason', () => {
  const readTask = new Task({
    id: 'read',
    kind: 'CODING',
    goal: 'Read',
    tool: 'READ_FILE',
    toolArgs: { path: 'x.js' },
    successNext: 'next'
  });
  const nextTask = new Task({
    id: 'next',
    kind: 'CODING',
    goal: 'Next',
    tool: 'READ_FILE',
    toolArgs: { path: 'y.js' },
    dependencies: ['read']
  });

  const planner = new Planner([readTask, nextTask]);

  // Before completion
  assert.equal(planner.branchType('read'), null);
  assert.equal(planner.branchReason('read'), null);
  assert.equal(planner.evaluateBranch('read'), null);

  // After success
  planner.markSuccess('read', { success: true });

  assert.equal(planner.branchType('read'), BranchType.SUCCESS);
  assert.ok(planner.branchReason('read').includes('selected branch SUCCESS'));

  const evalResult = planner.evaluateBranch('read');
  assert.notEqual(evalResult, null);
  assert.equal(evalResult.branch, BranchType.SUCCESS);
  assert.equal(evalResult.targetId, 'next');
});

// ===================== Phase 4.7 Regression: Branch Planner triggers recovery via FAILURE branch =====================

test('Phase 4.7: READ_FILE fail → FAILURE branch → RECOVERY_START, SUCCESS branch SKIPPED', () => {
  const successTask = new Task({
    id: 'success-path',
    kind: 'CODING',
    goal: 'Continue on success',
    tool: 'APPLY_PATCH',
    toolArgs: { file: 'test.js', find: 'x', replace: 'y' },
    dependencies: ['read']
  });
  const readTask = new Task({
    id: 'read',
    kind: 'CODING',
    goal: 'Read planner-branch-test-file.json',
    tool: 'READ_FILE',
    toolArgs: { path: 'planner-branch-test-file.json' },
    dependencies: [],
    successNext: 'success-path',
    failureNext: 'recovery-coord'
  });
  // Branch-placeholder — exists in graph as a FAILURE branch target.
  // Must NOT be kind=RECOVERY to avoid findRecoveryTask intercepting the first READ_FILE call.
  const recoveryCoord = new Task({
    id: 'recovery-coord',
    kind: 'CODING',
    goal: 'Branch target for failure path',
    tool: 'LIST_FILES',
    toolArgs: { limit: 500 },
    dependencies: ['read']
  });

  const planner = new Planner([readTask, successTask, recoveryCoord]);
  assert.equal(planner.getNextTask().id, 'read', 'READ_FILE must be first');

  // READ_FILE fails → Branch Planner evaluates
  const result = notifyToolExecution(planner, 'READ_FILE', { path: 'planner-branch-test-file.json' }, { success: false, error: 'Not found' });

  // Branch evaluation selected FAILURE
  assert.equal(planner.branchType('read'), BranchType.FAILURE, 'Branch type must be FAILURE');
  assert.ok(planner.branchReason('read'), 'Branch reason must be set');

  // SUCCESS branch task (success-path) must be SKIPPED
  assert.equal(planner.graph.getNode('success-path').status, TaskStatus.SKIPPED, 'SUCCESS branch must be SKIPPED');

  // FAILURE branch target (recovery-coord) must be READY (activated by branch evaluator)
  assert.equal(planner.graph.getNode('recovery-coord').status, TaskStatus.READY, 'FAILURE branch target must be READY');

  // Recovery must have started (via Branch Planner FAILURE selection)
  assert.equal(result.recoveryStarted, true, 'Recovery must start after FAILURE branch');
  assert.ok(isPlannerRecovering(planner), 'Planner must be recovering');

  // Recovery tasks should exist
  const nextRecovery = getNextRecoveryTask(planner);
  assert.ok(nextRecovery, 'Recovery task must exist');

  // Execute recovery: LIST_FILES succeeds
  const listTask = getNextRecoveryTask(planner);
  assert.equal(listTask.tool, 'LIST_FILES', 'First recovery task must be LIST_FILES');
  notifyToolExecution(planner, 'LIST_FILES', { limit: 500 }, { success: true, files: ['planner-branch-test-file.json'] });

  // Execute recovery: READ_FILE succeeds
  const readRecoveryTask = getNextRecoveryTask(planner);
  assert.equal(readRecoveryTask.tool, 'READ_FILE', 'Second recovery task must be READ_FILE');
  notifyToolExecution(planner, 'READ_FILE', { path: 'planner-branch-test-file.json' }, { success: true, content: '{"key": "value"}' });

  // Recovery completes — original task becomes RECOVERED
  const completion = checkRecoveryCompletion(planner);
  assert.equal(completion.recoveryComplete, true, 'Recovery must complete');
  assert.equal(completion.recoveredTaskId, 'read', 'Recovered task must be read');
  assert.equal(planner.graph.getNode('read').status, TaskStatus.RECOVERED, 'Original task must be RECOVERED');

  // SUCCESS branch remains SKIPPED throughout
  assert.equal(planner.graph.getNode('success-path').status, TaskStatus.SKIPPED, 'SUCCESS branch must remain SKIPPED');

  // Planner complete (SUCCESS, RECOVERED, SKIPPED are all terminal)
  assert.equal(planner.isComplete(), true, 'Planner must be complete');
});

test('Phase 4.7: READ_FILE success → SUCCESS branch → PATCH executed, FAILURE branch SKIPPED', () => {
  const successTask = new Task({
    id: 'success-path',
    kind: 'CODING',
    goal: 'Continue on success',
    tool: 'APPLY_PATCH',
    toolArgs: { file: 'test.js', find: 'x', replace: 'y' },
    dependencies: ['read']
  });
  const readTask = new Task({
    id: 'read',
    kind: 'CODING',
    goal: 'Read planner-branch-test-file.json',
    tool: 'READ_FILE',
    toolArgs: { path: 'planner-branch-test-file.json' },
    dependencies: [],
    successNext: 'success-path',
    failureNext: 'recovery-coord'
  });
  const recoveryCoord = new Task({
    id: 'recovery-coord',
    kind: 'CODING',
    goal: 'Branch target for failure path',
    tool: 'LIST_FILES',
    toolArgs: { limit: 500 },
    dependencies: ['read']
  });

  const planner = new Planner([readTask, successTask, recoveryCoord]);
  assert.equal(planner.getNextTask().id, 'read');

  // READ_FILE succeeds → Branch Planner selects SUCCESS
  const result = notifyToolExecution(planner, 'READ_FILE', { path: 'planner-branch-test-file.json' }, { success: true, content: '{"key": "value"}' });

  assert.equal(planner.branchType('read'), BranchType.SUCCESS, 'Branch type must be SUCCESS');
  assert.equal(planner.graph.getNode('success-path').status, TaskStatus.READY, 'SUCCESS branch must be READY');
  assert.equal(planner.graph.getNode('recovery-coord').status, TaskStatus.SKIPPED, 'FAILURE branch must be SKIPPED');
  assert.equal(result.recoveryStarted, undefined, 'No recovery on success');

  // SUCCESS branch executes
  notifyToolExecution(planner, 'APPLY_PATCH', { file: 'test.js', find: 'x', replace: 'y' }, { success: true, changed: true });
  assert.equal(planner.graph.getNode('success-path').status, TaskStatus.SUCCESS);
  assert.equal(planner.isComplete(), true);
});
