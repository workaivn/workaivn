import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TaskNode } from '../taskNode.js';
import { Task } from '../task.js';
import { Planner } from '../planner.js';
import { TaskStatus } from '../plannerTypes.js';
import {
  notifyToolExecution,
  canExecuteTool,
  logPlannerStatus,
  validatePackageJsonAfterWrite,
  tryRecovery
} from '../executionController.js';

function makePlanner(tasks) {
  return new Planner(tasks || []);
}

function makeTask(id, kind, deps = []) {
  return new Task({ id, kind: kind || 'CODING', goal: `Task ${id}`, dependencies: deps });
}

test('notifyToolExecution: returns handled:false for null planner', () => {
  const result = notifyToolExecution(null, 'READ_FILE', {}, { success: true });
  assert.equal(result.handled, false);
});

test('notifyToolExecution: returns handled:false for planner with no tasks', () => {
  const planner = makePlanner([]);
  const result = notifyToolExecution(planner, 'READ_FILE', {}, { success: true });
  assert.equal(result.handled, false);
});

test('notifyToolExecution: marks single task SUCCESS on success result', () => {
  const planner = makePlanner([makeTask('t1', 'CODING')]);
  const result = notifyToolExecution(planner, 'READ_FILE', { path: 'test.js' }, { success: true, content: 'ok' });
  assert.equal(result.handled, true);
  assert.equal(result.taskId, 't1');
  assert.equal(result.status, 'SUCCESS');
  const task = planner.graph.getNode('t1');
  assert.equal(task.status, TaskStatus.SUCCESS);
});

test('notifyToolExecution: marks single task FAILED on failure result', () => {
  const planner = makePlanner([makeTask('t1', 'CODING')]);
  const result = notifyToolExecution(planner, 'WRITE_FILE', { path: 'test.js' }, { success: false, error: 'permission denied' });
  assert.equal(result.handled, true);
  assert.equal(result.taskId, 't1');
  assert.equal(result.status, 'FAILED');
  const task = planner.graph.getNode('t1');
  assert.equal(task.status, TaskStatus.FAILED);
  assert.ok(task.reason.includes('permission denied'));
});

test('canExecuteTool: returns allowed:true for null planner', () => {
  const gate = canExecuteTool(null, 'terminal');
  assert.equal(gate.allowed, true);
  const gate2 = canExecuteTool(null, 'final');
  assert.equal(gate2.allowed, true);
});

test('canExecuteTool: returns allowed:true when no failures', () => {
  const planner = makePlanner([makeTask('t1', 'CODING')]);
  assert.equal(canExecuteTool(planner, 'terminal').allowed, true);
  assert.equal(canExecuteTool(planner, 'final').allowed, true);
});

test('canExecuteTool: blocks terminal and final when task FAILED', () => {
  const planner = makePlanner([makeTask('t1', 'CODING')]);
  planner.markFailure('t1', 'something broke');
  assert.equal(canExecuteTool(planner, 'terminal').allowed, false);
  assert.equal(canExecuteTool(planner, 'final').allowed, false);
});

test('canExecuteTool: blocks terminal and final when task BLOCKED (no FAILED)', () => {
  const a = makeTask('a', 'CODING');
  const b = makeTask('b', 'CODING', ['a']);
  const planner = makePlanner([a, b]);
  // Manually set b to BLOCKED without FAILED parent
  const bNode = planner.graph.getNode('b');
  bNode.status = TaskStatus.BLOCKED;
  bNode.reason = 'External block';
  const gateTerminal = canExecuteTool(planner, 'terminal');
  assert.equal(gateTerminal.allowed, false);
  const gateFinal = canExecuteTool(planner, 'final');
  assert.equal(gateFinal.allowed, false); // final now also blocks on BLOCKED
});

test('notifyToolExecution: multi-task matches by tool name', () => {
  const a = new Task({ id: 'read', kind: 'read', goal: 'Read file', dependencies: [], tool: 'READ_FILE' });
  const b = new Task({ id: 'write', kind: 'write', goal: 'Write file', dependencies: ['read'], tool: 'WRITE_FILE' });
  const planner = makePlanner([a, b]);
  // First call with READ_FILE should match task 'read'
  const r1 = notifyToolExecution(planner, 'READ_FILE', { path: 'f.js' }, { success: true });
  assert.equal(r1.handled, true);
  assert.equal(r1.taskId, 'read');
  assert.equal(planner.graph.getNode('read').status, TaskStatus.SUCCESS);
});

test('logPlannerStatus: does not throw with null planner', () => {
  logPlannerStatus(null);
});

test('logPlannerStatus: does not throw with empty planner', () => {
  logPlannerStatus(makePlanner([]));
});

test('logPlannerStatus: does not throw with tasks', () => {
  const planner = makePlanner([makeTask('t1', 'CODING'), makeTask('t2', 'CODING')]);
  logPlannerStatus(planner);
});

test('validatePackageJsonAfterWrite: returns valid:true for non-write tools', async () => {
  const result = await validatePackageJsonAfterWrite(null, 'READ_FILE', {}, {}, {});
  assert.equal(result.valid, true);
});

test('validatePackageJsonAfterWrite: returns valid:true for non-package.json paths', async () => {
  const planner = makePlanner([makeTask('t1', 'CODING')]);
  const result = await validatePackageJsonAfterWrite(planner, 'WRITE_FILE', { path: 'src/index.js' }, { file: 'src/index.js' }, {});
  assert.equal(result.valid, true);
});

test('validatePackageJsonAfterWrite: returns valid:true for null planner', async () => {
  const result = await validatePackageJsonAfterWrite(null, 'WRITE_FILE', { path: 'package.json' }, { file: 'package.json' }, {});
  assert.equal(result.valid, true);
});

test('notifyToolExecution returns correct handled field', () => {
  const planner = makePlanner([makeTask('t1', 'CODING')]);
  const r = notifyToolExecution(planner, 'READ_FILE', {}, { success: true });
  assert.equal(r.handled, true);
});

test('canExecuteTool reports failedTasks details', () => {
  const planner = makePlanner([makeTask('t1', 'CODING')]);
  planner.markFailure('t1', 'disk full');
  const gate = canExecuteTool(planner, 'final');
  assert.equal(gate.allowed, false);
  assert.ok(gate.failedTasks.length > 0);
  assert.ok(gate.failedTasks[0].includes('disk full'));
});

test('notifyToolExecution with VALIDATE_PATCH still notifies planner', () => {
  const planner = makePlanner([makeTask('t1', 'CODING')]);
  const result = notifyToolExecution(planner, 'VALIDATE_PATCH', { file: 'f.js' }, { success: false, error: 'patch failed' });
  assert.equal(result.handled, true);
  assert.equal(result.status, 'FAILED');
});

test('tryRecovery blocks unexpected recovery target drift and preserves the active file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workai-recovery-'));
  const logs = [];
  const originalLog = console.log;

  try {
    console.log = (...args) => logs.push(args.map(value => {
      if (typeof value === 'string') return value;
      try { return JSON.stringify(value); } catch { return String(value); }
    }).join(' '));

    const failedTask = new Task({
      id: 'run-1',
      kind: 'CODING',
      tool: 'RUN_TERMINAL',
      toolArgs: { command: 'npm test' },
      goal: 'Run tests'
    });
    const planner = makePlanner([failedTask]);
    planner.markFailure('run-1', 'ReferenceError: prepared is not defined');

    const result = tryRecovery(planner, failedTask, {
      workspaceRoot: root,
      activeFailedPhaseTargetFile: 'src/math.js',
      validationContext: {
        stderr: [
          'ReferenceError: prepared is not defined',
          '    at executePlannerTaskLifecycle (file:///G:/langtuvn/ai_local/src/modules/aiagent/aiagent.controller.js:1:1)'
        ].join('\n')
      }
    });

    assert.equal(result.recoveryStarted, false);
    assert.equal(result.reason, 'RECOVERY_TARGET_MISMATCH_BLOCKED');
    assert.ok(logs.some(line => line.includes('[RECOVERY_TARGET_MISMATCH_BLOCKED]')), 'must log the blocked recovery target mismatch');
    assert.equal(
      logs.some(line => line.includes('aiagent.controller.js') && line.includes('[PLANNER_RECOVERY_START]')),
      false,
      'unexpected controller path must not proceed into recovery planning'
    );
  } finally {
    console.log = originalLog;
    await fs.rm(root, { recursive: true, force: true });
  }
});
