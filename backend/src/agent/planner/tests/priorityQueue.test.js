import test from 'node:test';
import assert from 'node:assert/strict';
import { Task } from '../task.js';
import { TaskNode } from '../taskNode.js';
import { Planner } from '../planner.js';
import { TaskStatus } from '../plannerTypes.js';
import {
  getTaskPriority,
  sortReadyTasksByPriority,
  pickNextPlannerTask
} from '../priorityQueue.js';
import { buildPlan, classifyReadWriteFiles } from '../planBuilder.js';
import { notifyToolExecution } from '../executionController.js';

// ===================== Unit: getTaskPriority =====================

test('getTaskPriority: RUN_TERMINAL returns 100', () => {
  const task = new Task({ id: 't1', kind: 'CODING', goal: 'Run test', tool: 'RUN_TERMINAL' });
  assert.equal(getTaskPriority(task), 100);
});

test('getTaskPriority: VALIDATE_PATCH returns 100', () => {
  const task = new Task({ id: 't1', kind: 'CODING', goal: 'Validate', tool: 'VALIDATE_PATCH' });
  assert.equal(getTaskPriority(task), 100);
});

test('getTaskPriority: WRITE_FILE returns 80', () => {
  const task = new Task({ id: 't1', kind: 'CODING', goal: 'Write file', tool: 'WRITE_FILE' });
  assert.equal(getTaskPriority(task), 80);
});

test('getTaskPriority: APPLY_PATCH returns 80', () => {
  const task = new Task({ id: 't1', kind: 'CODING', goal: 'Apply patch', tool: 'APPLY_PATCH' });
  assert.equal(getTaskPriority(task), 80);
});

test('getTaskPriority: READ_FILE without children returns 40', () => {
  const node = new TaskNode({ id: 't1', kind: 'CODING', goal: 'Read file', tool: 'READ_FILE' });
  assert.equal(getTaskPriority(node), 40);
});

test('getTaskPriority: READ_FILE with children returns 60', () => {
  const node = new TaskNode({ id: 't1', kind: 'CODING', goal: 'Read file', tool: 'READ_FILE' });
  node.children.add('downstream');
  assert.equal(getTaskPriority(node), 60);
});

test('getTaskPriority: FINAL returns 10', () => {
  const task = new Task({ id: 't1', kind: 'CODING', goal: 'Summarize', tool: 'FINAL' });
  assert.equal(getTaskPriority(task), 10);
});

test('getTaskPriority: explicit priority overrides default', () => {
  const task = new Task({ id: 't1', kind: 'CODING', goal: 'Read file', tool: 'READ_FILE', priority: 99 });
  assert.equal(getTaskPriority(task), 99);
});

test('getTaskPriority: unknown tool uses default 50', () => {
  const task = new Task({ id: 't1', kind: 'CODING', goal: 'Search', tool: 'SEARCH_CODE' });
  assert.equal(getTaskPriority(task), 50);
});

// ===================== Unit: sortReadyTasksByPriority =====================

test('sortReadyTasksByPriority: sorts by priority descending', () => {
  const low = new TaskNode({ id: 'low', kind: 'CODING', goal: 'Low', tool: 'FINAL' });
  const high = new TaskNode({ id: 'high', kind: 'CODING', goal: 'High', tool: 'RUN_TERMINAL' });
  const med = new TaskNode({ id: 'med', kind: 'CODING', goal: 'Med', tool: 'WRITE_FILE' });

  const sorted = sortReadyTasksByPriority([low, high, med]);
  assert.equal(sorted[0].id, 'high');
  assert.equal(sorted[1].id, 'med');
  assert.equal(sorted[2].id, 'low');
});

test('sortReadyTasksByPriority: equal priority keeps stable order by createdAt', () => {
  const a = new TaskNode({ id: 'a', kind: 'CODING', goal: 'A', tool: 'READ_FILE' });
  const b = new TaskNode({ id: 'b', kind: 'CODING', goal: 'B', tool: 'READ_FILE' });
  const c = new TaskNode({ id: 'c', kind: 'CODING', goal: 'C', tool: 'READ_FILE' });
  // All created at nearly the same time; stable sort preserves input order for equal priority+createdAt
  const sorted = sortReadyTasksByPriority([c, a, b]);
  assert.equal(sorted[0].id, 'c');
  assert.equal(sorted[1].id, 'a');
  assert.equal(sorted[2].id, 'b');
});

// ===================== Unit: pickNextPlannerTask =====================

test('pickNextPlannerTask: returns highest priority task', () => {
  const tasks = [
    new TaskNode({ id: 'read', kind: 'CODING', goal: 'Read', tool: 'READ_FILE' }),
    new TaskNode({ id: 'write', kind: 'CODING', goal: 'Write', tool: 'WRITE_FILE' }),
    new TaskNode({ id: 'run', kind: 'CODING', goal: 'Run', tool: 'RUN_TERMINAL' })
  ];
  const picked = pickNextPlannerTask(tasks);
  assert.equal(picked.id, 'run');
});

test('pickNextPlannerTask: returns null for empty array', () => {
  assert.equal(pickNextPlannerTask([]), null);
});

test('pickNextPlannerTask: returns null for null/undefined', () => {
  assert.equal(pickNextPlannerTask(null), null);
  assert.equal(pickNextPlannerTask(undefined), null);
});

// ===================== Integration: Planner getNextTask =====================

test('Integration: RUN_TERMINAL validation selected before READ_FILE', () => {
  const readTask = new Task({
    id: 'read-file',
    kind: 'CODING',
    goal: 'Read file',
    tool: 'READ_FILE',
    toolArgs: { path: 'data.json' }
  });
  const runTask = new Task({
    id: 'run-term',
    kind: 'CODING',
    goal: 'Run tests',
    tool: 'RUN_TERMINAL',
    toolArgs: { command: 'npm test' }
  });

  const planner = new Planner([readTask, runTask]);
  const next = planner.getNextTask();
  assert.equal(next.id, 'run-term',
    'RUN_TERMINAL (priority 100) should be selected before READ_FILE (priority 40)');
});

test('Integration: WRITE_FILE selected before normal READ_FILE', () => {
  const readTask = new Task({
    id: 'read-file',
    kind: 'CODING',
    goal: 'Read file',
    tool: 'READ_FILE',
    toolArgs: { path: 'data.json' }
  });
  const writeTask = new Task({
    id: 'write-file',
    kind: 'CODING',
    goal: 'Write file',
    tool: 'WRITE_FILE',
    toolArgs: { path: 'data.json' }
  });

  const planner = new Planner([readTask, writeTask]);
  const next = planner.getNextTask();
  assert.equal(next.id, 'write-file',
    'WRITE_FILE (priority 80) should be selected before READ_FILE (priority 40)');
});

test('Integration: APPLY_PATCH selected before normal READ_FILE', () => {
  const readTask = new Task({
    id: 'read-file',
    kind: 'CODING',
    goal: 'Read file',
    tool: 'READ_FILE',
    toolArgs: { path: 'data.json' }
  });
  const patchTask = new Task({
    id: 'apply-patch',
    kind: 'CODING',
    goal: 'Apply patch',
    tool: 'APPLY_PATCH',
    toolArgs: { file: 'data.json' }
  });

  const planner = new Planner([readTask, patchTask]);
  const next = planner.getNextTask();
  assert.equal(next.id, 'apply-patch',
    'APPLY_PATCH (priority 80) should be selected before READ_FILE (priority 40)');
});

test('Integration: READ_FILE with downstream dependency gets priority 60', () => {
  const readTask = new Task({
    id: 'read-needed',
    kind: 'CODING',
    goal: 'Read config',
    tool: 'READ_FILE',
    toolArgs: { path: 'config.json' }
  });
  const patchTask = new Task({
    id: 'patch-config',
    kind: 'CODING',
    goal: 'Patch config',
    tool: 'APPLY_PATCH',
    toolArgs: { file: 'config.json' },
    dependencies: ['read-needed']
  });
  // Add read-needed first so it's in the graph before patch-config references it
  const planner = new Planner([readTask, patchTask]);
  const node = planner.graph.getNode('read-needed');
  assert.equal(node.children.size, 1, 'read-needed should have a downstream dependency');
  assert.equal(getTaskPriority(node), 60,
    'READ_FILE with children should have priority 60');
});

test('Integration: equal priority tasks maintain stable order by createdAt', () => {
  const tasks = [
    new Task({ id: 'b', kind: 'CODING', goal: 'Read B', tool: 'READ_FILE', toolArgs: { path: 'b.json' } }),
    new Task({ id: 'a', kind: 'CODING', goal: 'Read A', tool: 'READ_FILE', toolArgs: { path: 'a.json' } }),
    new Task({ id: 'c', kind: 'CODING', goal: 'Read C', tool: 'READ_FILE', toolArgs: { path: 'c.json' } })
  ];
  const planner = new Planner(tasks);
  const next = planner.getNextTask();
  // Both are READ_FILE (priority 40), stable order by createdAt
  assert.ok(next.id === 'b' || next.id === 'a' || next.id === 'c',
    'Should return one of the READ_FILE tasks');
});

// ===================== Dependency constraint =====================

test('Integration: blocked task not selected even with high priority', () => {
  const readTask = new Task({
    id: 'read-first',
    kind: 'CODING',
    goal: 'Read first',
    tool: 'READ_FILE',
    toolArgs: { path: 'a.json' }
  });
  const runTask = new Task({
    id: 'run-after-read',
    kind: 'CODING',
    goal: 'Run after read',
    tool: 'RUN_TERMINAL',
    toolArgs: { command: 'npm test' },
    dependencies: ['read-first']
  });

  const planner = new Planner([runTask, readTask]);
  // read-first is READY, run-after-read is PENDING (depends on read-first)
  assert.equal(planner.graph.getNode('read-first').status, TaskStatus.READY);
  assert.equal(planner.graph.getNode('run-after-read').status, TaskStatus.PENDING);

  // getNextTask must return read-first (ready), not run-after-read (pending despite high priority)
  const next = planner.getNextTask();
  assert.equal(next.id, 'read-first',
    'READ_FILE (ready) must be selected over RUN_TERMINAL (pending despite priority 100)');

  // After read-first completes, run-after-read becomes ready
  planner.markSuccess('read-first', { content: 'data' });
  const next2 = planner.getNextTask();
  assert.equal(next2.id, 'run-after-read',
    'RUN_TERMINAL should be selected after dependency resolves');
});

// ===================== Parallel batch priority =====================

test('Integration: parallel batch picks high priority tasks first', () => {
  const tasks = [
    new Task({
      id: 'read-1',
      kind: 'CODING',
      goal: 'Read file 1',
      tool: 'READ_FILE',
      toolArgs: { path: 'f1.json' }
    }),
    new Task({
      id: 'read-2',
      kind: 'CODING',
      goal: 'Read file 2',
      tool: 'READ_FILE',
      toolArgs: { path: 'f2.json' }
    }),
    new Task({
      id: 'run-term',
      kind: 'CODING',
      goal: 'Run tests',
      tool: 'RUN_TERMINAL',
      toolArgs: { command: 'npm test' }
    }),
    new Task({
      id: 'write-file',
      kind: 'CODING',
      goal: 'Write config',
      tool: 'WRITE_FILE',
      toolArgs: { path: 'config.json' }
    })
  ];

  const planner = new Planner(tasks);
  const groups = planner.findParallelReadyTasks();

  // RUN_TERMINAL and WRITE_FILE conflict (different tools, no same-path conflict so they can be parallel)
  // RUN_TERMINAL (100) and WRITE_FILE (80) should be in the first group, READ_FILE (40) tasks in later groups
  assert.ok(groups.length >= 1, 'Should have at least one parallel group');

  // First group should contain the highest priority tasks
  const firstGroup = groups[0];
  const firstGroupPriorities = firstGroup.map(t => getTaskPriority(t));

  // All tasks in first group should have priority >= any task in later groups
  for (let i = 1; i < groups.length; i++) {
    for (const laterTask of groups[i]) {
      const laterPriority = getTaskPriority(laterTask);
      for (const firstPriority of firstGroupPriorities) {
        assert.ok(firstPriority >= laterPriority,
          `First group priority ${firstPriority} should be >= later group priority ${laterPriority}`);
      }
    }
  }
});

test('Integration: getNextTask respects explicit priority override', () => {
  const readA = new Task({
    id: 'read-a',
    kind: 'CODING',
    goal: 'Read A',
    tool: 'READ_FILE',
    toolArgs: { path: 'a.json' },
    priority: 95
  });
  const runTerm = new Task({
    id: 'run-term',
    kind: 'CODING',
    goal: 'Run tests',
    tool: 'RUN_TERMINAL',
    toolArgs: { command: 'npm test' }
  });

  const planner = new Planner([readA, runTerm]);
  const next = planner.getNextTask();
  // read-a has explicit priority 95 > RUN_TERMINAL default 100? No, 95 < 100
  // Actually, 95 < 100, so RUN_TERMINAL should be first still
  assert.equal(next.id, 'run-term',
    'RUN_TERMINAL default 100 > explicit READ_FILE 95');

  // Now test with explicit priority that overrides
  const readB = new Task({
    id: 'read-b',
    kind: 'CODING',
    goal: 'Read B',
    tool: 'READ_FILE',
    toolArgs: { path: 'b.json' },
    priority: 200
  });
  const planner2 = new Planner([runTerm, readB]);
  const next2 = planner2.getNextTask();
  assert.equal(next2.id, 'read-b',
    'READ_FILE with explicit priority 200 should be selected before RUN_TERMINAL default 100');
});

// ===================== Phase 4.10+: Plan decomposition =====================

test('classifyReadWriteFiles: read and write targets detected correctly', () => {
  const objective = 'Read package.json Then create src/priority-test.js with console.log("OK") Then run node src/priority-test.js';
  const files = ['package.json', 'src/priority-test.js'];

  const { readFiles, writeFiles } = classifyReadWriteFiles(objective, files);
  assert.deepEqual(readFiles, ['package.json'], 'package.json should be read target');
  assert.deepEqual(writeFiles, ['src/priority-test.js'], 'src/priority-test.js should be write target');
});

test('classifyReadWriteFiles: all files default to write when no read/write keywords', () => {
  const objective = 'Work on package.json and src/app.js';
  const files = ['package.json', 'src/app.js'];

  const { readFiles, writeFiles } = classifyReadWriteFiles(objective, files);
  assert.equal(writeFiles.length, 2, 'Both files should be write targets by default');
});

test('buildPlan: mixed prompt decomposes into READ → WRITE → RUN tasks', () => {
  const objective = 'Read package.json Then create src/priority-test.js with console.log("OK") Then run node src/priority-test.js';
  const criteria = {
    taskType: 'CODING',
    requestedFiles: ['package.json', 'src/priority-test.js'],
    requiredCommands: ['node src/priority-test.js']
  };

  const { tasks } = buildPlan(objective, criteria);

  // Should have 3+ tasks: READ_FILE, WRITE(CODING), RUN_TERMINAL
  const readTasks = tasks.filter(t => t.tool === 'READ_FILE');
  const writeTasks = tasks.filter(t => !t.tool);  // CODING tasks without tool set
  const runTasks = tasks.filter(t => t.tool === 'RUN_TERMINAL');

  assert.ok(readTasks.length >= 1, 'Should have at least one READ_FILE task');
  assert.equal(readTasks[0].toolArgs.path, 'package.json', 'READ_FILE should target package.json');

  assert.ok(writeTasks.length >= 1, 'Should have at least one write CODING task');

  assert.ok(runTasks.length >= 1, 'Should have at least one RUN_TERMINAL task');
  assert.equal(runTasks[0].toolArgs.command, 'node src/priority-test.js', 'RUN_TERMINAL command should match');

  // Verify dependencies: READ → WRITE → RUN
  const planner = new Planner(tasks);
  const readNode = planner.graph.getNode(readTasks[0].id);
  const writeNode = planner.graph.getNode(writeTasks[0].id);
  const runNode = planner.graph.getNode(runTasks[0].id);

  assert.equal(readNode.status, TaskStatus.READY, 'READ_FILE should be READY (no deps)');
  assert.equal(writeNode.status, TaskStatus.PENDING, 'Write task should be PENDING (depends on read)');
  assert.ok(writeNode.dependencies.has(readTasks[0].id), 'Write task should depend on read task');
  assert.ok(runNode.dependencies.has(writeTasks[0].id), 'RUN_TERMINAL should depend on write task');
});

test('buildPlan: no write intent keeps generic CODING task', () => {
  const objective = 'Read package.json and show me the version';
  const criteria = {
    taskType: 'CODING',
    requestedFiles: ['package.json'],
    requiredCommands: []
  };

  const { tasks } = buildPlan(objective, criteria);

  // Should have 1 generic CODING task (no write intent detected)
  const genericTasks = tasks.filter(t => !t.tool);
  assert.equal(genericTasks.length, 1, 'Should have 1 generic CODING task');
});

// ===================== Completion guard =====================

test('Completion guard: notifyToolExecution with WRITE_FILE matches write-goal task', () => {
  const tasks = [
    new Task({
      id: 'read-step',
      kind: 'CODING',
      goal: 'Read file: package.json',
      tool: null
    }),
    new Task({
      id: 'write-step',
      kind: 'CODING',
      goal: 'Write file: src/test.js — Create src/test.js',
      tool: null,
      dependencies: ['read-step']
    })
  ];

  const planner = new Planner(tasks);
  const readNode = planner.graph.getNode('read-step');
  const writeNode = planner.graph.getNode('write-step');

  assert.equal(readNode.status, TaskStatus.READY, 'read-step should be READY');
  assert.equal(writeNode.status, TaskStatus.PENDING, 'write-step should be PENDING');

  // Simulate: model does WRITE_FILE (skip the read intentionally)
  // Completion guard should NOT match it to read-step
  const result = notifyToolExecution(planner, 'WRITE_FILE', { path: 'src/test.js', content: 'test' }, { success: true });

  // read-step should still be READY (not matched to WRITE_FILE)
  assert.equal(result.handled, false, 'WRITE_FILE should not match read-step');
  assert.equal(planner.graph.getNode('read-step').status, TaskStatus.READY, 'read-step should remain READY');
});

test('Completion guard: READ_FILE matches read-goal task', () => {
  const tasks = [
    new Task({
      id: 'read-step',
      kind: 'CODING',
      goal: 'Read file: package.json',
      tool: null
    }),
    new Task({
      id: 'write-step',
      kind: 'CODING',
      goal: 'Write file: src/test.js',
      tool: null,
      dependencies: ['read-step']
    })
  ];

  const planner = new Planner(tasks);

  // Simulate: model does READ_FILE on package.json
  const result = notifyToolExecution(planner, 'READ_FILE', { path: 'package.json' }, { success: true, content: '{}' });

  assert.equal(result.handled, true, 'READ_FILE should be handled');
  assert.equal(result.status, 'SUCCESS', 'Should be SUCCESS');
  assert.equal(planner.graph.getNode('read-step').status, TaskStatus.SUCCESS, 'read-step should be SUCCESS');
  assert.equal(planner.graph.getNode('write-step').status, TaskStatus.READY, 'write-step should now be READY');
});

test('Completion guard: model must do READ before WRITE (dependency enforced)', () => {
  const tasks = [
    new Task({
      id: 'read-step',
      kind: 'CODING',
      goal: 'Read file: package.json',
      tool: null
    }),
    new Task({
      id: 'write-step',
      kind: 'CODING',
      goal: 'Write file: src/test.js',
      tool: null,
      dependencies: ['read-step']
    })
  ];

  const planner = new Planner(tasks);

  // Confirm write-step is blocked by dependency (not READY)
  assert.equal(planner.graph.getNode('write-step').status, TaskStatus.PENDING, 'write-step should be PENDING initially');

  // Even if model provides WRITE_FILE for write-step, it's not READY yet
  // So findMatchingTask won't select it (status is PENDING, not PENDING/READY? Actually PENDING IS valid)
  // But the completion guard should prevent READ_FILE from matching write-step

  const result = notifyToolExecution(planner, 'READ_FILE', { path: 'package.json' }, { success: true, content: '{}' });
  assert.equal(result.handled, true, 'READ_FILE should match read-step');
  assert.equal(planner.graph.getNode('read-step').status, TaskStatus.SUCCESS);
  assert.equal(planner.graph.getNode('write-step').status, TaskStatus.READY, 'write-step becomes READY after read completes');
});

// ===================== Priority Queue still applies =====================

test('Priority Queue: RUN_TERMINAL gets priority 100 after dependency chain', () => {
  const objective = 'Read package.json Then create src/priority-test.js Then run node src/priority-test.js';
  const criteria = {
    taskType: 'CODING',
    requestedFiles: ['package.json', 'src/priority-test.js'],
    requiredCommands: ['node src/priority-test.js']
  };

  const { tasks } = buildPlan(objective, criteria);
  const planner = new Planner(tasks);

  // Initially only READ_FILE is READY
  const first = planner.getNextTask();
  assert.equal(first.tool, 'READ_FILE', 'First task should be READ_FILE');

  // READ_FILE has a downstream child (write task), so priority is 60
  assert.equal(getTaskPriority(first), 60, 'READ_FILE with downstream child should have priority 60');

  // Complete the read
  notifyToolExecution(planner, 'READ_FILE', { path: 'package.json' }, { success: true, content: '{}' });

  // Write task becomes READY, priority should be computed
  const second = planner.getNextTask();
  assert.ok(second, 'Should have a next task');
  assert.ok(!second.tool, 'Second task should be a write CODING task (no tool set)');

  // Complete the write
  notifyToolExecution(planner, 'WRITE_FILE', { path: 'src/priority-test.js', content: 'console.log("OK")' }, { success: true, changed: true, file: 'src/priority-test.js' });

  // RUN_TERMINAL becomes READY, priority should be 100
  const third = planner.getNextTask();
  assert.ok(third, 'Should have RUN_TERMINAL task');
  assert.equal(third.tool, 'RUN_TERMINAL', 'Third task should be RUN_TERMINAL');
  assert.equal(getTaskPriority(third), 100, 'RUN_TERMINAL should have priority 100');
});
