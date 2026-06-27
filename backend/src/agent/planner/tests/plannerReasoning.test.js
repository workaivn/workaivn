import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Task } from '../task.js';
import { Planner } from '../planner.js';
import { TaskKind, TaskStatus } from '../plannerTypes.js';

function makeReasoningTask(id, status = TaskStatus.PENDING, priority = 50) {
  return new Task({
    id,
    kind: TaskKind.REASONING,
    goal: `Generate content for file: ${id}.js`,
    tool: null,
    toolArgs: {},
    dependencies: [],
    priority
  });
}

function makeCodingTask(id) {
  return new Task({
    id,
    kind: TaskKind.CODING,
    goal: `Task ${id}`,
    tool: 'READ_FILE',
    toolArgs: { path: `${id}.js` },
    dependencies: [],
    priority: 50
  });
}

function makeGenericTask(id) {
  return new Task({
    id,
    kind: TaskKind.CODING,
    goal: `Generic task ${id}`,
    tool: null,
    toolArgs: {},
    dependencies: [],
    priority: 50
  });
}

function makeWriteTask(id, file) {
  return new Task({
    id,
    kind: TaskKind.CODING,
    goal: `Write file: ${file}`,
    tool: 'WRITE_FILE',
    toolArgs: { path: file, content: 'content', file },
    dependencies: [],
    priority: 54
  });
}

// =============================================================================
// hasReasoningTasks()
// =============================================================================

describe('hasReasoningTasks()', () => {
  it('returns false when planner has no tasks', () => {
    const planner = new Planner([]);
    assert.equal(planner.hasReasoningTasks(), false);
  });

  it('returns false when no REASONING tasks exist', () => {
    const tasks = [makeCodingTask('t1'), makeCodingTask('t2')];
    const planner = new Planner(tasks);
    assert.equal(planner.hasReasoningTasks(), false);
  });

  it('returns true when a REASONING task exists with PENDING status', () => {
    const tasks = [makeReasoningTask('r1')];
    const planner = new Planner(tasks);
    assert.equal(planner.hasReasoningTasks(), true);
  });

  it('returns true when a REASONING task exists with READY status', () => {
    const tasks = [makeReasoningTask('r1')];
    const planner = new Planner(tasks);
    planner.graph.getNode('r1').status = TaskStatus.READY;
    assert.equal(planner.hasReasoningTasks(), true);
  });

  it('returns false when REASONING task is already SUCCESS', () => {
    const tasks = [makeReasoningTask('r1')];
    const planner = new Planner(tasks);
    planner.markSuccess('r1', {});
    assert.equal(planner.hasReasoningTasks(), false);
  });

  it('returns false when REASONING task is FAILED', () => {
    const tasks = [makeReasoningTask('r1')];
    const planner = new Planner(tasks);
    planner.markFailure('r1', 'failed');
    assert.equal(planner.hasReasoningTasks(), false);
  });

  it('returns true for GENERATE_CONTENT (old kind) tasks with PENDING status', () => {
    const task = new Task({
      id: 'r1',
      kind: TaskKind.GENERATE_CONTENT,
      goal: 'Generate content for file: x.js',
      tool: null,
      toolArgs: {},
      dependencies: []
    });
    const planner = new Planner([task]);
    assert.equal(planner.hasReasoningTasks(), true);
  });

  it('returns false when mix of CODING and completed REASONING tasks', () => {
    const tasks = [
      makeCodingTask('t1'),
      makeReasoningTask('r1')
    ];
    const planner = new Planner(tasks);
    planner.markSuccess('r1', {});
    assert.equal(planner.hasReasoningTasks(), false);
  });

  it('returns true when multiple REASONING tasks exist and some are pending', () => {
    const tasks = [
      makeReasoningTask('r1'),
      makeReasoningTask('r2'),
      makeReasoningTask('r3')
    ];
    const planner = new Planner(tasks);
    planner.markSuccess('r1', {});
    assert.equal(planner.hasReasoningTasks(), true);
  });
});

// =============================================================================
// getNextReasoningTask()
// =============================================================================

describe('getNextReasoningTask()', () => {
  it('returns null when planner has no tasks', () => {
    const planner = new Planner([]);
    assert.equal(planner.getNextReasoningTask(), null);
  });

  it('returns null when no REASONING tasks exist', () => {
    const tasks = [makeCodingTask('t1')];
    const planner = new Planner(tasks);
    assert.equal(planner.getNextReasoningTask(), null);
  });

  it('returns the REASONING task when one exists', () => {
    const tasks = [makeReasoningTask('r1')];
    const planner = new Planner(tasks);
    const next = planner.getNextReasoningTask();
    assert.notEqual(next, null);
    assert.equal(next.id, 'r1');
    assert.equal(next.kind, TaskKind.REASONING);
  });

  it('returns the highest-priority REASONING task', () => {
    const tasks = [
      makeReasoningTask('r1', TaskStatus.PENDING, 50),
      makeReasoningTask('r2', TaskStatus.PENDING, 30),
      makeReasoningTask('r3', TaskStatus.PENDING, 70)
    ];
    const planner = new Planner(tasks);
    const next = planner.getNextReasoningTask();
    assert.notEqual(next, null);
    assert.equal(next.id, 'r3');
  });

  it('returns null when REASONING task is already SUCCESS', () => {
    const tasks = [makeReasoningTask('r1')];
    const planner = new Planner(tasks);
    planner.markSuccess('r1', {});
    assert.equal(planner.getNextReasoningTask(), null);
  });

  it('returns null when REASONING task is FAILED', () => {
    const tasks = [makeReasoningTask('r1')];
    const planner = new Planner(tasks);
    planner.markFailure('r1', 'failed');
    assert.equal(planner.getNextReasoningTask(), null);
  });

  it('returns REASONING task over CODING tasks', () => {
    const tasks = [
      makeCodingTask('t1'),
      makeReasoningTask('r1', TaskStatus.PENDING, 50)
    ];
    const planner = new Planner(tasks);
    const next = planner.getNextReasoningTask();
    assert.notEqual(next, null);
    assert.equal(next.id, 'r1');
  });

  it('handles GENERATE_CONTENT kind tasks', () => {
    const task = new Task({
      id: 'r1',
      kind: TaskKind.GENERATE_CONTENT,
      goal: 'Generate content for file: x.js',
      tool: null,
      toolArgs: {},
      dependencies: [],
      priority: 50
    });
    const planner = new Planner([task]);
    const next = planner.getNextReasoningTask();
    assert.notEqual(next, null);
    assert.equal(next.id, 'r1');
  });
});

// =============================================================================
// replaceReasoningTask()
// =============================================================================

describe('replaceReasoningTask()', () => {
  it('returns false when taskId does not exist', () => {
    const planner = new Planner([]);
    const result = planner.replaceReasoningTask('nonexistent', []);
    assert.equal(result, false);
  });

  it('marks the reasoning task as SUCCESS', () => {
    const tasks = [makeReasoningTask('r1')];
    const planner = new Planner(tasks);
    planner.replaceReasoningTask('r1', []);
    const node = planner.graph.getNode('r1');
    assert.equal(node.status, TaskStatus.SUCCESS);
  });

  it('sets task result with replacement info', () => {
    const tasks = [makeReasoningTask('r1')];
    const planner = new Planner(tasks);
    planner.replaceReasoningTask('r1', []);
    const node = planner.graph.getNode('r1');
    assert.ok(node.result);
    assert.equal(node.result.replaced, true);
    assert.ok(Array.isArray(node.result.executionTasks));
  });

  it('returns array of added task IDs', () => {
    const tasks = [makeReasoningTask('r1')];
    const planner = new Planner(tasks);
    const writeTask = makeWriteTask('w1', 'test.js');
    const addedIds = planner.replaceReasoningTask('r1', [writeTask]);
    assert.ok(Array.isArray(addedIds));
    assert.equal(addedIds.length, 1);
    assert.equal(addedIds[0], 'w1');
  });

  it('adds execution tasks to the planner graph', () => {
    const tasks = [makeReasoningTask('r1')];
    const planner = new Planner(tasks);
    const writeTask = makeWriteTask('w1', 'test.js');
    planner.replaceReasoningTask('r1', [writeTask]);
    const node = planner.graph.getNode('w1');
    assert.notEqual(node, null);
    assert.equal(node.tool, 'WRITE_FILE');
  });

  it('sets first execution task dependency on the reasoning task', () => {
    const tasks = [makeReasoningTask('r1')];
    const planner = new Planner(tasks);
    const writeTask = makeWriteTask('w1', 'test.js');
    planner.replaceReasoningTask('r1', [writeTask]);
    const node = planner.graph.getNode('w1');
    assert.ok(node.dependencies.has('r1'));
  });

  it('chains sequential execution tasks', () => {
    const tasks = [makeReasoningTask('r1')];
    const planner = new Planner(tasks);
    const writeTask1 = makeWriteTask('w1', 'test1.js');
    const writeTask2 = makeWriteTask('w2', 'test2.js');
    const writeTask3 = makeWriteTask('w3', 'test3.js');
    planner.replaceReasoningTask('r1', [writeTask1, writeTask2, writeTask3]);

    const node1 = planner.graph.getNode('w1');
    const node2 = planner.graph.getNode('w2');
    const node3 = planner.graph.getNode('w3');

    assert.ok(node1.dependencies.has('r1'));
    assert.ok(node2.dependencies.has('w1'));
    assert.ok(node3.dependencies.has('w2'));
  });

  it('updates ready states after replacement', () => {
    const tasks = [makeReasoningTask('r1')];
    const planner = new Planner(tasks);
    const writeTask = makeWriteTask('w1', 'test.js');
    planner.replaceReasoningTask('r1', [writeTask]);
    const node = planner.graph.getNode('w1');
    assert.equal(node.status, TaskStatus.READY);
  });

  it('works with single execution task', () => {
    const tasks = [makeReasoningTask('r1')];
    const planner = new Planner(tasks);
    const writeTask = makeWriteTask('w1', 'test.js');
    const addedIds = planner.replaceReasoningTask('r1', [writeTask]);
    assert.equal(addedIds.length, 1);
    assert.equal(addedIds[0], 'w1');
  });

  it('works with multiple execution tasks', () => {
    const tasks = [makeReasoningTask('r1')];
    const planner = new Planner(tasks);
    const t1 = makeWriteTask('w1', 'test1.js');
    const t2 = makeWriteTask('w2', 'test2.js');
    const t3 = makeWriteTask('w3', 'test3.js');
    const addedIds = planner.replaceReasoningTask('r1', [t1, t2, t3]);
    assert.equal(addedIds.length, 3);
    assert.deepEqual(addedIds, ['w1', 'w2', 'w3']);
  });

  it('preserves existing execution task dependencies', () => {
    const tasks = [makeReasoningTask('r1')];
    const planner = new Planner(tasks);
    const writeTask = new Task({
      id: 'w1',
      kind: TaskKind.CODING,
      goal: 'Write file: test.js',
      tool: 'WRITE_FILE',
      toolArgs: { path: 'test.js', content: 'content', file: 'test.js' },
      dependencies: ['some-other-dep'],
      priority: 54
    });
    planner.replaceReasoningTask('r1', [writeTask]);
    const node = planner.graph.getNode('w1');
    assert.ok(node.dependencies.has('some-other-dep'));
    assert.ok(node.dependencies.has('r1'));
  });

  it('includes execution task info in reasoning task result', () => {
    const tasks = [makeReasoningTask('r1')];
    const planner = new Planner(tasks);
    const writeTask = makeWriteTask('w1', 'test.js');
    planner.replaceReasoningTask('r1', [writeTask]);
    const node = planner.graph.getNode('r1');
    assert.equal(node.result.executionTasks.length, 1);
    assert.equal(node.result.executionTasks[0].id, 'w1');
    assert.equal(node.result.executionTasks[0].tool, 'WRITE_FILE');
  });

  it('handles empty execution tasks array gracefully', () => {
    const tasks = [makeReasoningTask('r1')];
    const planner = new Planner(tasks);
    const addedIds = planner.replaceReasoningTask('r1', []);
    assert.ok(Array.isArray(addedIds));
    assert.equal(addedIds.length, 0);
  });
});
