import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskGraph } from '../taskGraph.js';
import { TaskNode } from '../taskNode.js';
import { TaskStatus } from '../plannerTypes.js';
import { Planner } from '../planner.js';
import { Task } from '../task.js';

test('TaskGraph: can create graph', () => {
  const g = new TaskGraph();
  g.create();
  assert.equal(g.allNodes().length, 0);
  assert.deepEqual(g.roots(), []);
  assert.deepEqual(g.leaves(), []);
});

test('TaskGraph: can add nodes', () => {
  const g = new TaskGraph();
  g.create();
  const a = new TaskNode({ id: 'a', kind: 'CODING', goal: 'Task A' });
  const b = new TaskNode({ id: 'b', kind: 'CODING', goal: 'Task B' });
  g.addNode(a);
  g.addNode(b);
  assert.equal(g.allNodes().length, 2);
  assert.equal(g.getNode('a'), a);
  assert.equal(g.getNode('b'), b);
});

test('TaskGraph: can connect parent -> child', () => {
  const g = new TaskGraph();
  g.create();
  const a = new TaskNode({ id: 'a', kind: 'CODING', goal: 'Task A' });
  const b = new TaskNode({ id: 'b', kind: 'CODING', goal: 'Task B' });
  g.addNode(a);
  g.addNode(b);
  g.connect('a', 'b');

  assert.ok(a.children.has('b'));
  assert.ok(b.parents.has('a'));
  assert.ok(b.dependencies.has('a'));
});

test('TaskGraph: roots() returns nodes without parents', () => {
  const g = new TaskGraph();
  g.create();
  const a = new TaskNode({ id: 'a', kind: 'CODING', goal: 'Task A' });
  const b = new TaskNode({ id: 'b', kind: 'CODING', goal: 'Task B' });
  const c = new TaskNode({ id: 'c', kind: 'CODING', goal: 'Task C' });
  g.addNode(a);
  g.addNode(b);
  g.addNode(c);
  g.connect('a', 'b');
  g.connect('b', 'c');

  const roots = g.roots();
  assert.equal(roots.length, 1);
  assert.equal(roots[0].id, 'a');
});

test('TaskGraph: leaves() returns nodes without children', () => {
  const g = new TaskGraph();
  g.create();
  const a = new TaskNode({ id: 'a', kind: 'CODING', goal: 'Task A' });
  const b = new TaskNode({ id: 'b', kind: 'CODING', goal: 'Task B' });
  const c = new TaskNode({ id: 'c', kind: 'CODING', goal: 'Task C' });
  g.addNode(a);
  g.addNode(b);
  g.addNode(c);
  g.connect('a', 'b');
  g.connect('b', 'c');

  const leaves = g.leaves();
  assert.equal(leaves.length, 1);
  assert.equal(leaves[0].id, 'c');
});

test('TaskGraph: validate() passes for valid graph', () => {
  const g = new TaskGraph();
  g.create();
  const a = new TaskNode({ id: 'a', kind: 'CODING', goal: 'Task A' });
  const b = new TaskNode({ id: 'b', kind: 'CODING', goal: 'Task B', dependencies: ['a'] });
  g.addNode(a);
  g.addNode(b);
  g.connect('a', 'b');

  const result = g.validate();
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('TaskGraph: validate() fails on duplicate ids', () => {
  const g = new TaskGraph();
  g.create();
  const a = new TaskNode({ id: 'x', kind: 'CODING', goal: 'Task A' });
  g.addNode(a);
  assert.throws(() => {
    const dup = new TaskNode({ id: 'x', kind: 'CODING', goal: 'Task Duplicate' });
    g.addNode(dup);
  }, /already exists/);
});

test('TaskGraph: validate() fails on missing dependency', () => {
  const g = new TaskGraph();
  g.create();
  const b = new TaskNode({ id: 'b', kind: 'CODING', goal: 'Task B', dependencies: ['missing'] });
  g.addNode(b);

  const result = g.validate();
  assert.equal(result.valid, false);
  const hasMissingDep = result.errors.some(e => e.includes('missing dependency'));
  assert.equal(hasMissingDep, true);
});

test('TaskGraph: validate() fails on cycle', () => {
  const g = new TaskGraph();
  g.create();
  const a = new TaskNode({ id: 'a', kind: 'CODING', goal: 'Task A' });
  const b = new TaskNode({ id: 'b', kind: 'CODING', goal: 'Task B' });
  const c = new TaskNode({ id: 'c', kind: 'CODING', goal: 'Task C' });
  g.addNode(a);
  g.addNode(b);
  g.addNode(c);
  g.connect('a', 'b');
  g.connect('b', 'c');
  g.connect('c', 'a');

  const result = g.validate();
  assert.equal(result.valid, false);
  const hasCycle = result.errors.some(e => e.includes('cycle'));
  assert.equal(hasCycle, true);
});

test('TaskGraph: Planner createPlan stores tasks in TaskGraph', () => {
  const tasks = [
    new Task({ id: 'a', kind: 'CODING', goal: 'Task A', dependencies: [] }),
    new Task({ id: 'b', kind: 'CODING', goal: 'Task B', dependencies: ['a'] })
  ];
  const planner = new Planner(tasks);

  assert.equal(planner.graph.allNodes().length, 2);
  assert.ok(planner.graph.getNode('a'));
  assert.ok(planner.graph.getNode('b'));

  const a = planner.graph.getNode('a');
  const b = planner.graph.getNode('b');
  assert.ok(a.children.has('b'));
  assert.ok(b.parents.has('a'));
  assert.ok(b.dependencies.has('a'));

  const result = planner.graph.validate();
  assert.equal(result.valid, true);
});

test('TaskGraph: Planner getNextTask returns first READY root', () => {
  const tasks = [
    new Task({ id: 'a', kind: 'CODING', goal: 'Task A', dependencies: [] }),
    new Task({ id: 'b', kind: 'CODING', goal: 'Task B', dependencies: ['a'] })
  ];
  const planner = new Planner(tasks);

  const next = planner.getNextTask();
  assert.notEqual(next, null);
  assert.equal(next.id, 'a');
  assert.equal(next.status, TaskStatus.READY);
});

test('TaskGraph: Planner markSuccess activates dependent tasks', () => {
  const tasks = [
    new Task({ id: 'a', kind: 'CODING', goal: 'Task A', dependencies: [] }),
    new Task({ id: 'b', kind: 'CODING', goal: 'Task B', dependencies: ['a'] })
  ];
  const planner = new Planner(tasks);

  planner.markSuccess('a', { output: 'done' });

  const taskA = planner.graph.getNode('a');
  assert.equal(taskA.status, TaskStatus.SUCCESS);

  const ready = planner.graph.readyTasks();
  assert.equal(ready.length, 1);
  assert.equal(ready[0].id, 'b');
});

test('TaskGraph: Planner isComplete returns true when all tasks terminal', () => {
  const tasks = [
    new Task({ id: 'a', kind: 'CODING', goal: 'Task A', dependencies: [] })
  ];
  const planner = new Planner(tasks);
  assert.equal(planner.isComplete(), false);

  planner.markSuccess('a', {});
  assert.equal(planner.isComplete(), true);
});

test('TaskGraph: Planner remainingTasks excludes terminal tasks', () => {
  const tasks = [
    new Task({ id: 'a', kind: 'CODING', goal: 'Task A', dependencies: [] }),
    new Task({ id: 'b', kind: 'CODING', goal: 'Task B', dependencies: ['a'] })
  ];
  const planner = new Planner(tasks);

  let remaining = planner.remainingTasks();
  assert.equal(remaining.length, 2);

  planner.markSuccess('a', {});
  remaining = planner.remainingTasks();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, 'b');
});

test('TaskGraph: removeNode cleans up edges', () => {
  const g = new TaskGraph();
  g.create();
  const a = new TaskNode({ id: 'a', kind: 'CODING', goal: 'Task A' });
  const b = new TaskNode({ id: 'b', kind: 'CODING', goal: 'Task B' });
  const c = new TaskNode({ id: 'c', kind: 'CODING', goal: 'Task C' });
  g.addNode(a);
  g.addNode(b);
  g.addNode(c);
  g.connect('a', 'b');
  g.connect('b', 'c');

  g.removeNode('b');

  assert.equal(g.allNodes().length, 2);
  const nodeA = g.getNode('a');
  const nodeC = g.getNode('c');
  assert.equal(nodeA.children.size, 0);
  assert.equal(nodeC.parents.size, 0);
  assert.equal(nodeC.dependencies.size, 0);
});

test('TaskGraph: disconnect removes edge', () => {
  const g = new TaskGraph();
  g.create();
  const a = new TaskNode({ id: 'a', kind: 'CODING', goal: 'Task A' });
  const b = new TaskNode({ id: 'b', kind: 'CODING', goal: 'Task B' });
  g.addNode(a);
  g.addNode(b);
  g.connect('a', 'b');

  g.disconnect('a', 'b');

  assert.equal(a.children.size, 0);
  assert.equal(b.parents.size, 0);
  assert.equal(b.dependencies.size, 0);
});

test('TaskGraph: readyTasks updates PENDING to READY when deps met', () => {
  const g = new TaskGraph();
  g.create();
  const a = new TaskNode({ id: 'a', kind: 'CODING', goal: 'Task A' });
  const b = new TaskNode({ id: 'b', kind: 'CODING', goal: 'Task B', dependencies: ['a'] });
  g.addNode(a);
  g.addNode(b);
  g.connect('a', 'b');

  let ready = g.readyTasks();
  assert.equal(ready.length, 1);
  assert.equal(ready[0].id, 'a');
  assert.equal(g.getNode('b').status, TaskStatus.PENDING);

  g.getNode('a').status = TaskStatus.SUCCESS;
  ready = g.readyTasks();
  assert.equal(ready.length, 1);
  assert.equal(ready[0].id, 'b');
  assert.equal(g.getNode('b').status, TaskStatus.READY);
});

test('TaskGraph: blockedTasks / failedTasks / completedTasks return correct subsets', () => {
  const g = new TaskGraph();
  g.create();
  const a = new TaskNode({ id: 'a', kind: 'CODING', goal: 'Task A' });
  const b = new TaskNode({ id: 'b', kind: 'CODING', goal: 'Task B' });
  const c = new TaskNode({ id: 'c', kind: 'CODING', goal: 'Task C' });
  g.addNode(a);
  g.addNode(b);
  g.addNode(c);

  a.status = TaskStatus.BLOCKED;
  b.status = TaskStatus.FAILED;
  c.status = TaskStatus.SUCCESS;

  assert.equal(g.blockedTasks().length, 1);
  assert.equal(g.blockedTasks()[0].id, 'a');

  assert.equal(g.failedTasks().length, 1);
  assert.equal(g.failedTasks()[0].id, 'b');

  assert.equal(g.completedTasks().length, 2);
  const completedIds = g.completedTasks().map(n => n.id).sort();
  assert.deepEqual(completedIds, ['b', 'c']);
});

test('TaskGraph: validate() fails when no nodes', () => {
  const g = new TaskGraph();
  g.create();
  const result = g.validate();
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('no nodes')));
});

test('TaskGraph: addNode throws on non-TaskNode', () => {
  const g = new TaskGraph();
  g.create();
  assert.throws(() => g.addNode({ id: 'x' }), /TaskNode instance/);
});

test('TaskGraph: connect throws on self-connect', () => {
  const g = new TaskGraph();
  g.create();
  const a = new TaskNode({ id: 'a', kind: 'CODING', goal: 'Task A' });
  g.addNode(a);
  assert.throws(() => g.connect('a', 'a'), /Cannot connect a node to itself/);
});

test('TaskGraph: connect throws on missing node', () => {
  const g = new TaskGraph();
  g.create();
  const a = new TaskNode({ id: 'a', kind: 'CODING', goal: 'Task A' });
  g.addNode(a);
  assert.throws(() => g.connect('a', 'nonexistent'), /not found/);
});
