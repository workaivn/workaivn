import test from 'node:test';
import assert from 'node:assert/strict';
import { Task } from '../task.js';
import { Planner } from '../planner.js';
import { TaskStatus, BranchType } from '../plannerTypes.js';
import { notifyToolExecution, isPlannerRecovering, checkRecoveryCompletion } from '../executionController.js';

// ===================== Test A: Independent readers + list → one parallel group, three workers =====================

test('Test A: Independent readers + list — one parallel group, three workers', () => {
  const task1 = new Task({
    id: 'read-pkg',
    kind: 'CODING',
    goal: 'Read package.json',
    tool: 'READ_FILE',
    toolArgs: { path: 'package.json' },
    dependencies: []
  });
  const task2 = new Task({
    id: 'read-md',
    kind: 'CODING',
    goal: 'Read README.md',
    tool: 'READ_FILE',
    toolArgs: { path: 'README.md' },
    dependencies: []
  });
  const task3 = new Task({
    id: 'list-files',
    kind: 'CODING',
    goal: 'List files',
    tool: 'LIST_FILES',
    toolArgs: { limit: 500 },
    dependencies: []
  });

  const planner = new Planner([task1, task2, task3]);

  const groups = planner.findParallelReadyTasks();
  assert.equal(groups.length, 1, 'All three tasks should form one parallel group');
  assert.equal(groups[0].length, 3, 'Group should contain all three tasks');

  const group = planner.nextParallelGroup();
  assert.equal(group.length, 3, 'nextParallelGroup should return all three');

  // All three should be READY
  for (const t of group) {
    assert.equal(t.status, TaskStatus.READY, `${t.id} should be READY`);
  }

  // Simulate parallel execution: execute in any order
  notifyToolExecution(planner, 'READ_FILE', { path: 'package.json' }, { success: true, content: '{}' });
  notifyToolExecution(planner, 'READ_FILE', { path: 'README.md' }, { success: true, content: '# readme' });
  notifyToolExecution(planner, 'LIST_FILES', { limit: 500 }, { success: true, files: ['package.json', 'README.md'] });

  assert.equal(planner.isParallelGroupComplete(), true, 'Group should be complete');
  planner.mergeParallelGroup();

  // All tasks should be SUCCESS
  assert.equal(planner.graph.getNode('read-pkg').status, TaskStatus.SUCCESS);
  assert.equal(planner.graph.getNode('read-md').status, TaskStatus.SUCCESS);
  assert.equal(planner.graph.getNode('list-files').status, TaskStatus.SUCCESS);
  assert.equal(planner.isComplete(), true, 'Planner should be complete');
});

// ===================== Test B: Same file write+patch → conflict → sequential groups =====================

test('Test B: Same file write+patch — conflict → sequential groups', () => {
  const task1 = new Task({
    id: 'write-pkg',
    kind: 'CODING',
    goal: 'Write package.json',
    tool: 'WRITE_FILE',
    toolArgs: { path: 'package.json' },
    dependencies: []
  });
  const task2 = new Task({
    id: 'patch-pkg',
    kind: 'CODING',
    goal: 'Patch package.json',
    tool: 'APPLY_PATCH',
    toolArgs: { file: 'package.json' },
    dependencies: []
  });

  const planner = new Planner([task1, task2]);

  const groups = planner.findParallelReadyTasks();
  assert.equal(groups.length, 2, 'Should split into two groups due to conflict');
  assert.equal(groups[0].length, 1, 'First group should have one task');
  assert.equal(groups[1].length, 1, 'Second group should have one task');

  // First group: write-pkg
  const group1 = planner.nextParallelGroup();
  assert.equal(group1[0].id, 'write-pkg', 'First group should be write-pkg');
  notifyToolExecution(planner, 'WRITE_FILE', { path: 'package.json' }, { success: true });
  assert.equal(planner.isParallelGroupComplete(), true, 'Group 1 complete');
  planner.mergeParallelGroup();

  // Second group: patch-pkg
  const group2 = planner.nextParallelGroup();
  assert.equal(group2[0].id, 'patch-pkg', 'Second group should be patch-pkg');
  notifyToolExecution(planner, 'APPLY_PATCH', { file: 'package.json' }, { success: true, changed: true });
  assert.equal(planner.isParallelGroupComplete(), true, 'Group 2 complete');
  planner.mergeParallelGroup();

  assert.equal(planner.graph.getNode('write-pkg').status, TaskStatus.SUCCESS);
  assert.equal(planner.graph.getNode('patch-pkg').status, TaskStatus.SUCCESS);
  assert.equal(planner.isComplete(), true, 'Planner should be complete');
});

// ===================== Test C: Two independent READ_FILE — parallel execution =====================

test('Test C: Two independent READ_FILE — parallel', () => {
  const task1 = new Task({
    id: 'read-a',
    kind: 'CODING',
    goal: 'Read a.json',
    tool: 'READ_FILE',
    toolArgs: { path: 'a.json' },
    dependencies: []
  });
  const task2 = new Task({
    id: 'read-b',
    kind: 'CODING',
    goal: 'Read b.json',
    tool: 'READ_FILE',
    toolArgs: { path: 'b.json' },
    dependencies: []
  });

  const planner = new Planner([task1, task2]);

  const groups = planner.findParallelReadyTasks();
  assert.equal(groups.length, 1, 'Should be one parallel group');
  assert.equal(groups[0].length, 2, 'Group should contain both tasks');

  const group = planner.nextParallelGroup();
  assert.equal(group.length, 2);

  // Execute in parallel (order doesn't matter)
  notifyToolExecution(planner, 'READ_FILE', { path: 'b.json' }, { success: true, content: 'b content' });
  notifyToolExecution(planner, 'READ_FILE', { path: 'a.json' }, { success: true, content: 'a content' });

  assert.equal(planner.isParallelGroupComplete(), true, 'Group should be complete');
  planner.mergeParallelGroup();

  assert.equal(planner.graph.getNode('read-a').status, TaskStatus.SUCCESS);
  assert.equal(planner.graph.getNode('read-b').status, TaskStatus.SUCCESS);
  assert.equal(planner.isComplete(), true, 'Planner should be complete');
});

// ===================== Test D: One task fails — wait, merge, recovery =====================

test('Test D: One task fails — wait, merge, recovery', () => {
  // Task that will fail — needs a branch defined so _evaluateAndApplyBranch runs,
  // which sets branchType=FAILURE, which triggers tryRecovery via Phase 4.7 flow.
  // We use successNext to enable branch evaluation without a failureNext target.
  const task1 = new Task({
    id: 'read-fail',
    kind: 'CODING',
    goal: 'Read fail.json',
    tool: 'READ_FILE',
    toolArgs: { path: 'fail.json' },
    dependencies: [],
    successNext: 'placeholder'  // Enables branch evaluation without duplicate recovery
  });
  const task2 = new Task({
    id: 'read-ok',
    kind: 'CODING',
    goal: 'Read ok.json',
    tool: 'READ_FILE',
    toolArgs: { path: 'ok.json' },
    dependencies: []
  });

  const planner = new Planner([task1, task2]);

  // Both read tasks are READY (no deps)
  assert.equal(planner.graph.getNode('read-fail').status, TaskStatus.READY);
  assert.equal(planner.graph.getNode('read-ok').status, TaskStatus.READY);

  const groups = planner.findParallelReadyTasks();
  assert.equal(groups.length, 1, 'Both READY tasks should form one parallel group');
  assert.equal(groups[0].length, 2, 'Group should contain read-fail and read-ok');

  const group = planner.nextParallelGroup();
  assert.equal(group.length, 2);

  // Simulate parallel execution: task1 fails, task2 succeeds
  const result1 = notifyToolExecution(planner, 'READ_FILE', { path: 'fail.json' }, { success: false, error: 'File not found' });
  assert.equal(result1.handled, true);
  assert.equal(result1.status, 'FAILED');

  // verify FAILURE branch was evaluated (Phase 4.7)
  assert.equal(planner.branchType('read-fail'), BranchType.FAILURE, 'Branch type must be FAILURE');

  // Recovery must have started via Phase 4.7 flow (tryRecovery called because branchType === 'FAILURE')
  assert.equal(result1.recoveryStarted, true, 'Recovery must start after FAILURE branch');
  assert.equal(isPlannerRecovering(planner), true, 'Planner must be recovering');

  const result2 = notifyToolExecution(planner, 'READ_FILE', { path: 'ok.json' }, { success: true, content: 'ok content' });
  assert.equal(result2.handled, true);
  assert.equal(result2.status, 'SUCCESS');

  // Group 1 is complete (read-fail is RECOVERING, read-ok is SUCCESS)
  assert.equal(planner.isParallelGroupComplete(), true, 'Group should be complete');
  planner.waitParallelGroup();
  planner.mergeParallelGroup();

  // After merge: recovery tasks should be the next group
  const nextGroup = planner.nextParallelGroup();
  assert.ok(nextGroup, 'Should have a next group for recovery');

  // Execute recovery plan tasks (LIST_FILES then READ_FILE)
  const recoveryTask = nextGroup[0];
  assert.equal(recoveryTask.tool, 'LIST_FILES', 'First recovery task should be LIST_FILES');
  notifyToolExecution(planner, 'LIST_FILES', { limit: 500 }, { success: true, files: ['fail.json'] });

  assert.equal(planner.isParallelGroupComplete(), true, 'Recovery group should be complete');
  planner.mergeParallelGroup();

  // Next group: READ_FILE
  const nextGroup2 = planner.nextParallelGroup();
  assert.ok(nextGroup2, 'Should have next group for READ_FILE recovery');
  assert.equal(nextGroup2[0].tool, 'READ_FILE', 'Second recovery task should be READ_FILE');
  notifyToolExecution(planner, 'READ_FILE', { path: 'fail.json' }, { success: true, content: '{"found": true}' });

  assert.equal(planner.isParallelGroupComplete(), true, 'Final recovery group should be complete');
  planner.mergeParallelGroup();

  // Check recovery completion
  const completion = checkRecoveryCompletion(planner);
  assert.equal(completion.recoveryComplete, true, 'Recovery must complete');
  assert.equal(planner.graph.getNode('read-fail').status, TaskStatus.RECOVERED);
  assert.equal(planner.graph.getNode('read-ok').status, TaskStatus.SUCCESS);

  assert.equal(planner.isComplete(), true, 'Planner should be complete');
});

// ===================== Test E: All workers succeed — merge, continue DAG =====================

test('Test E: All workers succeed — merge, continue DAG', () => {
  const task1 = new Task({
    id: 'read-a',
    kind: 'CODING',
    goal: 'Read a.json',
    tool: 'READ_FILE',
    toolArgs: { path: 'a.json' },
    dependencies: []
  });
  const task2 = new Task({
    id: 'read-b',
    kind: 'CODING',
    goal: 'Read b.json',
    tool: 'READ_FILE',
    toolArgs: { path: 'b.json' },
    dependencies: []
  });
  const task3 = new Task({
    id: 'patch',
    kind: 'CODING',
    goal: 'Apply patch',
    tool: 'APPLY_PATCH',
    toolArgs: { file: 'output.json' },
    dependencies: ['read-a', 'read-b']
  });

  const planner = new Planner([task1, task2, task3]);

  // Group 1: read-a and read-b (independent, same tool but different paths)
  const groups = planner.findParallelReadyTasks();
  assert.equal(groups.length, 1, 'Should be one parallel group');
  assert.equal(groups[0].length, 2, 'Group should contain both reads');

  const group1 = planner.nextParallelGroup();
  assert.equal(group1.length, 2);

  // Both succeed (parallel execution)
  notifyToolExecution(planner, 'READ_FILE', { path: 'a.json' }, { success: true, content: '{"a": 1}' });
  notifyToolExecution(planner, 'READ_FILE', { path: 'b.json' }, { success: true, content: '{"b": 2}' });

  assert.equal(planner.isParallelGroupComplete(), true, 'Group 1 should be complete');
  planner.waitParallelGroup();
  planner.mergeParallelGroup();

  // After merge: both reads SUCCESS → patch's dependencies satisfied → patch becomes READY
  assert.equal(planner.graph.getNode('read-a').status, TaskStatus.SUCCESS);
  assert.equal(planner.graph.getNode('read-b').status, TaskStatus.SUCCESS);
  assert.equal(planner.graph.getNode('patch').status, TaskStatus.READY, 'Patch should be READY after deps satisfied');

  // Group 2: patch
  const group2 = planner.nextParallelGroup();
  assert.equal(group2.length, 1, 'Second group should have one task');
  assert.equal(group2[0].id, 'patch');

  notifyToolExecution(planner, 'APPLY_PATCH', { file: 'output.json' }, { success: true, changed: true });
  assert.equal(planner.isParallelGroupComplete(), true, 'Group 2 should be complete');
  planner.mergeParallelGroup();

  assert.equal(planner.graph.getNode('patch').status, TaskStatus.SUCCESS);
  assert.equal(planner.isComplete(), true, 'Planner should be complete');
});
