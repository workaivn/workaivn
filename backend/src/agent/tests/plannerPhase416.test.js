import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Planner } from '../planner/planner.js';
import { Task } from '../planner/task.js';
import { notifyToolExecution } from '../planner/executionController.js';
import { executeTool } from '../toolExecutor.js';
import { ExecutionMemoryStatus } from '../planner/executionMemory.js';
import { buildPlan, expandRepeatedCommands } from '../planner/planBuilder.js';

async function withTempWorkspace(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase416-'));
  try {
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'phase416-test' }, null, 2)
    );
    await fs.writeFile(
      path.join(root, 'src', 'execution-memory-test.js'),
      'console.log("PHASE416_OK")\n'
    );
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function runPlannerUntilComplete(planner, workspaceRoot, onDispatch) {
  const context = { workspaceRoot, cwd: workspaceRoot };
  const toolCtx = { workspaceRoot };
  while (!planner.isComplete()) {
    const task = planner.getNextTask();
    if (!task?.tool) break;

    const resolution = planner.prepareTaskDispatch(task, context);
    if (resolution.action === 'WAIT') {
      planner.resolveWaitingTasks([task], context);
      continue;
    }
    if (!resolution.dispatch) {
      if (resolution.action === 'REUSE_FAILURE') {
        planner.markFailure(task.id, `Previous identical ${task.tool} task failed`);
      }
      continue;
    }

    onDispatch?.(task, resolution);
    planner.markTaskRunning(task, context);
    console.log('[PLANNER_DISPATCH]', {
      taskId: task.id,
      tool: task.tool,
      args: task.toolArgs || {}
    });

    const result = await executeTool(task.tool, task.toolArgs || {}, toolCtx);
    notifyToolExecution(planner, task.tool, task.toolArgs || {}, result);

    if (task.tool === 'RUN_TERMINAL' && task.id === 'run1' && result?.success) {
      planner.executionMemory.setReasoning(task.goal, {
        taskId: task.id,
        tool: task.tool
      });
    }
  }
}

test('Phase 4.16: expandRepeatedCommands preserves duplicate Run directives', () => {
  const cmd = 'node src/execution-memory-test.js';
  const objective = `Run: ${cmd}\nRun: ${cmd}`;
  const expanded = expandRepeatedCommands(objective, [cmd]);
  assert.equal(expanded.length, 2, 'duplicate Run directives must produce two planner commands');
  assert.deepEqual(expanded, [cmd, cmd]);
});

test('Phase 4.16: buildPlan keeps duplicate RUN_TERMINAL tasks', () => {
  const cmd = 'node src/execution-memory-test.js';
  const objective = `Read package.json\nWrite src/execution-memory-test.js with:\nconsole.log("PHASE416_OK");\nRun: ${cmd}\nRun: ${cmd}`;
  const plan = buildPlan(objective, {
    taskType: 'CODING',
    requestedFiles: ['package.json', 'src/execution-memory-test.js'],
    requiredCommands: [cmd]
  });
  const terminalTasks = plan.tasks.filter(t => t.tool === 'RUN_TERMINAL');
  assert.equal(terminalTasks.length, 2, 'planner must contain two RUN_TERMINAL tasks');
  assert.ok(plan.tasks.some(t => t.tool === 'READ_FILE'));
  assert.ok(plan.tasks.some(t => t.tool === 'WRITE_FILE'));
});

test('Phase 4.16 regression: READ_FILE + WRITE_FILE + duplicate RUN_TERMINAL reuses ExecutionMemory', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const cmd = 'node src/execution-memory-test.js';
    const writeContent = 'console.log("PHASE416_OK");\n';
    const planner = new Planner([
      new Task({
        id: 'read1',
        kind: 'ANALYSIS',
        goal: 'Read file: package.json',
        tool: 'READ_FILE',
        toolArgs: { path: 'package.json' }
      }),
      new Task({
        id: 'write1',
        kind: 'CODING',
        goal: 'Write execution test file',
        tool: 'WRITE_FILE',
        toolArgs: { path: 'src/execution-memory-test.js', content: writeContent },
        dependencies: ['read1']
      }),
      new Task({
        id: 'run1',
        kind: 'CODING',
        goal: 'Run command',
        tool: 'RUN_TERMINAL',
        toolArgs: { command: cmd },
        dependencies: ['write1']
      }),
      new Task({
        id: 'run2',
        kind: 'CODING',
        goal: 'Run command',
        tool: 'RUN_TERMINAL',
        toolArgs: { command: cmd },
        dependencies: ['run1']
      })
    ]);
    planner.executionMemory.setContext({ workspaceRoot, cwd: workspaceRoot });
    planner._updateReadyStates();

    const logs = [];
    const origLog = console.log;
    console.log = (...args) => {
      logs.push(args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
      origLog.apply(console, args);
    };

    const dispatchLog = [];
    try {
      await runPlannerUntilComplete(planner, workspaceRoot, (task, resolution) => {
        dispatchLog.push({ taskId: task.id, tool: task.tool, action: resolution.action });
      });

      assert.equal(planner.graph.getNode('read1').status, 'SUCCESS');
      assert.equal(planner.graph.getNode('write1').status, 'SUCCESS');
      assert.equal(planner.graph.getNode('run1').status, 'SUCCESS');
      assert.equal(planner.graph.getNode('run2').status, 'SUCCESS');

      const terminalDispatches = dispatchLog.filter(d => d.tool === 'RUN_TERMINAL');
      assert.equal(terminalDispatches.length, 1, 'identical RUN_TERMINAL must dispatch once');
      assert.equal(terminalDispatches[0].taskId, 'run1');
      assert.equal(terminalDispatches[0].action, 'MISS');

      assert.ok(
        logs.some(l => l.includes('[EXECUTION_MEMORY_LOOKUP]') && l.includes('NOT_EXECUTED')),
        'first terminal lookup should miss'
      );
      assert.ok(
        logs.some(l => l.includes('[PLANNER_DISPATCH]') && l.includes('run1')),
        'first terminal should dispatch'
      );
      assert.ok(
        logs.some(l => l.includes('[EXECUTION_MEMORY_STORE]') && l.includes('SUCCEEDED')),
        'first terminal should store success'
      );
      assert.ok(
        logs.some(l => l.includes('[EXECUTION_MEMORY_HIT]') && l.includes('SUCCEEDED')),
        'second terminal lookup should hit'
      );
      assert.ok(logs.some(l => l.includes('[EXECUTION_MEMORY_SKIP]')), 'duplicate execution skipped');
      assert.ok(logs.some(l => l.includes('[REASONING_REUSED]')), 'reasoning reused on memory hit');

      const stats = planner.getMemorySummary();
      assert.ok(stats.memoryHits > 0, 'Memory hits > 0');
      assert.ok(stats.skippedDuplicateExecutions > 0, 'Skipped duplicate executions > 0');
      assert.ok(stats.reasoningReused > 0, 'Reasoning reused > 0');
      assert.ok(stats.retriesAvoided > 0, 'Retries avoided > 0');

      const run2Lookup = planner.executionMemory.lookup(
        { tool: 'RUN_TERMINAL', toolArgs: { command: cmd } },
        { workspaceRoot, cwd: workspaceRoot }
      );
      assert.equal(run2Lookup.status, ExecutionMemoryStatus.SUCCEEDED);
      assert.ok(run2Lookup.executionKey.includes('RUN_TERMINAL:node src/execution-memory-test.js'));
    } finally {
      console.log = origLog;
    }
  });
});
