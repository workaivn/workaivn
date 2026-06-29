import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Task } from '../planner/task.js';
import { TaskStatus } from '../planner/plannerTypes.js';
import { Planner } from '../planner/planner.js';
import { buildPlan, extractCommands } from '../planner/planBuilder.js';
import { generateRecoveryPlan, determineRecoveryType, resolveRecoveryTargetPath } from '../planner/recoveryPlanner.js';
import { notifyToolExecution, tryRecovery, isPlannerRecovering, hasReadyRecoveryTask, getNextRecoveryTask, checkRecoveryCompletion, hasRecoveryFailed } from '../planner/executionController.js';

function makeTask(id, kind, deps = [], tool = null, toolArgs = {}) {
  const task = new Task({ id, kind: kind || 'CODING', goal: `Task ${id}`, dependencies: deps, tool, toolArgs });
  if (tool) {
    task.failureNext = 'recovery:' + id;
  }
  return task;
}

function makeReadFileTask(id, path, extraArgs = {}) {
  return makeTask(id, 'CODING', [], 'READ_FILE', { path, ...extraArgs });
}

// ========== Test 1: Tool-name prompt classification ==========

test('HF4b Test 1: Tool-name prompt produces WRITE_AND_RUN plan with correct tools', () => {
  const prompt = [
    'WRITE_FILE src/bug.js',
    'WRITE_FILE src/bug.test.js',
    'RUN_TERMINAL node --test src/bug.test.js'
  ].join('\n');

  // Plan with tool-name files and commands as they would arrive from classifier
  const plan = buildPlan(prompt, {
    taskType: 'CODING',
    requestedFiles: ['src/bug.js', 'src/bug.test.js'],
    requiredCommands: ['node --test src/bug.test.js']
  });

  const tools = plan.tasks.map(t => ({ tool: t.tool, file: t.toolArgs?.path || t.toolArgs?.file || null, command: t.toolArgs?.command || null }));

  // Must NOT be READ_ONLY — must have WRITE_FILE tasks
  assert.ok(plan.tasks.length >= 3, `Expected at least 3 tasks, got ${plan.tasks.length}: ${JSON.stringify(tools)}`);

  const writeTasks = plan.tasks.filter(t => t.tool === 'WRITE_FILE');
  const runTasks = plan.tasks.filter(t => t.tool === 'RUN_TERMINAL');

  assert.equal(writeTasks.length, 2, `Expected 2 WRITE_FILE tasks, got ${writeTasks.length}`);
  assert.equal(runTasks.length, 1, `Expected 1 RUN_TERMINAL task, got ${runTasks.length}`);

  // Check write file paths
  const writePaths = writeTasks.map(t => t.toolArgs?.path || t.toolArgs?.file).filter(Boolean);
  assert.ok(writePaths.some(p => p.endsWith('src/bug.js')), 'WRITE_FILE must include src/bug.js');
  assert.ok(writePaths.some(p => p.endsWith('src/bug.test.js')), 'WRITE_FILE must include src/bug.test.js');

  // Check RUN_TERMINAL command
  const runCommand = runTasks[0].toolArgs?.command || '';
  assert.ok(runCommand.includes('node --test'), `RUN_TERMINAL command must be node --test, got: ${runCommand}`);

  // No READ_ONLY forbidden tools in the plan itself (the plan creation already confirms WRITE intent)
  assert.ok(!plan.tasks.some(t => t.tool === null), 'Must not have tool=null generic tasks');
});

// ========== Test 2: Missing owned recovery file ==========

test('HF4b Test 2: Missing owned recovery file produces WRITE_FILE + RUN_TERMINAL, no READ_FILE, no LIST_FILES', () => {
  // Create a failed READ_FILE task for a missing file that IS owned (in requiredFiles)
  const failedTask = makeReadFileTask('t1', 'src/bug.test.js', {
    validationContext: { stdout: '', stderr: '' },
    failedCommand: 'node --test src/bug.test.js'
  });

  const plan = generateRecoveryPlan(failedTask, {
    workspaceRoot: '',
    requiredFiles: ['src/bug.test.js'],
    changedFiles: [],
    plannerChangedFiles: [],
    validationContext: { stdout: '', stderr: '' },
    repairTargetFile: null
  });

  assert.ok(plan.recoveryType !== null, 'Recovery plan must be generated');
  assert.ok(plan.tasks.length >= 2, `Expected at least 2 recovery tasks, got ${plan.tasks.length}`);

  const tools = plan.tasks.map(t => t.tool);

  // Must NOT have LIST_FILES or READ_FILE
  assert.ok(!tools.includes('LIST_FILES'), 'Must NOT include LIST_FILES for missing owned file');
  assert.ok(!tools.includes('READ_FILE'), 'Must NOT include READ_FILE for missing owned file');

  // Must have WRITE_FILE
  assert.ok(tools.includes('WRITE_FILE'), 'Must include WRITE_FILE for missing owned file');

  // Must have RUN_TERMINAL
  assert.ok(tools.includes('RUN_TERMINAL'), 'Must include RUN_TERMINAL for missing owned file');

  // WRITE_FILE should be for the correct path
  const writeTask = plan.tasks.find(t => t.tool === 'WRITE_FILE');
  const writePath = writeTask?.toolArgs?.path || writeTask?.toolArgs?.file || '';
  assert.ok(writePath.endsWith('src/bug.test.js'), `WRITE_FILE path must be src/bug.test.js, got: ${writePath}`);
});

// ========== Test 3: Missing unowned recovery file ==========

test('HF4b Test 3: Missing unowned recovery file must be blocked, no READ_FILE, no WRITE_FILE', () => {
  // Create a temp workspaceRoot where the file does NOT exist
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf4b-test3-'));
  const missingPath = 'src/random-missing.js';

  try {
    const failedTask = makeReadFileTask('t1', missingPath);

    const plan = generateRecoveryPlan(failedTask, {
      workspaceRoot: tmpDir,
      requiredFiles: [],
      changedFiles: [],
      plannerChangedFiles: [],
      validationContext: {},
      repairTargetFile: null
    });

    // Must return null recovery type (no recovery possible) for missing unowned file
    assert.equal(plan.recoveryType, null, 'Recovery must be blocked for missing unowned file');
    assert.equal(plan.tasks.length, 0, 'Must have zero recovery tasks for missing unowned file');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ========== Test 4: Existing recovery target ==========

test('HF4b Test 4: Existing recovery target produces LIST_FILES + READ_FILE (original behavior)', () => {
  // Create a temporary file on disk so the existence check passes
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf4b-test4-'));
  const existingPath = 'src/existing-file.js';
  const absolutePath = path.join(tmpDir, existingPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, '', 'utf8');

  try {
    const failedTask = makeReadFileTask('t1', existingPath, {
      validationContext: { stdout: '', stderr: '' },
      failedCommand: ''
    });

    const plan = generateRecoveryPlan(failedTask, {
      workspaceRoot: tmpDir,
      requiredFiles: [],
      changedFiles: [],
      plannerChangedFiles: [],
      validationContext: { stdout: '', stderr: '' },
      repairTargetFile: null
    });

    // File exists on disk → should get LIST_FILES + READ_FILE (original behavior)
    assert.ok(plan.recoveryType !== null, 'Recovery plan must be generated for existing target');
    assert.ok(plan.tasks.length >= 2, `Expected at least 2 recovery tasks, got ${plan.tasks.length}`);

    const tools = plan.tasks.map(t => t.tool);
    assert.ok(tools.includes('LIST_FILES'), 'Must include LIST_FILES for existing target (original behavior)');
    assert.ok(tools.includes('READ_FILE'), 'Must include READ_FILE for existing target (original behavior)');
  } finally {
    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ========== Test 5: ENOENT must not repeat READ_FILE ==========

test('HF4b Test 5: READ_FILE ENOENT for owned missing target must produce WRITE_FILE, not LIST_FILES or READ_FILE', () => {
  // Simulate: planner creates WRITE_FILE + RUN_TERMINAL, RUN_TERMINAL fails,
  // recovery tries READ_FILE for the owned missing file → ENOENT
  // Next recovery attempt must produce WRITE_FILE, not LIST_FILES or READ_FILE

  const writePath = 'src/bug.test.js';
  const writeTask = makeTask('write', 'CODING', [], 'WRITE_FILE', { path: writePath, content: 'test content' });
  const runTask = makeTask('run', 'CODING', [writeTask.id], 'RUN_TERMINAL', { command: 'node --test src/bug.test.js' });
  const planner = new Planner([writeTask, runTask]);

  // Execute write + run, run fails
  notifyToolExecution(planner, 'WRITE_FILE', { path: writePath }, { success: true, changed: true, file: writePath });
  notifyToolExecution(planner, 'RUN_TERMINAL', { command: 'node --test src/bug.test.js' }, { success: false, exitCode: 1, error: 'Test failed' });

  // Recovery should start
  const recovering = isPlannerRecovering(planner);
  assert.equal(recovering, true, 'Planner should be recovering');

  // Get next recovery task — should be READ_FILE (for the existing bug.js root cause)
  // But if the recovery target is the test file itself (missing), it should be WRITE_FILE
  // This tests that a READ_FILE recovery for a missing owned file generates WRITE+RUN

  // Create a direct test of generateRecoveryPlan with owned missing target
  const failedReadTask = makeReadFileTask('read-fail', 'src/bug.test.js', {
    validationContext: { stdout: '', stderr: '', failedCommand: 'node --test src/bug.test.js' },
    failedCommand: 'node --test src/bug.test.js'
  });

  const recoveryPlan = generateRecoveryPlan(failedReadTask, {
    workspaceRoot: '',
    requiredFiles: ['src/bug.test.js'],
    changedFiles: [],
    plannerChangedFiles: [writePath, 'src/bug.js'],
    validationContext: { stdout: '', stderr: '' },
    repairTargetFile: null
  });

  assert.ok(recoveryPlan.recoveryType !== null, 'Recovery plan must be generated');
  const tools = recoveryPlan.tasks.map(t => t.tool);
  assert.ok(!tools.includes('LIST_FILES'), 'Must NOT include LIST_FILES for owned missing target');
  assert.ok(!tools.includes('READ_FILE'), 'Must NOT include READ_FILE for owned missing target');
  assert.ok(tools.includes('WRITE_FILE'), 'Must include WRITE_FILE for owned missing target');
  assert.ok(tools.includes('RUN_TERMINAL'), 'Must include RUN_TERMINAL for owned missing target');
});
