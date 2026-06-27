import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runAgentLoop } from '../runAgentLoop.js';
import { createExecutionMemory, ExecutionMemoryStatus } from '../planner/executionMemory.js';
import { Planner } from '../planner/planner.js';
import { Task } from '../planner/task.js';
import { notifyToolExecution } from '../planner/executionController.js';

async function withTempWorkspace(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'exec-memory-'));
  try {
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'exec-memory-test' }, null, 2));
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'cache-test.js'), 'console.log("CACHE")\n');
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('Phase 4.16: duplicate READ_FILE in one run hits ExecutionMemory', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => {
      logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
      origLog.apply(console, args);
    };
    try {
      const result = await runAgentLoop({
        messages: [{ role: 'user', content: 'Read package.json\nRead package.json' }],
        workspaceRoot,
        maxSteps: 8,
        generateResponse: async () => JSON.stringify({ done: true, final: 'Read package.json once.' })
      });

      assert.ok(result.success || result.status === 'completed');
      const readCalls = result.toolCalls.filter(c => c.tool === 'READ_FILE' && c.args?.path === 'package.json');
      assert.equal(readCalls.length, 1, 'package.json should be physically read once');
      assert.ok(
        logs.some(l => l.includes('[EXECUTION_MEMORY_HIT]') && l.includes('SUCCEEDED')),
        'Expected EXECUTION_MEMORY_HIT for duplicate read'
      );
      assert.ok(logs.some(l => l.includes('[EXECUTION_MEMORY_SKIP]')), 'Expected duplicate execution skip');
    } finally {
      console.log = origLog;
    }
  });
});

test('Phase 4.16: duplicate RUN_TERMINAL task is answered by ExecutionMemory', () => {
  const planner = new Planner([
    new Task({ id: 'run1', kind: 'ANALYSIS', goal: 'Run command', tool: 'RUN_TERMINAL', toolArgs: { command: 'node src/cache-test.js' } }),
    new Task({ id: 'run2', kind: 'ANALYSIS', goal: 'Run command again', tool: 'RUN_TERMINAL', toolArgs: { command: 'node src/cache-test.js' } })
  ]);

  notifyToolExecution(planner, 'RUN_TERMINAL', { command: 'node src/cache-test.js' }, { success: true, exitCode: 0, stdout: 'CACHE\n' });
  const second = planner.graph.getNode('run2');
  const lookup = planner.executionMemory.lookup(second);

  assert.equal(lookup.status, ExecutionMemoryStatus.SUCCEEDED);
  assert.equal(lookup.record.tool, 'RUN_TERMINAL');
});

test('Phase 4.16 hotfix: lookup uses normalized work key, not planner task id', () => {
  const memory = createExecutionMemory();
  memory.setContext({ workspaceRoot: '/tmp/workspace', cwd: '/tmp/workspace' });
  memory.record(
    { id: 'read-a', tool: 'READ_FILE', toolArgs: { path: 'package.json' } },
    ExecutionMemoryStatus.SUCCEEDED,
    { tool: 'READ_FILE', args: { path: 'package.json' }, result: { success: true, content: '{}' } }
  );

  const lookup = memory.lookup({
    id: 'read-b',
    tool: 'READ_FILE',
    toolArgs: { path: '.\\package.json' }
  });

  assert.equal(lookup.status, ExecutionMemoryStatus.SUCCEEDED);
  assert.equal(lookup.record.taskId, 'read-a');
  assert.equal(memory.getStats().memoryHits, 1);
});

test('Phase 4.16: failed task retry/recovery can inspect ExecutionMemory', () => {
  const planner = new Planner([
    new Task({ id: 'run-fail', kind: 'CODING', goal: 'Run failing command', tool: 'RUN_TERMINAL', toolArgs: { command: 'node missing.js' }, failureNext: 'recovery' }),
    new Task({ id: 'recovery', kind: 'RECOVERY', goal: 'Recovery read', tool: 'READ_FILE', toolArgs: { path: 'package.json' } })
  ]);

  const logs = [];
  const origLog = console.log;
  console.log = (...args) => {
    logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
    origLog.apply(console, args);
  };
  try {
    notifyToolExecution(planner, 'RUN_TERMINAL', { command: 'node missing.js' }, { success: false, exitCode: 1, error: 'missing file' });
  } finally {
    console.log = origLog;
  }

  const lookup = planner.executionMemory.lookup(planner.graph.getNode('run-fail'));
  assert.equal(lookup.status, ExecutionMemoryStatus.FAILED);
  assert.ok(String(lookup.record.failureReason).includes('missing file'));
  assert.ok(logs.some(l => l.includes('[PLANNER_RECOVERY_MEMORY]')), 'Recovery should inspect ExecutionMemory');
});

test('Phase 4.16: repeated reasoning is reused', () => {
  const memory = createExecutionMemory();
  const prompt = 'Generate content for file: src/App.jsx';
  memory.setReasoning(prompt, {
    taskId: 'reason-1',
    parsedReasoning: { tool: 'WRITE_FILE', args: { path: 'src/App.jsx', content: 'export default function App() { return null; }' } }
  });
  const reused = memory.getReasoning(prompt);
  assert.ok(reused);
  assert.equal(reused.taskId, 'reason-1');
  assert.equal(memory.getStats().reasoningReused, 1);
});

test('Phase 4.16 hotfix: READ_FILE lookup hit after successful execution without duplicate DAG nodes', () => {
  const memory = createExecutionMemory();
  memory.setContext({ workspaceRoot: '/tmp/workspace', cwd: '/tmp/workspace' });
  
  // Simulate successful READ_FILE execution
  memory.record(
    { id: 'read-1', tool: 'READ_FILE', toolArgs: { path: 'package.json' } },
    ExecutionMemoryStatus.SUCCEEDED,
    { tool: 'READ_FILE', args: { path: 'package.json' }, result: { success: true, content: '{}' } }
  );
  
  // Later lookup for same normalized work (different path format)
  const lookup1 = memory.lookup({
    id: 'read-2',
    tool: 'READ_FILE',
    toolArgs: { path: '.\\package.json' }
  });
  
  assert.equal(lookup1.status, ExecutionMemoryStatus.SUCCEEDED);
  assert.equal(lookup1.record.taskId, 'read-1');
  assert.equal(memory.getStats().memoryHits, 1);
  
  // Another lookup with different taskId but same normalized args
  const lookup2 = memory.lookup('READ_FILE', { path: 'package.json' }, { workspaceRoot: '/tmp/workspace' });
  assert.equal(lookup2.status, ExecutionMemoryStatus.SUCCEEDED);
  assert.equal(memory.getStats().memoryHits, 2);
});

test('Phase 4.16 hotfix: RUN_TERMINAL lookup hit after successful execution without duplicate DAG nodes', () => {
  const memory = createExecutionMemory();
  memory.setContext({ workspaceRoot: '/tmp/workspace', cwd: '/tmp/workspace' });
  
  // Simulate successful RUN_TERMINAL execution
  memory.record(
    { id: 'run-1', tool: 'RUN_TERMINAL', toolArgs: { command: 'node src/execution-memory-test.js' } },
    ExecutionMemoryStatus.SUCCEEDED,
    { tool: 'RUN_TERMINAL', args: { command: 'node src/execution-memory-test.js' }, result: { success: true, exitCode: 0, stdout: 'OK\n' } }
  );
  
  // Later lookup for same normalized work
  const lookup1 = memory.lookup({
    id: 'run-2',
    tool: 'RUN_TERMINAL',
    toolArgs: { command: 'node src/execution-memory-test.js' }
  });
  
  assert.equal(lookup1.status, ExecutionMemoryStatus.SUCCEEDED);
  assert.equal(lookup1.record.taskId, 'run-1');
  assert.equal(memory.getStats().memoryHits, 1);
  
  // Another lookup with different taskId but same command
  const lookup2 = memory.lookup('RUN_TERMINAL', { command: 'node src/execution-memory-test.js' }, { workspaceRoot: '/tmp/workspace' });
  assert.equal(lookup2.status, ExecutionMemoryStatus.SUCCEEDED);
  assert.equal(memory.getStats().memoryHits, 2);
});

test('Phase 4.16 hotfix: planner deduplication records EXECUTION_MEMORY_DEDUPE_RECORDED', () => {
  const memory = createExecutionMemory();
  memory.setContext({ workspaceRoot: '/tmp/workspace', cwd: '/tmp/workspace' });
  
  // Record a successful execution first
  memory.record(
    { id: 'read-1', tool: 'READ_FILE', toolArgs: { path: 'package.json' } },
    ExecutionMemoryStatus.SUCCEEDED,
    { tool: 'READ_FILE', args: { path: 'package.json' }, result: { success: true, content: '{}' } }
  );
  
  // Record planner-level deduplication
  memory.recordPlannerDedupe('READ_FILE', { path: 'package.json' }, { workspaceRoot: '/tmp/workspace' });
  memory.recordPlannerDedupe('RUN_TERMINAL', { command: 'node test.js' }, { workspaceRoot: '/tmp/workspace' });
  
  const stats = memory.getStats();
  assert.equal(stats.plannerDedupesRecorded, 2);
  assert.equal(stats.skippedDuplicateExecutions, 0); // Should be separate from execution skips
});

test('Phase 4.16 hotfix: summary includes memory hits and planner dedupes', () => {
  const memory = createExecutionMemory();
  memory.setContext({ workspaceRoot: '/tmp/workspace', cwd: '/tmp/workspace' });
  
  // Record successful execution
  memory.record(
    { id: 'read-1', tool: 'READ_FILE', toolArgs: { path: 'package.json' } },
    ExecutionMemoryStatus.SUCCEEDED,
    { tool: 'READ_FILE', args: { path: 'package.json' }, result: { success: true, content: '{}' } }
  );
  
  // Lookup produces hit
  memory.lookup('READ_FILE', { path: 'package.json' }, { workspaceRoot: '/tmp/workspace' });
  memory.lookup('READ_FILE', { path: 'package.json' }, { workspaceRoot: '/tmp/workspace' });
  
  // Record planner deduplications
  memory.recordPlannerDedupe('READ_FILE', { path: 'tsconfig.json' }, { workspaceRoot: '/tmp/workspace' });
  memory.recordPlannerDedupe('RUN_TERMINAL', { command: 'npm test' }, { workspaceRoot: '/tmp/workspace' });
  
  const stats = memory.getStats();
  assert.equal(stats.memoryHits, 2);
  assert.equal(stats.plannerDedupesRecorded, 2);
  assert.equal(stats.skippedDuplicateExecutions, 0);
  
  // Verify summary output includes both
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => {
    logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
    origLog.apply(console, args);
  };
  try {
    memory.printSummary();
    const summary = logs.join('\n');
    assert.ok(summary.includes('Memory hits:                 2'), 'Summary should show memory hits');
    assert.ok(summary.includes('Planner-level dedupes:       2'), 'Summary should show planner dedupes');
    assert.ok(summary.includes('Skipped duplicate executions: 0'), 'Summary should show skipped executions separately');
  } finally {
    console.log = origLog;
  }
});
