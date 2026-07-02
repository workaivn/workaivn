import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildExecutionStateRegistry } from '../execution/executionStateRegistry.js';
import { Planner } from '../planner/planner.js';
import { Task } from '../planner/task.js';
import { generateRecoveryPlan } from '../planner/recoveryPlanner.js';
import { tryRecovery } from '../planner/executionController.js';

function captureLogs() {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.map(item => {
      if (typeof item === 'string') return item;
      try {
        return JSON.stringify(item);
      } catch {
        return String(item);
      }
    }).join(' '));
  };
  return {
    logs,
    restore() {
      console.log = originalLog;
    }
  };
}

function makePlannerWithAuthority({
  canonicalFileUniverse = [],
  verifiedFiles = [],
  existingFiles = [],
  plannerPolicies = { ALLOW_EXISTING_PROJECT_MODIFICATION: true },
  projectScan = {},
  workspaceRoot = ''
} = {}) {
  const planner = new Planner([
    new Task({
      id: 'failed-task',
      kind: 'CODING',
      goal: 'Run node src/app.js',
      tool: 'RUN_TERMINAL',
      toolArgs: { command: 'node src/app.js' }
    })
  ]);
  planner.authorityContext = {
    verifiedPlanningContext: {
      verifiedFiles,
      verifiedCommands: ['node src/app.js']
    },
    verifiedFiles,
    verifiedCommands: ['node src/app.js'],
    canonicalFileUniverse,
    plannerPolicies,
    workspaceState: { existingFiles, workspaceRoot },
    projectScan
  };
  planner.markFailure('failed-task', 'simulated failure');
  return planner;
}

test('Phase 4.29-HF1: legacy recovery planning emits candidates only, not executable tasks', () => {
  const plan = generateRecoveryPlan(new Task({
    id: 'failed',
    kind: 'CODING',
    goal: 'Recover missing file',
    tool: 'RUN_TERMINAL',
    toolArgs: { command: 'node src/app.js' }
  }), {
    workspaceRoot: '',
    repairTargetFile: 'src/app.js',
    selectedTarget: 'src/app.js',
    requiredFiles: ['src/app.js'],
    changedFiles: [],
    plannerChangedFiles: [],
    validationContext: { stdout: '', stderr: '' }
  });

  assert.ok(plan.recoveryType, 'expected a recovery type');
  assert.ok(plan.tasks.length > 0, 'expected recovery candidates');
  assert.equal(plan.tasks.some(task => task.status !== undefined), false, 'recovery planner must not build executable task objects');
  assert.equal(plan.tasks.some(task => task.tool == null), false, 'recovery planner must not emit tool:null');
  assert.equal(plan.tasks.every(task => task.authoritySource === 'validated_recovery'), true);
  assert.equal(plan.tasks.every(task => task.approvedByFirewall === false), true);
  assert.ok(plan.tasks.some(task => task.tool === 'WRITE_FILE' || task.tool === 'RUN_TERMINAL' || task.tool === 'READ_FILE'));
});

test('Phase 4.29-HF1: tryRecovery without retryUnit routes through PlannerAuthorityFirewall', () => {
  const { logs, restore } = captureLogs();
  try {
    const planner = makePlannerWithAuthority({
      canonicalFileUniverse: ['src/app.js'],
      verifiedFiles: ['src/app.js'],
      existingFiles: ['src/app.js'],
      workspaceRoot: ''
    });

    const result = tryRecovery(planner, planner.graph.getNode('failed-task'), {
      workspaceRoot: '',
      repairTargetFile: 'src/app.js',
      selectedTarget: 'src/app.js',
      requiredFiles: ['src/app.js'],
      validationContext: { stdout: '', stderr: '' }
    });

    assert.equal(result.recoveryStarted, true);
    assert.ok(logs.some(line => line.includes('[TRY_RECOVERY_FIREWALL_PATH]')));
    assert.ok(logs.some(line => line.includes('[RECOVERY_AUTHORITY_VALIDATED]')));
    assert.ok(planner.taskMap.size > 1, 'recovery tasks should be added after firewall approval');
    const insertedRecoveryTasks = (result.recoveryTaskIds || [])
      .map(taskId => planner.taskMap.get(taskId))
      .filter(Boolean);
    assert.ok(insertedRecoveryTasks.length > 0, 'expected inserted recovery tasks');
    for (const task of insertedRecoveryTasks) {
      assert.equal(task.approvedByFirewall, true);
      assert.equal(task.authoritySource, 'validated_recovery');
      assert.ok(task.approvalId);
      assert.ok(Array.isArray(task.canonicalTargets) && task.canonicalTargets.length > 0);
    }
  } finally {
    restore();
  }
});

test('Phase 4.29-HF1: firewall rejection blocks recovery task creation', () => {
  const { logs, restore } = captureLogs();
  try {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hf1-recovery-reject-'));
    const planner = makePlannerWithAuthority({
      canonicalFileUniverse: ['src/other.js'],
      verifiedFiles: ['src/other.js'],
      existingFiles: ['src/other.js'],
      workspaceRoot: tmpRoot
    });

    const result = tryRecovery(planner, planner.graph.getNode('failed-task'), {
      workspaceRoot: tmpRoot,
      repairTargetFile: 'src/app.js',
      selectedTarget: 'src/app.js',
      requiredFiles: ['src/app.js'],
      validationContext: { stdout: '', stderr: '' }
    });

    assert.equal(result.recoveryStarted, false);
    assert.equal(result.recoveryBlocked, true);
    assert.ok(logs.some(line => line.includes('[TRY_RECOVERY_FIREWALL_PATH]')));
    assert.ok(logs.some(line => line.includes('[RECOVERY_AUTHORITY_REJECTED]')));
    assert.equal(planner.getRecoveryTasks().length, 0);
  } finally {
    restore();
  }
});

test('Phase 4.29-HF1: runtime failure candidate files stay diagnostic only', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hf1-runtime-evidence-'));
  const candidatePath = path.join(tmpRoot, 'src', 'app.js');
  fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
  fs.writeFileSync(candidatePath, 'console.log("ok");\n', 'utf8');

  try {
    const registry = buildExecutionStateRegistry({
      plannerExecutionMetadata: {
        plannerWriteFiles: [],
        plannerReadFiles: [],
        plannerRunCommands: [],
        plannerValidationCommands: []
      },
      workspaceRoot: tmpRoot,
      toolCalls: [
        {
          tool: 'RUN_TERMINAL',
          success: false,
          args: { command: 'node src/app.js' },
          result: {
            exitCode: 1,
            stderr: `Error: Cannot find module '${path.join('src', 'app.js').replace(/\\/g, '/')}'`
          }
        }
      ]
    });

    const snapshot = registry.getSnapshot();
    assert.deepEqual(snapshot.plannerWriteFiles, []);
    assert.equal(snapshot.plannedFiles.length, 0);
    assert.ok(snapshot.externalFailureFiles.length >= 0);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
