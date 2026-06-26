import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskGraph } from '../taskGraph.js';
import { TaskNode } from '../taskNode.js';
import { TaskStatus } from '../plannerTypes.js';
import { Planner } from '../planner.js';
import { Task } from '../task.js';

// ── Pure dependencyUtils tests (via engine wrappers) ──

import {
  canRun,
  dependencySatisfied,
  getUnsatisfiedDependencies,
  getFailedDependencies,
  updateReadyStates,
  unlockChildren,
  blockChildren,
  explainBlocked
} from '../dependencyEngine.js';

function makeGraph() {
  const g = new TaskGraph();
  g.create();
  return g;
}

function addNode(g, id, kind, deps = []) {
  const n = new TaskNode({ id, kind: kind || 'CODING', goal: `Task ${id}`, dependencies: deps });
  g.addNode(n);
  return n;
}

// ── Graph setup helpers ──

function connectAll(g, pairs) {
  for (const [p, c] of pairs) g.connect(p, c);
}

// ── Tests ──

test('DEPENDENCY: A -> B, A SUCCESS, B becomes READY', () => {
  const g = makeGraph();
  const a = addNode(g, 'a', 'CODING');
  const b = addNode(g, 'b', 'CODING', ['a']);
  connectAll(g, [['a', 'b']]);

  updateReadyStates(g);
  assert.equal(a.status, TaskStatus.READY);
  assert.equal(b.status, TaskStatus.PENDING);

  a.status = TaskStatus.SUCCESS;
  unlockChildren(g, 'a');

  assert.equal(b.status, TaskStatus.READY);

  assert.equal(canRun(g, 'a'), false);
  assert.equal(canRun(g, 'b'), true);
});

test('DEPENDENCY: A -> B, A FAILED, B becomes BLOCKED', () => {
  const g = makeGraph();
  const a = addNode(g, 'a', 'CODING');
  const b = addNode(g, 'b', 'CODING', ['a']);
  connectAll(g, [['a', 'b']]);

  updateReadyStates(g);
  assert.equal(a.status, TaskStatus.READY);

  a.status = TaskStatus.FAILED;
  a.reason = 'Intentional failure';
  blockChildren(g, 'a', a.reason);

  assert.equal(b.status, TaskStatus.BLOCKED);
  assert.ok(b.reason.includes('Intentional failure'));

  assert.equal(canRun(g, 'b'), false);

  const failed = getFailedDependencies(g, 'b');
  assert.equal(failed.length, 1);
  assert.equal(failed[0].id, 'a');
});

test('DEPENDENCY: A -> B -> C, A FAILED, B and C become BLOCKED', () => {
  const g = makeGraph();
  const a = addNode(g, 'a', 'CODING');
  const b = addNode(g, 'b', 'CODING', ['a']);
  const c = addNode(g, 'c', 'CODING', ['b']);
  connectAll(g, [['a', 'b'], ['b', 'c']]);

  updateReadyStates(g);
  assert.equal(a.status, TaskStatus.READY);

  a.status = TaskStatus.FAILED;
  a.reason = 'Root failure';
  blockChildren(g, 'a', a.reason);

  assert.equal(b.status, TaskStatus.BLOCKED);
  assert.equal(c.status, TaskStatus.BLOCKED);
});

test('DEPENDENCY: A and B -> C, A SUCCESS, B PENDING, C not READY', () => {
  const g = makeGraph();
  const a = addNode(g, 'a', 'CODING');
  const b = addNode(g, 'b', 'CODING');
  const c = addNode(g, 'c', 'CODING', ['a', 'b']);
  connectAll(g, [['a', 'c'], ['b', 'c']]);

  updateReadyStates(g);
  a.status = TaskStatus.SUCCESS;
  unlockChildren(g, 'a');

  // C should still be PENDING because B is not SUCCESS
  assert.equal(c.status, TaskStatus.PENDING);

  const unsatisfied = getUnsatisfiedDependencies(g, 'c');
  assert.equal(unsatisfied.length, 1);
  assert.equal(unsatisfied[0].id, 'b');
});

test('DEPENDENCY: A and B -> C, A SUCCESS, B SUCCESS, C becomes READY', () => {
  const g = makeGraph();
  const a = addNode(g, 'a', 'CODING');
  const b = addNode(g, 'b', 'CODING');
  const c = addNode(g, 'c', 'CODING', ['a', 'b']);
  connectAll(g, [['a', 'c'], ['b', 'c']]);

  updateReadyStates(g);
  a.status = TaskStatus.SUCCESS;
  b.status = TaskStatus.SUCCESS;
  unlockChildren(g, 'a');
  unlockChildren(g, 'b');

  assert.equal(c.status, TaskStatus.READY);
});

test('DEPENDENCY: getNextTask never returns BLOCKED child', () => {
  const tasks = [
    new Task({ id: 'a', kind: 'CODING', goal: 'Task A', dependencies: [] }),
    new Task({ id: 'b', kind: 'CODING', goal: 'Task B', dependencies: ['a'] })
  ];
  const planner = new Planner(tasks);

  // Initially only A is READY
  assert.equal(planner.getNextTask()?.id, 'a');

  // A fails
  planner.markFailure('a', 'Fatal error');

  // getNextTask must not return B (blocked)
  const next = planner.getNextTask();
  assert.equal(next, null, 'getNextTask should return null when only blocked tasks remain');
});

test('DEPENDENCY: isComplete false if any task BLOCKED', () => {
  const tasks = [
    new Task({ id: 'a', kind: 'CODING', goal: 'Task A', dependencies: [] }),
    new Task({ id: 'b', kind: 'CODING', goal: 'Task B', dependencies: ['a'] })
  ];
  const planner = new Planner(tasks);

  planner.markFailure('a', 'Fail');

  assert.equal(planner.isComplete(), false);
});

test('DEPENDENCY: isComplete false if final not SUCCESS', () => {
  const tasks = [
    new Task({ id: 'a', kind: 'CODING', goal: 'Task A', dependencies: [] })
  ];
  const planner = new Planner(tasks);

  assert.equal(planner.isComplete(), false);

  planner.markSuccess('a', {});
  assert.equal(planner.isComplete(), true);
});

test('DEPENDENCY: explainBlocked returns dependency reason', () => {
  const g = makeGraph();
  const a = addNode(g, 'a', 'CODING');
  const b = addNode(g, 'b', 'CODING', ['a']);
  connectAll(g, [['a', 'b']]);

  updateReadyStates(g);
  a.status = TaskStatus.FAILED;
  a.reason = 'Something went wrong';
  blockChildren(g, 'a', a.reason);

  const explanation = explainBlocked(g, 'b');
  assert.equal(explanation.blocked, true);
  assert.equal(explanation.reasons.length, 1);
  assert.equal(explanation.reasons[0].status, 'FAILED');
  assert.equal(explanation.reasons[0].dependency, 'a');
});

// ── Planner integration: multi-node graph ──

test('DEPENDENCY: Planner multi-node graph READ -> PATCH -> RUN -> FINAL', () => {
  const tasks = [
    new Task({ id: 'read', kind: 'READ_ONLY', goal: 'Read files', dependencies: [] }),
    new Task({ id: 'patch', kind: 'CODING', goal: 'Apply patch', dependencies: ['read'] }),
    new Task({ id: 'run', kind: 'CODING', goal: 'Run tests', dependencies: ['patch'] }),
    new Task({ id: 'final', kind: 'CODING', goal: 'Summarize', dependencies: ['run'] })
  ];
  const planner = new Planner(tasks);

  // Step 1: Only READ is READY
  assert.equal(planner.getNextTask()?.id, 'read');
  assert.equal(planner.graph.getNode('patch').status, TaskStatus.PENDING);
  assert.equal(planner.graph.getNode('run').status, TaskStatus.PENDING);
  assert.equal(planner.graph.getNode('final').status, TaskStatus.PENDING);

  // Step 2: READ succeeds, PATCH unlocks
  planner.markSuccess('read', { content: 'data' });
  assert.equal(planner.getNextTask()?.id, 'patch');
  assert.equal(planner.graph.getNode('run').status, TaskStatus.PENDING);
  assert.equal(planner.graph.getNode('final').status, TaskStatus.PENDING);

  // Step 3: PATCH succeeds, RUN unlocks
  planner.markSuccess('patch', { changed: true });
  assert.equal(planner.getNextTask()?.id, 'run');

  // Step 4: RUN succeeds, FINAL unlocks
  planner.markSuccess('run', { output: 'tests passed' });
  assert.equal(planner.getNextTask()?.id, 'final');

  // Step 5: FINAL succeeds, all done
  planner.markSuccess('final', { text: 'done' });
  assert.equal(planner.isComplete(), true);
  assert.equal(planner.getNextTask(), null);
});

test('DEPENDENCY: Planner multi-node graph with failure blocks downstream', () => {
  const tasks = [
    new Task({ id: 'read', kind: 'READ_ONLY', goal: 'Read files', dependencies: [] }),
    new Task({ id: 'patch', kind: 'CODING', goal: 'Apply patch', dependencies: ['read'] }),
    new Task({ id: 'run', kind: 'CODING', goal: 'Run tests', dependencies: ['patch'] })
  ];
  const planner = new Planner(tasks);

  assert.equal(planner.getNextTask()?.id, 'read');

  // READ fails
  planner.markFailure('read', 'File not found');

  // PATCH and RUN must be BLOCKED
  assert.equal(planner.graph.getNode('patch').status, TaskStatus.BLOCKED);
  assert.equal(planner.graph.getNode('run').status, TaskStatus.BLOCKED);

  // getNextTask returns null
  assert.equal(planner.getNextTask(), null);

  // isComplete returns false
  assert.equal(planner.isComplete(), false);

  // explainBlocked works
  const explanation = planner.explainBlocked('run');
  assert.equal(explanation.blocked, true);
});

test('DEPENDENCY: markBlocked propagates to children', () => {
  const tasks = [
    new Task({ id: 'a', kind: 'CODING', goal: 'Task A', dependencies: [] }),
    new Task({ id: 'b', kind: 'CODING', goal: 'Task B', dependencies: ['a'] }),
    new Task({ id: 'c', kind: 'CODING', goal: 'Task C', dependencies: ['b'] })
  ];
  const planner = new Planner(tasks);

  planner.markBlocked('a', 'External dependency unavailable');

  assert.equal(planner.graph.getNode('a').status, TaskStatus.BLOCKED);
  assert.equal(planner.graph.getNode('b').status, TaskStatus.BLOCKED);
  assert.equal(planner.graph.getNode('c').status, TaskStatus.BLOCKED);
  assert.equal(planner.getNextTask(), null);
});

test('DEPENDENCY: remainingTasks includes BLOCKED and FAILED with reasons', () => {
  const tasks = [
    new Task({ id: 'a', kind: 'CODING', goal: 'Task A', dependencies: [] }),
    new Task({ id: 'b', kind: 'CODING', goal: 'Task B', dependencies: ['a'] })
  ];
  const planner = new Planner(tasks);

  planner.markFailure('a', 'Crash');

  const remaining = planner.remainingTasks();
  assert.equal(remaining.length, 2);
  const blockedB = remaining.find(t => t.id === 'b');
  assert.ok(blockedB);
  assert.equal(blockedB.status, TaskStatus.BLOCKED);
});

test('DEPENDENCY: isComplete returns false when FAILED exists', () => {
  const tasks = [
    new Task({ id: 'a', kind: 'CODING', goal: 'Task A', dependencies: [] })
  ];
  const planner = new Planner(tasks);
  planner.markFailure('a', 'error');
  assert.equal(planner.isComplete(), false);
});

test('DEPENDENCY: dependencySatisfied returns correct values', () => {
  const g = makeGraph();
  const a = addNode(g, 'a', 'CODING');
  const b = addNode(g, 'b', 'CODING', ['a']);
  connectAll(g, [['a', 'b']]);

  assert.equal(dependencySatisfied(g, 'a'), true);
  assert.equal(dependencySatisfied(g, 'b'), false);

  a.status = TaskStatus.SUCCESS;
  assert.equal(dependencySatisfied(g, 'b'), true);
});

test('DEPENDENCY: updateReadyStates blocks tasks with FAILED dependencies', () => {
  const g = makeGraph();
  const a = addNode(g, 'a', 'CODING');
  const b = addNode(g, 'b', 'CODING', ['a']);
  connectAll(g, [['a', 'b']]);

  a.status = TaskStatus.FAILED;
  a.reason = 'Failed';
  b.status = TaskStatus.PENDING;

  updateReadyStates(g);
  // b was PENDING but a is FAILED, so b should become BLOCKED
  assert.equal(b.status, TaskStatus.BLOCKED);
});

test('DEPENDENCY: updateReadyStates blocks tasks with BLOCKED dependencies', () => {
  const g = makeGraph();
  const a = addNode(g, 'a', 'CODING');
  const b = addNode(g, 'b', 'CODING', ['a']);
  connectAll(g, [['a', 'b']]);

  a.status = TaskStatus.BLOCKED;
  b.status = TaskStatus.PENDING;

  updateReadyStates(g);
  assert.equal(b.status, TaskStatus.BLOCKED);
});
