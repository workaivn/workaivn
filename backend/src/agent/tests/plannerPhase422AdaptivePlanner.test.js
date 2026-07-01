import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Planner } from '../planner/planner.js';
import { Task } from '../planner/task.js';
import { TaskStatus } from '../planner/plannerTypes.js';

const WORKSPACE_ROOT = 'G:/planner-adaptive-test';

function makeWriteTask(id, file) {
  return new Task({
    id,
    kind: 'CODING',
    goal: `Write ${file}`,
    tool: 'WRITE_FILE',
    toolArgs: { path: file, content: 'hello' }
  });
}

test('Phase 4.22: dynamic priority prefers cached tasks deterministically', () => {
  const fresh = makeWriteTask('fresh-task', 'fresh.js');
  const cached = makeWriteTask('cached-task', 'cached.js');
  const planner = new Planner([fresh, cached]);
  planner.executionMemory.setContext({ workspaceRoot: WORKSPACE_ROOT });
  planner.executionMemory.markSucceeded(cached, {
    tool: 'WRITE_FILE',
    args: { path: 'cached.js', content: 'hello' },
    result: { success: true, file: 'cached.js' }
  });

  const next = planner.getNextTask();
  assert.equal(next.id, 'cached-task', 'cached task should be selected first');
  assert.equal(next.status, TaskStatus.READY);

  const adaptive = planner.getAdaptiveSnapshot({ workspaceRoot: WORKSPACE_ROOT });
  const cachedPriority = adaptive.priorityAdjustments.find(item => item.taskId === 'cached-task');
  const freshPriority = adaptive.priorityAdjustments.find(item => item.taskId === 'fresh-task');
  assert.ok(cachedPriority.adaptivePriority > freshPriority.adaptivePriority, 'cache hit should raise priority');
});

test('Phase 4.22: parallel optimization keeps independent tasks together', () => {
  const readA = new Task({
    id: 'read-a',
    kind: 'CODING',
    goal: 'Read a.json',
    tool: 'READ_FILE',
    toolArgs: { path: 'a.json' }
  });
  const readB = new Task({
    id: 'read-b',
    kind: 'CODING',
    goal: 'Read b.json',
    tool: 'READ_FILE',
    toolArgs: { path: 'b.json' }
  });
  const planner = new Planner([readA, readB]);
  planner.executionMemory.setContext({ workspaceRoot: WORKSPACE_ROOT });
  planner.executionMemory.markSucceeded(readB, {
    tool: 'READ_FILE',
    args: { path: 'b.json' },
    result: { success: true, file: 'b.json', content: '{}' }
  });

  const groups = planner.findParallelReadyTasks();
  assert.equal(groups.length, 1, 'two independent reads should stay in one group');
  assert.equal(groups[0].length, 2, 'group should contain both reads');
  assert.equal(groups[0][0].id, 'read-b', 'cached read should be prioritized within the group');
});

test('Phase 4.22: cache-aware planning and adaptive prediction are deterministic', () => {
  const read = new Task({
    id: 'read',
    kind: 'CODING',
    goal: 'Read package.json',
    tool: 'READ_FILE',
    toolArgs: { path: 'package.json' }
  });
  const write = new Task({
    id: 'write',
    kind: 'CODING',
    goal: 'Write src/app.js',
    tool: 'WRITE_FILE',
    toolArgs: { path: 'src/app.js', content: 'console.log("hi")' },
    dependencies: ['read']
  });
  const run = new Task({
    id: 'run',
    kind: 'CODING',
    goal: 'Run tests',
    tool: 'RUN_TERMINAL',
    toolArgs: { command: 'npm test' },
    dependencies: ['write']
  });

  const planner = new Planner([read, write, run]);
  planner.executionMemory.setContext({ workspaceRoot: WORKSPACE_ROOT });
  planner.executionMemory.markSucceeded(read, {
    tool: 'READ_FILE',
    args: { path: 'package.json' },
    result: { success: true, file: 'package.json', content: '{}' }
  });

  const dispatch = planner.prepareTaskDispatch(read, { workspaceRoot: WORKSPACE_ROOT });
  assert.equal(dispatch.dispatch, false, 'cached read should not dispatch again');
  assert.equal(dispatch.action, 'HIT');

  const adaptive = planner.getAdaptiveSnapshot({ workspaceRoot: WORKSPACE_ROOT });
  assert.ok(adaptive.prediction.expectedTotalRuntime > 0, 'prediction should include expected runtime');
  assert.ok(Array.isArray(adaptive.criticalPath.path), 'critical path should be an array');
  assert.ok(adaptive.criticalPath.path.length >= 3, 'critical path should include the dependency chain');
  assert.ok(adaptive.bottlenecks.longestTask, 'bottleneck detection should identify a longest task');
  assert.ok(adaptive.metrics.parallelEfficiency >= 0 && adaptive.metrics.parallelEfficiency <= 1, 'parallel efficiency should be normalized');
  assert.ok(adaptive.metrics.cacheUtilization >= 0 && adaptive.metrics.cacheUtilization <= 1, 'cache utilization should be normalized');

  const roundTrip = JSON.parse(JSON.stringify(adaptive));
  assert.deepEqual(roundTrip.metrics, adaptive.metrics, 'adaptive snapshot must remain JSON-safe');
});

test('Phase 4.22: planner debug HTML exposes the adaptive planning tab and panel', async () => {
  const html = await fs.readFile(path.resolve(process.cwd(), 'generated/planner-debug.html'), 'utf8');
  assert.ok(html.includes('Adaptive Planning'), 'HTML must expose the Adaptive Planning tab');
  assert.ok(html.includes('panel-adaptive'), 'HTML must include the adaptive panel');
  assert.ok(html.includes('renderAdaptive(d)'), 'HTML must render adaptive planning data');
  assert.ok(html.includes('adaptiveBadge'), 'HTML must display adaptive counts');
});
