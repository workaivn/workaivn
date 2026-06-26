import test from 'node:test';
import assert from 'node:assert/strict';
import { Task } from '../task.js';
import { TaskNode } from '../taskNode.js';
import { Planner } from '../planner.js';
import { TaskStatus } from '../plannerTypes.js';
import { buildPlan } from '../planBuilder.js';
import { generateRecoveryPlan, determineRecoveryType } from '../recoveryPlanner.js';
import {
  notifyToolExecution,
  tryRecovery,
  canExecuteTool,
  isPlannerRecovering,
  hasReadyRecoveryTask,
  getNextRecoveryTask,
  checkRecoveryCompletion,
  hasRecoveryFailed
} from '../executionController.js';

function makeTask(id, kind, deps = [], tool = null, toolArgs = {}) {
  const task = new Task({ id, kind: kind || 'CODING', goal: `Task ${id}`, dependencies: deps, tool, toolArgs });
  // Phase 4.7: Enable FAILURE branch for tasks with tools so Branch Planner selects recovery on failure
  if (tool) {
    task.failureNext = 'recovery:' + id;
  }
  return task;
}

// ===================== Case A: READ_FILE fail → LIST_FILES → READ success =====================

test('Case A: READ_FILE fail triggers recovery with LIST_FILES and READ_FILE', () => {
  const planner = new Planner([
    makeTask('t1', 'CODING', [], 'READ_FILE', { path: 'missing-file.json' })
  ]);

  // First failure (retryCount = 0 initially, markFailure increments to 1)
  const result = notifyToolExecution(planner, 'READ_FILE', { path: 'missing-file.json' }, { success: false, error: 'File not found' });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.recoveryStarted, true, 'Recovery should start after failure');

  // Check that recovery tasks were added
  const all = planner.graph.allNodes();
  const recoveryTasks = all.filter(t => t.kind === 'RECOVERY');
  assert.equal(recoveryTasks.length, 2, 'Should have 2 recovery tasks');
  assert.equal(recoveryTasks[0].tool, 'LIST_FILES', 'First recovery task should be LIST_FILES');
  assert.equal(recoveryTasks[1].tool, 'READ_FILE', 'Second recovery task should be READ_FILE');

  // Check that the original task is RECOVERING
  const t1 = planner.graph.getNode('t1');
  assert.equal(t1.status, TaskStatus.RECOVERING);

  // Check that first recovery task is READY
  assert.equal(recoveryTasks[0].status, TaskStatus.READY);
  assert.equal(recoveryTasks[1].status, TaskStatus.PENDING);

  // Planner should indicate recovering
  assert.equal(isPlannerRecovering(planner), true);
  assert.equal(hasReadyRecoveryTask(planner), true);

  // Get next recovery task
  const next = getNextRecoveryTask(planner);
  assert.equal(next.id, recoveryTasks[0].id);
  assert.equal(next.tool, 'LIST_FILES');
});

test('Case A: LIST_FILES success then READ_FILE success completes recovery', () => {
  const planner = new Planner([
    makeTask('t1', 'CODING', [], 'READ_FILE', { path: 'missing-file.json' })
  ]);

  // Trigger failure + recovery
  notifyToolExecution(planner, 'READ_FILE', { path: 'missing-file.json' }, { success: false, error: 'File not found' });

  // Check original is RECOVERING
  assert.equal(planner.graph.getNode('t1').status, TaskStatus.RECOVERING);

  // Execute LIST_FILES recovery task (first one is READY)
  const searchTask = getNextRecoveryTask(planner);
  assert.ok(searchTask);
  assert.equal(searchTask.tool, 'LIST_FILES');

  // Notify LIST_FILES success
  const r1 = notifyToolExecution(planner, 'LIST_FILES', { limit: 500 }, { success: true, files: ['missing-file.json'] });
  assert.equal(r1.status, 'SUCCESS');

  // Second recovery task should now be READY
  const readTask = getNextRecoveryTask(planner);
  assert.ok(readTask);
  assert.equal(readTask.tool, 'READ_FILE');

  // Notify READ_FILE success
  const r2 = notifyToolExecution(planner, 'READ_FILE', { path: 'missing-file.json' }, { success: true, content: '{"found": true}' });
  assert.equal(r2.status, 'SUCCESS');

  // Check recovery completion
  const completion = checkRecoveryCompletion(planner);
  assert.equal(completion.recoveryComplete, true);
  assert.equal(completion.recoveredTaskId, 't1');

  // Original task should now be RECOVERED
  assert.equal(planner.graph.getNode('t1').status, TaskStatus.RECOVERED);
  assert.equal(isPlannerRecovering(planner), false);
});

// ===================== Case B: PATCH fail → READ latest → PATCH success =====================

test('Case B: APPLY_PATCH fail triggers recovery with READ_FILE and APPLY_PATCH', () => {
  const planner = new Planner([
    makeTask('t1', 'CODING', [], 'APPLY_PATCH', { file: 'test.js', find: 'old', replace: 'new' })
  ]);

  const result = notifyToolExecution(planner, 'APPLY_PATCH', { file: 'test.js', find: 'old', replace: 'new' }, { success: false, error: 'Patch failed: hunk not found' });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.recoveryStarted, true, 'Recovery should start after patch failure');

  const recoveryTasks = planner.graph.allNodes().filter(t => t.kind === 'RECOVERY');
  assert.equal(recoveryTasks.length, 2);
  assert.equal(recoveryTasks[0].tool, 'READ_FILE', 'First recovery task should be READ_FILE');
  assert.equal(recoveryTasks[1].tool, 'APPLY_PATCH', 'Second recovery task should be APPLY_PATCH');

  assert.equal(planner.graph.getNode('t1').status, TaskStatus.RECOVERING);
});

test('Case B: READ_FILE success then APPLY_PATCH success completes recovery', () => {
  const planner = new Planner([
    makeTask('t1', 'CODING', [], 'APPLY_PATCH', { file: 'test.js', find: 'old', replace: 'new' })
  ]);

  // Trigger failure + recovery
  notifyToolExecution(planner, 'APPLY_PATCH', { file: 'test.js', find: 'old', replace: 'new' }, { success: false, error: 'Patch failed' });

  // Execute READ_FILE recovery task
  const readTask = getNextRecoveryTask(planner);
  assert.ok(readTask);
  assert.equal(readTask.tool, 'READ_FILE');

  notifyToolExecution(planner, 'READ_FILE', { path: 'test.js' }, { success: true, content: 'old content' });

  // Execute APPLY_PATCH recovery task
  const patchTask = getNextRecoveryTask(planner);
  assert.ok(patchTask);
  assert.equal(patchTask.tool, 'APPLY_PATCH');

  notifyToolExecution(planner, 'APPLY_PATCH', { file: 'test.js', find: 'old', replace: 'new' }, { success: true, changed: true });

  // Check recovery completion
  const completion = checkRecoveryCompletion(planner);
  assert.equal(completion.recoveryComplete, true);
  assert.equal(planner.graph.getNode('t1').status, TaskStatus.RECOVERED);
  assert.equal(isPlannerRecovering(planner), false);
});

// ===================== Case C: Recovery fails → STOP =====================

test('Case C: Recovery task failure marks original as RECOVERY_FAILED', () => {
  const planner = new Planner([
    makeTask('t1', 'CODING', [], 'READ_FILE', { path: 'missing-file.json' })
  ]);

  // Trigger failure + recovery
  notifyToolExecution(planner, 'READ_FILE', { path: 'missing-file.json' }, { success: false, error: 'File not found' });

  // Execute first recovery task (LIST_FILES) but it fails
  const searchTask = getNextRecoveryTask(planner);
  assert.ok(searchTask);
  assert.equal(searchTask.tool, 'LIST_FILES');

  const result = notifyToolExecution(planner, 'LIST_FILES', { limit: 500 }, { success: false, error: 'No files found' });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.isRecovery, true);

  // Original task should now be RECOVERY_FAILED
  const t1 = planner.graph.getNode('t1');
  assert.equal(t1.status, TaskStatus.RECOVERY_FAILED, 'Original task should be RECOVERY_FAILED');

  // hasRecoveryFailed should return true
  assert.equal(hasRecoveryFailed(planner), true);

  // canExecuteTool should block everything
  assert.equal(canExecuteTool(planner, 'read').allowed, false, 'read tools should be blocked after RECOVERY_FAILED');
  assert.equal(canExecuteTool(planner, 'final').allowed, false);
  assert.equal(canExecuteTool(planner, 'terminal').allowed, false);
  assert.equal(canExecuteTool(planner, 'write').allowed, false);
  assert.equal(canExecuteTool(planner, 'final').recoveryFailed, true, 'final gate must report recoveryFailed');
  assert.equal(canExecuteTool(planner, undefined).allowed, false, 'even undefined toolType must be blocked');
});

test('Case C: Recovery failure blocks final completion', () => {
  const planner = new Planner([
    makeTask('t1', 'CODING', [], 'APPLY_PATCH', { file: 'test.js' })
  ]);

  // Trigger failure + recovery
  notifyToolExecution(planner, 'APPLY_PATCH', { file: 'test.js' }, { success: false, error: 'Patch failed' });

  // Execute first recovery task but it fails
  const readTask = getNextRecoveryTask(planner);
  assert.ok(readTask);
  notifyToolExecution(planner, 'READ_FILE', { path: 'test.js' }, { success: false, error: 'File not found' });

  // Original should be RECOVERY_FAILED
  assert.equal(planner.graph.getNode('t1').status, TaskStatus.RECOVERY_FAILED);

  // Recovery failure should be terminal — isComplete returns false
  assert.equal(planner.isComplete(), false);
});

// ===================== Edge Cases =====================

test('Recovery only triggers once per failed task', () => {
  const planner = new Planner([
    makeTask('t1', 'CODING', [], 'READ_FILE', { path: 'x.json' })
  ]);

  // First failure triggers recovery
  const r1 = notifyToolExecution(planner, 'READ_FILE', { path: 'x.json' }, { success: false, error: 'Not found' });
  assert.equal(r1.recoveryStarted, true);

  // Second call matches the RECOVERY task (PENDING, READ_FILE), not the original (RECOVERING).
  // This is not a new recovery attempt — it executes the recovery READ_FILE task.
  const r2 = notifyToolExecution(planner, 'READ_FILE', { path: 'x.json' }, { success: false, error: 'Still not found' });
  assert.equal(r2.isRecovery, true, 'Second call matches a recovery task');
  assert.equal(r2.recoveryStarted, undefined, 'Recovery task execution does not set recoveryStarted');

  // The recovery READ_FILE task failed → original becomes RECOVERY_FAILED
  assert.equal(planner.graph.getNode('t1').status, TaskStatus.RECOVERY_FAILED);
});

test('determineRecoveryType returns null for unknown tool', () => {
  const task = makeTask('t1', 'CODING', [], 'LIST_FILES', {});
  const type = determineRecoveryType(task);
  assert.equal(type, null);
});

test('generateRecoveryPlan returns empty tasks for unknown tool', () => {
  const task = makeTask('t1', 'CODING', [], 'LIST_FILES', {});
  const plan = generateRecoveryPlan(task);
  assert.equal(plan.recoveryType, null);
  assert.equal(plan.tasks.length, 0);
});

test('generateRecoveryPlan returns READ_FILE recovery strategy', () => {
  const task = makeTask('t1', 'CODING', [], 'READ_FILE', { path: 'test.json' });
  const plan = generateRecoveryPlan(task);
  assert.equal(plan.recoveryType, 'READ_FILE_RECOVERY');
  assert.equal(plan.tasks.length, 2);
  assert.equal(plan.tasks[0].tool, 'LIST_FILES');
  assert.equal(plan.tasks[1].tool, 'READ_FILE');
});

test('generateRecoveryPlan returns PATCH recovery strategy', () => {
  const task = makeTask('t1', 'CODING', [], 'APPLY_PATCH', { file: 'test.js', find: 'a', replace: 'b' });
  const plan = generateRecoveryPlan(task);
  assert.equal(plan.recoveryType, 'PATCH_RECOVERY');
  assert.equal(plan.tasks.length, 2);
  assert.equal(plan.tasks[0].tool, 'READ_FILE');
  assert.equal(plan.tasks[1].tool, 'APPLY_PATCH');
});

test('generateRecoveryPlan returns TERMINAL recovery strategy', () => {
  const task = makeTask('t1', 'CODING', [], 'RUN_TERMINAL', { command: 'npm test' });
  const plan = generateRecoveryPlan(task);
  assert.equal(plan.recoveryType, 'TERMINAL_RECOVERY');
  assert.equal(plan.tasks.length, 2);
  assert.equal(plan.tasks[0].tool, 'READ_FILE');
  assert.equal(plan.tasks[1].tool, 'RUN_TERMINAL');
});

test('tryRecovery returns recoveryStarted:false for null planner', () => {
  const result = tryRecovery(null, makeTask('t1', 'CODING'));
  assert.equal(result.recoveryStarted, false);
});

test('tryRecovery returns recoveryStarted:false for null task', () => {
  const planner = new Planner([]);
  const result = tryRecovery(planner, null);
  assert.equal(result.recoveryStarted, false);
});

test('no recovery for already-recovered tasks', () => {
  const planner = new Planner([
    makeTask('t1', 'CODING', [], 'READ_FILE', { path: 'x.json' })
  ]);

  // First failure triggers recovery — succeed
  notifyToolExecution(planner, 'READ_FILE', { path: 'x.json' }, { success: false, error: 'Not found' });
  const searchTask = getNextRecoveryTask(planner);
  notifyToolExecution(planner, 'LIST_FILES', { limit: 500 }, { success: true, files: ['x.json'] });
  const readTask = getNextRecoveryTask(planner);
  notifyToolExecution(planner, 'READ_FILE', { path: 'x.json' }, { success: true, content: 'ok' });
  checkRecoveryCompletion(planner);

  // Try to trigger recovery again on the now-RECOVERED task
  const r = notifyToolExecution(planner, 'READ_FILE', { path: 'x.json' }, { success: false, error: 'Failed again' });
  // Since the task is RECOVERED (not FAILED), findMatchingTask won't find it
  assert.equal(r.handled, false, 'Should not match RECOVERED task for tool notifications');
});

test('Regression: "Read planner-recovery-test-file.json" forces READ_FILE not LIST_FILES', () => {
  const objective = 'Read planner-recovery-test-file.json';
  const criteria = { taskType: 'ANALYSIS', requestedFiles: ['planner-recovery-test-file.json'] };

  // buildPlan must create a READ_FILE task (not a generic model-driven task)
  const plan = buildPlan(objective, criteria);
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].tool, 'READ_FILE', 'Task must have explicit READ_FILE tool');
  assert.equal(plan.tasks[0].toolArgs?.path, 'planner-recovery-test-file.json');

  // Planner dispatches this READ_FILE task directly (model never chooses LIST_FILES)
  const planner = new Planner(plan.tasks);
  const next = planner.getNextTask();
  assert.equal(next.tool, 'READ_FILE');
  assert.equal(next.toolArgs?.path, 'planner-recovery-test-file.json');

  // On READ_FILE failure, recovery is planner-owned — not model-driven
  const result = notifyToolExecution(planner, 'READ_FILE', { path: 'planner-recovery-test-file.json' }, { success: false, error: 'Not found' });
  assert.equal(result.recoveryStarted, true, 'Recovery must start on READ_FILE failure');
  assert.ok(isPlannerRecovering(planner), 'Planner must be in RECOVERING state');

  // Recovery dispatches LIST_FILES (a planner-owned tool, not model-chosen)
  const recoveryTask = getNextRecoveryTask(planner);
  assert.ok(recoveryTask, 'Recovery must have a ready task');
  assert.equal(recoveryTask.kind, 'RECOVERY', 'Recovery task must be RECOVERY kind');
  assert.equal(recoveryTask.tool, 'LIST_FILES', 'Recovery must dispatch LIST_FILES (planner-owned), not unknown tools');
});

// ===================== Regression: RECOVERY_FAILED terminal enforcement (Bug 2) =====================

test('Regression: RECOVERY_FAILED blocks ALL tools including read and undefined toolType', () => {
  const planner = new Planner([
    makeTask('t1', 'CODING', [], 'READ_FILE', { path: 'test.json' })
  ]);

  // Trigger failure + recovery
  notifyToolExecution(planner, 'READ_FILE', { path: 'test.json' }, { success: false, error: 'Not found' });

  // Execute LIST_FILES recovery but it fails → RECOVERY_FAILED
  const searchTask = getNextRecoveryTask(planner);
  notifyToolExecution(planner, 'LIST_FILES', { limit: 500 }, { success: false, error: 'No files found' });

  // RECOVERY_FAILED must be set
  assert.equal(planner.graph.getNode('t1').status, TaskStatus.RECOVERY_FAILED);
  assert.equal(hasRecoveryFailed(planner), true);

  // ALL toolTypes must be blocked — including ones that previously bypassed the guard
  assert.equal(canExecuteTool(planner, 'read').allowed, false);
  assert.equal(canExecuteTool(planner, 'write').allowed, false);
  assert.equal(canExecuteTool(planner, 'terminal').allowed, false);
  assert.equal(canExecuteTool(planner, 'final').allowed, false);
  assert.equal(canExecuteTool(planner, undefined).allowed, false, 'undefined toolType must be blocked (was Bug 2: LIST_FILES bypassed)');
  assert.equal(canExecuteTool(planner, 'list').allowed, false, '"list" toolType must be blocked');
  assert.equal(canExecuteTool(planner, 'search').allowed, false, '"search" toolType must be blocked');

  // Every blockage must report recoveryFailed: true
  assert.equal(canExecuteTool(planner, 'final').recoveryFailed, true);
  assert.equal(canExecuteTool(planner, 'read').recoveryFailed, true);
  assert.equal(canExecuteTool(planner, 'write').recoveryFailed, true);
  assert.equal(canExecuteTool(planner, undefined).recoveryFailed, true);

  // isComplete must be false (terminal condition)
  assert.equal(planner.isComplete(), false);

  // No recovery tasks should be ready
  assert.equal(hasReadyRecoveryTask(planner), false);
});

// ===================== Regression: BUG 1 — Recovery complete only after ENTIRE chain =====================

test('Regression BUG 1: Recovery not complete until entire chain succeeds', () => {
  const planner = new Planner([
    makeTask('t1', 'CODING', [], 'READ_FILE', { path: 'missing.json' })
  ]);

  // Trigger failure + recovery (creates LIST_FILES → READ_FILE chain)
  notifyToolExecution(planner, 'READ_FILE', { path: 'missing.json' }, { success: false, error: 'Not found' });

  // First recovery task (LIST_FILES) succeeds
  const first = getNextRecoveryTask(planner);
  assert.equal(first.tool, 'LIST_FILES');
  notifyToolExecution(planner, 'LIST_FILES', { limit: 500 }, { success: true, files: ['missing.json'] });

  // BUG 1: After first task succeeds, recovery must NOT be complete
  const afterFirst = checkRecoveryCompletion(planner);
  assert.equal(afterFirst.recoveryComplete, false, 'Must NOT complete after only first recovery task succeeds');

  // Original must still be RECOVERING (not prematurely RECOVERED)
  assert.equal(planner.graph.getNode('t1').status, TaskStatus.RECOVERING);

  // Second recovery task (READ_FILE) succeeds
  const second = getNextRecoveryTask(planner);
  assert.equal(second.tool, 'READ_FILE');
  notifyToolExecution(planner, 'READ_FILE', { path: 'missing.json' }, { success: true, content: '{"found": true}' });

  // After ALL recovery tasks succeed, recovery is complete
  const afterAll = checkRecoveryCompletion(planner);
  assert.equal(afterAll.recoveryComplete, true, 'Must complete after ALL recovery tasks succeed');
  assert.equal(afterAll.recoveredTaskId, 't1');
  assert.equal(planner.graph.getNode('t1').status, TaskStatus.RECOVERED);
  assert.equal(isPlannerRecovering(planner), false);
});

// ===================== Regression: BUG 2 — Planner stuck with FAILED/BLOCKED, no model call =====================

test('Regression BUG 2: Planner stuck with FAILED/BLOCKED — no READY, no PENDING', () => {
  const planner = new Planner([
    makeTask('t1', 'CODING', [], 'READ_FILE', { path: 'x.json' })
  ]);

  // Task fails → recovery starts
  notifyToolExecution(planner, 'READ_FILE', { path: 'x.json' }, { success: false, error: 'Not found' });

  // LIST_FILES recovery also fails → RECOVERY_FAILED
  const recoveryTask = getNextRecoveryTask(planner);
  notifyToolExecution(planner, 'LIST_FILES', { limit: 500 }, { success: false, error: 'No files' });

  // Planner is now stuck: RECOVERY_FAILED, no ready tasks
  assert.equal(planner.graph.getNode('t1').status, TaskStatus.RECOVERY_FAILED);
  assert.equal(planner.getNextTask(), null, 'No tasks should be READY');
  assert.equal(isPlannerRecovering(planner), false, 'Planner should not be recovering');
  assert.equal(hasReadyRecoveryTask(planner), false, 'No recovery tasks should be READY');

  // No READY/PENDING tasks remain — planner cannot make progress
  const all = planner.graph.allNodes();
  const readyOrPending = all.filter(t =>
    t.status === TaskStatus.READY ||
    t.status === TaskStatus.PENDING
  );
  assert.equal(readyOrPending.length, 0, 'No READY or PENDING tasks must remain');
  const hasFailed = all.some(t => t.status === TaskStatus.FAILED);
  const hasBlocked = all.some(t => t.status === TaskStatus.BLOCKED);
  assert.ok(hasFailed || hasBlocked, 'Must have FAILED or BLOCKED tasks');
  assert.equal(planner.isComplete(), false, 'Planner must not be complete (RECOVERY_FAILED)');
});

// ===================== Full regression: READ fail → LIST_FILES → READ fail → RECOVERY_FAILED → STOP =====================

test('Regression: READ fail → LIST_FILES → READ fail → RECOVERY_FAILED → STOP (no model call, no LIST_FILES after)', () => {
  const planner = new Planner([
    makeTask('t1', 'CODING', [], 'READ_FILE', { path: 'missing.json' })
  ]);

  // Step 1: READ_FILE fails → recovery starts
  const r1 = notifyToolExecution(planner, 'READ_FILE', { path: 'missing.json' }, { success: false, error: 'Not found' });
  assert.equal(r1.recoveryStarted, true);
  assert.equal(planner.graph.getNode('t1').status, TaskStatus.RECOVERING);

  // Step 2: LIST_FILES succeeds (first recovery task)
  const listTask = getNextRecoveryTask(planner);
  assert.equal(listTask.tool, 'LIST_FILES');
  notifyToolExecution(planner, 'LIST_FILES', { limit: 500 }, { success: true, files: ['missing.json'] });

  // Recovery NOT complete yet — READ_FILE still pending
  assert.equal(checkRecoveryCompletion(planner).recoveryComplete, false);
  assert.equal(planner.graph.getNode('t1').status, TaskStatus.RECOVERING);

  // Step 3: READ_FILE recovery task fails
  const readTask = getNextRecoveryTask(planner);
  assert.equal(readTask.tool, 'READ_FILE');
  const r2 = notifyToolExecution(planner, 'READ_FILE', { path: 'missing.json' }, { success: false, error: 'Still not found' });
  assert.equal(r2.isRecovery, true);

  // Step 4: RECOVERY_FAILED — terminal state
  assert.equal(planner.graph.getNode('t1').status, TaskStatus.RECOVERY_FAILED);
  assert.equal(hasRecoveryFailed(planner), true);

  // Step 5: NO model call — no READY tasks, not recovering
  assert.equal(planner.getNextTask(), null, 'No READY tasks — model must NOT be called');
  assert.equal(isPlannerRecovering(planner), false, 'Not recovering');
  assert.equal(hasReadyRecoveryTask(planner), false, 'No recovery tasks ready');

  // Step 6: canExecuteTool blocks everything — no further tools allowed
  assert.equal(canExecuteTool(planner, 'read').allowed, false);
  assert.equal(canExecuteTool(planner, 'list').allowed, false);
  assert.equal(canExecuteTool(planner, undefined).allowed, false);

  // Step 7: isComplete returns false
  assert.equal(planner.isComplete(), false);
});
