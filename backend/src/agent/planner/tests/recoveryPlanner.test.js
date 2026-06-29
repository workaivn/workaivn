import test from 'node:test';
import assert from 'node:assert/strict';
import { Task } from '../task.js';
import { TaskNode } from '../taskNode.js';
import { Planner } from '../planner.js';
import { TaskStatus } from '../plannerTypes.js';
import { buildPlan } from '../planBuilder.js';
import { generateRecoveryPlan, determineRecoveryType, buildRecoveryAssertionContext, analyzeValidationFailure, assertValidRecoveryTaskPath, extractWorkspaceRelativeStacktracePath, extractFailingTestPath } from '../recoveryPlanner.js';
import {
  notifyToolExecution,
  tryRecovery,
  canExecuteTool,
  isPlannerRecovering,
  hasReadyRecoveryTask,
  getNextRecoveryTask,
  checkRecoveryCompletion,
  hasRecoveryFailed
} from '../executionController.js';

function makeTask(id, kind, deps = [], tool = null, toolArgs = {}) {
  const task = new Task({ id, kind: kind || 'CODING', goal: `Task ${id}`, dependencies: deps, tool, toolArgs });
  // Phase 4.7: Enable FAILURE branch for tasks with tools so Branch Planner selects recovery on failure
  if (tool) {
    task.failureNext = 'recovery:' + id;
  }
  return task;
}

function makeRuntimeStacktrace(rootCausePath, workspaceRoot) {
  return [
    'ReferenceError: FallbackError is not defined',
    `    at isFallbackError (file:///${workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '')}/${rootCausePath}:4:27)`,
    '    at Object.<anonymous> (file:///' + workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '') + '/src/agent/autoFallback.test.js:34:16)'
  ].join('\n');
}

function makeRuntimeRecoveryPlanner(writePath) {
  const writeTask = makeTask('write', 'CODING', [], 'WRITE_FILE', { path: writePath, content: 'patched content' });
  const runTask = makeTask('run', 'CODING', [writeTask.id], 'RUN_TERMINAL', { command: 'npm test -- plannerPhase419' });
  return new Planner([writeTask, runTask]);
}

// ===================== Case A: READ_FILE fail → LIST_FILES → READ success =====================

test('Case A: READ_FILE fail triggers recovery with LIST_FILES and READ_FILE', () => {
  const planner = new Planner([
    makeTask('t1', 'CODING', [], 'READ_FILE', { path: 'missing-file.json' })
  ]);

  // First failure (retryCount = 0 initially, markFailure increments to 1)
  const result = notifyToolExecution(planner, 'READ_FILE', { path: 'missing-file.json' }, { success: false, error: 'File not found' });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.recoveryStarted, true, 'Recovery should start after failure');

  // Check that recovery tasks were added
  const all = planner.graph.allNodes();
  const recoveryTasks = all.filter(t => t.kind === 'RECOVERY');
  assert.equal(recoveryTasks.length, 2, 'Should have 2 recovery tasks');
  assert.equal(recoveryTasks[0].tool, 'LIST_FILES', 'First recovery task should be LIST_FILES');
  assert.equal(recoveryTasks[1].tool, 'READ_FILE', 'Second recovery task should be READ_FILE');

  // Check that the original task is RECOVERING
  const t1 = planner.graph.getNode('t1');
  assert.equal(t1.status, TaskStatus.RECOVERING);

  // Check that first recovery task is READY
  assert.equal(recoveryTasks[0].status, TaskStatus.READY);
  assert.equal(recoveryTasks[1].status, TaskStatus.PENDING);

  // Planner should indicate recovering
  assert.equal(isPlannerRecovering(planner), true);
  assert.equal(hasReadyRecoveryTask(planner), true);

  // Get next recovery task
  const next = getNextRecoveryTask(planner);
  assert.equal(next.id, recoveryTasks[0].id);
  assert.equal(next.tool, 'LIST_FILES');
});

test('Case A: LIST_FILES success then READ_FILE success completes recovery', () => {
  const planner = new Planner([
    makeTask('t1', 'CODING', [], 'READ_FILE', { path: 'missing-file.json' })
  ]);

  // Trigger failure + recovery
  notifyToolExecution(planner, 'READ_FILE', { path: 'missing-file.json' }, { success: false, error: 'File not found' });

  // Check original is RECOVERING
  assert.equal(planner.graph.getNode('t1').status, TaskStatus.RECOVERING);

  // Execute LIST_FILES recovery task (first one is READY)
  const searchTask = getNextRecoveryTask(planner);
  assert.ok(searchTask);
  assert.equal(searchTask.tool, 'LIST_FILES');

  // Notify LIST_FILES success
  const r1 = notifyToolExecution(planner, 'LIST_FILES', { limit: 500 }, { success: true, files: ['missing-file.json'] });
  assert.equal(r1.status, 'SUCCESS');

  // Second recovery task should now be READY
  const readTask = getNextRecoveryTask(planner);
  assert.ok(readTask);
  assert.equal(readTask.tool, 'READ_FILE');

  // Notify READ_FILE success
  const r2 = notifyToolExecution(planner, 'READ_FILE', { path: 'missing-file.json' }, { success: true, content: '{"found": true}' });
  assert.equal(r2.status, 'SUCCESS');

  // Check recovery completion
  const completion = checkRecoveryCompletion(planner);
  assert.equal(completion.recoveryComplete, true);
  assert.equal(completion.recoveredTaskId, 't1');

  // Original task should now be RECOVERED
  assert.equal(planner.graph.getNode('t1').status, TaskStatus.RECOVERED);
  assert.equal(isPlannerRecovering(planner), false);
});

// ===================== Case B: PATCH fail → READ latest → PATCH success =====================

test('Case B: APPLY_PATCH fail triggers recovery with READ_FILE and APPLY_PATCH', () => {
  const planner = new Planner([
    makeTask('t1', 'CODING', [], 'APPLY_PATCH', { file: 'test.js', find: 'old', replace: 'new' })
  ]);

  const result = notifyToolExecution(planner, 'APPLY_PATCH', { file: 'test.js', find: 'old', replace: 'new' }, { success: false, error: 'Patch failed: hunk not found' });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.recoveryStarted, true, 'Recovery should start after patch failure');

  const recoveryTasks = planner.graph.allNodes().filter(t => t.kind === 'RECOVERY');
  assert.equal(recoveryTasks.length, 2);
  assert.equal(recoveryTasks[0].tool, 'READ_FILE', 'First recovery task should be READ_FILE');
  assert.equal(recoveryTasks[1].tool, 'APPLY_PATCH', 'Second recovery task should be APPLY_PATCH');

  assert.equal(planner.graph.getNode('t1').status, TaskStatus.RECOVERING);
});

test('Case B: READ_FILE success then APPLY_PATCH success completes recovery', () => {
  const planner = new Planner([
    makeTask('t1', 'CODING', [], 'APPLY_PATCH', { file: 'test.js', find: 'old', replace: 'new' })
  ]);

  // Trigger failure + recovery
  notifyToolExecution(planner, 'APPLY_PATCH', { file: 'test.js', find: 'old', replace: 'new' }, { success: false, error: 'Patch failed' });

  // Execute READ_FILE recovery task
  const readTask = getNextRecoveryTask(planner);
  assert.ok(readTask);
  assert.equal(readTask.tool, 'READ_FILE');

  notifyToolExecution(planner, 'READ_FILE', { path: 'test.js' }, { success: true, content: 'old content' });

  // Execute APPLY_PATCH recovery task
  const patchTask = getNextRecoveryTask(planner);
  assert.ok(patchTask);
  assert.equal(patchTask.tool, 'APPLY_PATCH');

  notifyToolExecution(planner, 'APPLY_PATCH', { file: 'test.js', find: 'old', replace: 'new' }, { success: true, changed: true });

  // Check recovery completion
  const completion = checkRecoveryCompletion(planner);
  assert.equal(completion.recoveryComplete, true);
  assert.equal(planner.graph.getNode('t1').status, TaskStatus.RECOVERED);
  assert.equal(isPlannerRecovering(planner), false);
});

// ===================== Case C: Recovery fails → STOP =====================

test('Case C: Recovery task failure marks original as RECOVERY_FAILED', () => {
  const planner = new Planner([
    makeTask('t1', 'CODING', [], 'READ_FILE', { path: 'missing-file.json' })
  ]);

  // Trigger failure + recovery
  notifyToolExecution(planner, 'READ_FILE', { path: 'missing-file.json' }, { success: false, error: 'File not found' });

  // Execute first recovery task (LIST_FILES) but it fails
  const searchTask = getNextRecoveryTask(planner);
  assert.ok(searchTask);
  assert.equal(searchTask.tool, 'LIST_FILES');

  const result = notifyToolExecution(planner, 'LIST_FILES', { limit: 500 }, { success: false, error: 'No files found' });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.isRecovery, true);

  // Original task should now be RECOVERY_FAILED
  const t1 = planner.graph.getNode('t1');
  assert.equal(t1.status, TaskStatus.RECOVERY_FAILED, 'Original task should be RECOVERY_FAILED');

  // hasRecoveryFailed should return true
  assert.equal(hasRecoveryFailed(planner), true);

  // canExecuteTool should block everything
  assert.equal(canExecuteTool(planner, 'read').allowed, false, 'read tools should be blocked after RECOVERY_FAILED');
  assert.equal(canExecuteTool(planner, 'final').allowed, false);
  assert.equal(canExecuteTool(planner, 'terminal').allowed, false);
  assert.equal(canExecuteTool(planner, 'write').allowed, false);
  assert.equal(canExecuteTool(planner, 'final').recoveryFailed, true, 'final gate must report recoveryFailed');
  assert.equal(canExecuteTool(planner, undefined).allowed, false, 'even undefined toolType must be blocked');
});

test('Case C: Recovery failure blocks final completion', () => {
  const planner = new Planner([
    makeTask('t1', 'CODING', [], 'APPLY_PATCH', { file: 'test.js' })
  ]);

  // Trigger failure + recovery
  notifyToolExecution(planner, 'APPLY_PATCH', { file: 'test.js' }, { success: false, error: 'Patch failed' });

  // Execute first recovery task but it fails
  const readTask = getNextRecoveryTask(planner);
  assert.ok(readTask);
  notifyToolExecution(planner, 'READ_FILE', { path: 'test.js' }, { success: false, error: 'File not found' });

  // Original should be RECOVERY_FAILED
  assert.equal(planner.graph.getNode('t1').status, TaskStatus.RECOVERY_FAILED);

  // Recovery failure should be terminal — isComplete returns false
  assert.equal(planner.isComplete(), false);
});

// ===================== Edge Cases =====================

test('Recovery only triggers once per failed task', () => {
  const planner = new Planner([
    makeTask('t1', 'CODING', [], 'READ_FILE', { path: 'x.json' })
  ]);

  // First failure triggers recovery
  const r1 = notifyToolExecution(planner, 'READ_FILE', { path: 'x.json' }, { success: false, error: 'Not found' });
  assert.equal(r1.recoveryStarted, true);

  // Second call matches the RECOVERY task (PENDING, READ_FILE), not the original (RECOVERING).
  // This is not a new recovery attempt — it executes the recovery READ_FILE task.
  const r2 = notifyToolExecution(planner, 'READ_FILE', { path: 'x.json' }, { success: false, error: 'Still not found' });
  assert.equal(r2.isRecovery, true, 'Second call matches a recovery task');
  assert.equal(r2.recoveryStarted, undefined, 'Recovery task execution does not set recoveryStarted');

  // The recovery READ_FILE task failed → original becomes RECOVERY_FAILED
  assert.equal(planner.graph.getNode('t1').status, TaskStatus.RECOVERY_FAILED);
});

test('determineRecoveryType returns null for unknown tool', () => {
  const task = makeTask('t1', 'CODING', [], 'LIST_FILES', {});
  const type = determineRecoveryType(task);
  assert.equal(type, null);
});

test('generateRecoveryPlan returns empty tasks for unknown tool', () => {
  const task = makeTask('t1', 'CODING', [], 'LIST_FILES', {});
  const plan = generateRecoveryPlan(task);
  assert.equal(plan.recoveryType, null);
  assert.equal(plan.tasks.length, 0);
});

test('generateRecoveryPlan returns READ_FILE recovery strategy', () => {
  const task = makeTask('t1', 'CODING', [], 'READ_FILE', { path: 'test.json' });
  const plan = generateRecoveryPlan(task);
  assert.equal(plan.recoveryType, 'READ_FILE_RECOVERY');
  assert.equal(plan.tasks.length, 2);
  assert.equal(plan.tasks[0].tool, 'LIST_FILES');
  assert.equal(plan.tasks[1].tool, 'READ_FILE');
});

test('generateRecoveryPlan returns PATCH recovery strategy', () => {
  const task = makeTask('t1', 'CODING', [], 'APPLY_PATCH', { file: 'test.js', find: 'a', replace: 'b' });
  const plan = generateRecoveryPlan(task);
  assert.equal(plan.recoveryType, 'PATCH_RECOVERY');
  assert.equal(plan.tasks.length, 2);
  assert.equal(plan.tasks[0].tool, 'READ_FILE');
  assert.equal(plan.tasks[1].tool, 'APPLY_PATCH');
});

test('generateRecoveryPlan returns TERMINAL recovery strategy that starts by reading the failing test', () => {
  const task = makeTask('t1', 'CODING', [], 'RUN_TERMINAL', { command: 'npm test' });
  const plan = generateRecoveryPlan(task, {
    validationContext: {
      stdout: [
        'FAIL  backend/src/agent/tests/plannerPhase419.test.js',
        '  ● Phase 4.19: requiredCommands extraction',
        '    Expected: false',
        '    Actual: true'
      ].join('\n')
    }
  });
  assert.equal(plan.recoveryType, 'TERMINAL_RECOVERY');
  assert.equal(plan.tasks.length, 1, 'Expected the recovery to start with the failing test read');
  assert.equal(plan.tasks[0].tool, 'READ_FILE');
  assert.match(plan.tasks[0].toolArgs?.path || '', /plannerPhase419\.test\.js$/);
});

test('generateRecoveryPlan returns TERMINAL recovery with READ_FILE when script not found', () => {
  const task = makeTask('t2', 'CODING', [], 'RUN_TERMINAL', { command: 'npm run nonexistent_script_xyz' });
  const plan = generateRecoveryPlan(task);
  // Script doesn't exist — recovery should be skipped
  assert.equal(plan.recoveryType, null);
  assert.equal(plan.tasks.length, 0);
});

test('generateRecoveryPlan returns TERMINAL recovery read/write/terminal chain when target file is known', () => {
  const task = makeTask('t3', 'CODING', ['w1'], 'RUN_TERMINAL', { command: 'npm test' });
  const plan = generateRecoveryPlan(task, { repairTargetFile: 'src/App.js' });
  assert.equal(plan.recoveryType, 'TERMINAL_RECOVERY');
  assert.equal(plan.tasks.length, 3, 'Expected read/write/rerun recovery chain');
  assert.equal(plan.tasks[0].tool, 'READ_FILE');
  assert.equal(plan.tasks[0].toolArgs?.path, 'src/App.js');
  assert.equal(plan.tasks[1].tool, 'WRITE_FILE');
  assert.equal(plan.tasks[1].toolArgs?.path, 'src/App.js');
  assert.equal(plan.tasks[2].tool, 'RUN_TERMINAL');
  assert.equal(plan.tasks[2].toolArgs?.command, 'npm test');
});

test('generateRecoveryPlan for RUN_TERMINAL never starts with RUN_TERMINAL', () => {
  const task = makeTask('t4', 'CODING', ['w1'], 'RUN_TERMINAL', { command: 'npm test' });
  const plan = generateRecoveryPlan(task, { repairTargetFile: 'src/App.js' });
  assert.ok(plan.tasks.length >= 1, 'Expected at least one recovery task');
  assert.notEqual(plan.tasks[0].tool, 'RUN_TERMINAL', 'First recovery task must not be RUN_TERMINAL');
  assert.equal(plan.tasks[0].tool, 'READ_FILE', 'First recovery task must inspect the failing file before repair');
  assert.equal(plan.tasks[1].tool, 'WRITE_FILE');
  assert.equal(plan.tasks[2].tool, 'RUN_TERMINAL');
});

test('Regression: RUN_TERMINAL failure reads the failing test before patching implementation', () => {
  const planner = new Planner([
    makeTask('write', 'CODING', [], 'WRITE_FILE', { path: 'src/phase419-fallback.js', content: 'console.log("OK")' }),
    makeTask('run', 'CODING', [], 'RUN_TERMINAL', { command: 'node src/phase419-fallback.js' })
  ]);

  planner.executionHistory.recordWrite('src/phase419-fallback.js', 'console.log("OK")');

  const result = notifyToolExecution(
    planner,
    'RUN_TERMINAL',
    { command: 'node src/phase419-fallback.js' },
    {
      success: false,
      error: 'Command failed',
      exitCode: 1,
      stdout: [
        'FAIL  backend/src/agent/tests/plannerPhase419.test.js',
        '  ● Phase 4.19: extractCommands captures node -e validation commands',
        '    Expected: []',
        '    Actual: ["npm test"]'
      ].join('\n')
    }
  );

  assert.equal(result.recoveryStarted, true, 'Recovery should start after RUN_TERMINAL failure');
  const recoveryTasks = planner.graph.allNodes().filter(t => t.kind === 'RECOVERY');
  assert.ok(recoveryTasks.length >= 1, 'Expected inspection recovery task');
  assert.equal(recoveryTasks[0].tool, 'READ_FILE', 'First recovery task must inspect the failing test');
  assert.match(recoveryTasks[0].toolArgs?.path || '', /plannerPhase419\.test\.js$/);
});

test('Regression: terminal recovery expands from failing test read to implementation read, patch, and rerun', () => {
  const planner = new Planner([
    makeTask('run', 'CODING', [], 'RUN_TERMINAL', { command: 'npm test -- plannerPhase419' })
  ]);

  const failure = notifyToolExecution(
    planner,
    'RUN_TERMINAL',
    { command: 'npm test -- plannerPhase419' },
    {
      success: false,
      error: 'Command failed',
      exitCode: 1,
      stdout: [
        'FAIL  backend/src/agent/tests/plannerPhase419.test.js',
        '  ● Phase 4.19: extractCommands captures node -e validation commands',
        '    Expected: ["npm test -- plannerPhase419"]',
        '    Actual: []'
      ].join('\n')
    }
  );

  assert.equal(failure.recoveryStarted, true, 'Recovery should start');

  const failingTestTask = getNextRecoveryTask(planner);
  assert.ok(failingTestTask, 'Expected failing test read task');
  assert.equal(failingTestTask.tool, 'READ_FILE');
  assert.match(failingTestTask.toolArgs?.path || '', /plannerPhase419\.test\.js$/);

  notifyToolExecution(
    planner,
    'READ_FILE',
    { path: failingTestTask.toolArgs?.path },
    {
      success: true,
      file: failingTestTask.toolArgs?.path,
      content: [
        "import assert from 'node:assert/strict';",
        "import { analyzeClarification } from '../planner/clarificationEngine.js';",
        '',
        "test('Phase 4.19: analyzeClarification — specific file/read task', () => {",
        '  assert.equal(analyzeClarification("Read package.json").needsClarification, false);',
        '});'
      ].join('\n')
    }
  );

  const implReadTask = getNextRecoveryTask(planner);
  assert.ok(implReadTask, 'Expected implementation read task');
  assert.equal(implReadTask.tool, 'READ_FILE');
  assert.equal(implReadTask.toolArgs?.path, 'backend/src/agent/planner/clarificationEngine.js');

  notifyToolExecution(
    planner,
    'READ_FILE',
    { path: implReadTask.toolArgs?.path },
    {
      success: true,
      file: implReadTask.toolArgs?.path,
      content: [
        'export function analyzeClarification(prompt) {',
        '  return { needsClarification: false };',
        '}'
      ].join('\n')
    }
  );

  const writeTask = getNextRecoveryTask(planner);
  assert.ok(writeTask, 'Expected repair write task');
  assert.equal(writeTask.tool, 'WRITE_FILE');
  assert.equal(writeTask.toolArgs?.path, 'backend/src/agent/planner/clarificationEngine.js');

  notifyToolExecution(
    planner,
    'WRITE_FILE',
    { path: writeTask.toolArgs?.path, content: 'export function analyzeClarification(prompt) { return { needsClarification: false }; }' },
    { success: true, file: writeTask.toolArgs?.path, changed: true }
  );

  const rerunTask = getNextRecoveryTask(planner);
  assert.ok(rerunTask, 'Expected rerun terminal task');
  assert.equal(rerunTask.tool, 'RUN_TERMINAL');
  assert.equal(rerunTask.toolArgs?.command, 'npm test -- plannerPhase419');

  notifyToolExecution(
    planner,
    'RUN_TERMINAL',
    { command: rerunTask.toolArgs?.command },
    { success: true, exitCode: 0, stdout: 'plannerPhase419 ok\n' }
  );

  const completion = checkRecoveryCompletion(planner);
  assert.equal(completion.recoveryComplete, true, 'Recovery chain should complete after patch and rerun');
});

test('Regression: module export failure reads implementation first and skips failing test read', () => {
  const planner = new Planner([
    makeTask('run', 'CODING', [], 'RUN_TERMINAL', { command: 'npm test -- plannerPhase419' })
  ]);

  const failure = notifyToolExecution(
    planner,
    'RUN_TERMINAL',
    { command: 'npm test -- plannerPhase419' },
    {
      success: false,
      error: 'Command failed',
      exitCode: 1,
      stderr: [
        'SyntaxError: The requested module \'../../agent/planner/clarificationEngine.js\' does not provide an export named \'analyzeClarification\'',
        '    at ModuleJob._instantiate (node:internal/modules/esm/module_job:123:21)'
      ].join('\n')
    }
  );

  assert.equal(failure.recoveryStarted, true, 'Recovery should start after module load failure');

  const firstRecoveryTask = getNextRecoveryTask(planner);
  assert.ok(firstRecoveryTask, 'Expected implementation read recovery task');
  assert.equal(firstRecoveryTask.tool, 'READ_FILE');
  assert.match(firstRecoveryTask.toolArgs?.path || '', /src\/agent\/planner\/clarificationEngine\.js$/);
  assert.equal(String(firstRecoveryTask.toolArgs?.recoveryStage || ''), 'module_error');

  notifyToolExecution(
    planner,
    'READ_FILE',
    { path: firstRecoveryTask.toolArgs?.path },
    {
      success: true,
      file: firstRecoveryTask.toolArgs?.path,
      content: [
        'module.exports = {',
        '  analyzeClarification(prompt) {',
        '    return { needsClarification: false };',
        '  }',
        '};'
      ].join('\n')
    }
  );

  const writeTask = getNextRecoveryTask(planner);
  assert.ok(writeTask, 'Expected repair write task after implementation read');
  assert.equal(writeTask.tool, 'WRITE_FILE');
  assert.match(writeTask.toolArgs?.path || '', /clarificationEngine\.js$/);

  notifyToolExecution(
    planner,
    'WRITE_FILE',
    { path: writeTask.toolArgs?.path, content: 'export function analyzeClarification(prompt) { return { needsClarification: false }; }' },
    { success: true, file: writeTask.toolArgs?.path, changed: true }
  );

  const rerunTask = getNextRecoveryTask(planner);
  assert.ok(rerunTask, 'Expected rerun terminal task');
  assert.equal(rerunTask.tool, 'RUN_TERMINAL');
  assert.equal(rerunTask.toolArgs?.command, 'npm test -- plannerPhase419');
});

test('Regression: analyzeValidationFailure prefers root-cause source for runtime ReferenceError', () => {
  const analysis = analyzeValidationFailure({
    stderr: [
      'ReferenceError: FallbackError is not defined',
      '    at isFallbackError (src/modules/aiagent/aiagent.controller.js:4:27)',
      '    at Object.<anonymous> (src/agent/autoFallback.test.js:34:16)'
    ].join('\n')
  }, 'G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f');

  assert.equal(analysis.failureType, 'ReferenceError');
  assert.equal(analysis.rootCauseFile, 'src/modules/aiagent/aiagent.controller.js');
  assert.equal(analysis.failingTestFile, 'src/agent/autoFallback.test.js');
  assert.equal(analysis.repairStrategy, 'root_cause_source_first');
});

test('Regression: stdout assertion text does not override stderr source error recovery', () => {
  const analysis = analyzeValidationFailure({
    stdout: [
      'FAIL  backend/src/agent/tests/plannerPhase419.test.js',
      '  Expected: false',
      '  Actual: true'
    ].join('\n'),
    stderr: [
      'ReferenceError: FallbackError is not defined',
      '    at isFallbackError (src/modules/aiagent/aiagent.controller.js:4:27)',
      '    at Object.<anonymous> (src/agent/autoFallback.test.js:34:16)'
    ].join('\n')
  }, 'G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f');

  assert.equal(analysis.failureType, 'ReferenceError', 'stderr source error must win over stdout assertion noise');
  assert.equal(analysis.rootCauseFile, 'src/modules/aiagent/aiagent.controller.js');
  assert.equal(analysis.failingTestFile, 'src/agent/autoFallback.test.js');
});

test('Regression: file URL stacktrace in stdout resolves to workspace-relative root cause source', () => {
  const analysis = analyzeValidationFailure({
    stdout: [
      'ReferenceError: FallbackError is not defined',
      '    at isFallbackError (file:///G:/langtuvn/ai_local/src/modules/aiagent/aiagent.controller.js:4:27)',
      '    at TestContext.<anonymous> (file:///G:/langtuvn/ai_local/src/agent/autoFallback.test.js:34:16)'
    ].join('\n')
  }, 'G:/langtuvn/ai_local');

  assert.equal(analysis.failureType, 'ReferenceError');
  assert.equal(analysis.rootCauseFile, 'src/modules/aiagent/aiagent.controller.js');
  assert.equal(analysis.failingTestFile, 'src/agent/autoFallback.test.js');
  assert.equal(analysis.repairStrategy, 'root_cause_source_first');
});

test('Regression: ReferenceError stacktrace repairs the source file before reading any failing test', () => {
  const planner = new Planner([
    makeTask('run', 'CODING', [], 'RUN_TERMINAL', { command: 'npm test -- plannerPhase419' })
  ]);

  const failure = notifyToolExecution(
    planner,
    'RUN_TERMINAL',
    { command: 'npm test -- plannerPhase419' },
    {
      success: false,
      error: 'Command failed',
      exitCode: 1,
      stderr: [
        'ReferenceError: fallbackError is not defined',
        '    at buildFallback (src/modules/aiagent/aiagent.controller.js:42:11)',
        '    at Object.<anonymous> (src/agent/tests/autoFallback.test.js:18:3)'
      ].join('\n')
    }
  );

  assert.equal(failure.recoveryStarted, true, 'Recovery should start after ReferenceError failure');

  const firstRecoveryTask = getNextRecoveryTask(planner);
  assert.ok(firstRecoveryTask, 'Expected source-file recovery read task');
  assert.equal(firstRecoveryTask.tool, 'READ_FILE');
  assert.match(firstRecoveryTask.toolArgs?.path || '', /src\/modules\/aiagent\/aiagent\.controller\.js$/);
  assert.equal(/autoFallback\.test\.js$/.test(firstRecoveryTask.toolArgs?.path || ''), false);
  assert.equal(String(firstRecoveryTask.toolArgs?.recoveryStage || ''), 'root_cause');
});

test('Regression: runtime ReferenceError never falls back to an unrelated src/test.js path', () => {
  const task = makeTask('t-ref', 'CODING', [], 'RUN_TERMINAL', { command: 'npm test -- plannerPhase419' });
  const plan = generateRecoveryPlan(task, {
    workspaceRoot: 'G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f',
    validationContext: {
      stdout: [
        'FAIL  backend/src/agent/tests/autoFallback.test.js',
        '  ● recovery should not jump to the controller',
        '    Expected: true',
        '    Actual: false'
      ].join('\n'),
      stderr: [
        'ReferenceError: FallbackError is not defined',
        '    at isFallbackError (src/modules/aiagent/aiagent.controller.js:4:27)',
        '    at Object.<anonymous> (src/agent/autoFallback.test.js:34:16)'
      ].join('\n')
    }
  });

  assert.equal(plan.recoveryType, 'TERMINAL_RECOVERY');
  assert.ok(plan.tasks.length >= 1, 'Expected terminal recovery task');
  assert.equal(plan.tasks[0].tool, 'READ_FILE');
  assert.match(plan.tasks[0].toolArgs?.path || '', /src\/modules\/aiagent\/aiagent\.controller\.js$/);
  assert.equal(/src\/test\.js$/.test(plan.tasks[0].toolArgs?.path || ''), false);
});

test('Regression: stacktrace candidate ranking prefers first application frame over src/test.js', () => {
  const analysis = analyzeValidationFailure({
    stdout: [
      'ReferenceError: FallbackError is not defined',
      '    at isFallbackError (file:///G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f/src/modules/aiagent/aiagent.controller.js:4:27)',
      '    at TestContext.<anonymous> (file:///G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f/src/test.js:12:5)',
      '    at Object.<anonymous> (file:///G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f/src/agent/autoFallback.test.js:34:16)'
    ].join('\n')
  }, 'G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f');

  assert.equal(analysis.failureType, 'ReferenceError');
  assert.equal(analysis.rootCauseFile, 'src/modules/aiagent/aiagent.controller.js');
  assert.notEqual(analysis.rootCauseFile, 'src/test.js');
  assert.ok(analysis.referencedImplementationFiles.includes('src/modules/aiagent/aiagent.controller.js'));
});

test('Regression: runtime root cause comes only from current terminal stacktrace, not polluted context', () => {
  const task = makeTask('t-runtime', 'CODING', [], 'RUN_TERMINAL', { command: 'npm test -- plannerPhase419' });
  const plan = generateRecoveryPlan(task, {
    workspaceRoot: 'G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f',
    validationContext: {
      stdout: [
        'ReferenceError: FallbackError is not defined',
        '    at isFallbackError (file:///G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f/src/modules/aiagent/aiagent.controller.js:4:27)',
        '    at TestContext.<anonymous> (file:///G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f/src/agent/autoFallback.test.js:34:16)'
      ].join('\n')
    },
    changedFiles: ['src/workai-local-test.js'],
    implementationModule: 'src/agent/planner/clarificationEngine.js',
    previousReadFile: 'src/test.js',
    plannerChangedFiles: ['src/workai-local-test.js'],
    latestSuccessfulWritePath: 'src/workai-local-test.js',
    requiredFiles: ['src/workai-local-test.js']
  });

  assert.equal(plan.recoveryType, 'TERMINAL_RECOVERY');
  assert.ok(plan.tasks.length > 0);
  assert.equal(plan.tasks[0].tool, 'READ_FILE');
  assert.equal(plan.tasks[0].toolArgs?.path, 'src/modules/aiagent/aiagent.controller.js');
  assert.notEqual(plan.tasks[0].toolArgs?.path, 'src/workai-local-test.js');
  assert.notEqual(plan.tasks[0].toolArgs?.path, 'src/test.js');
  assert.notEqual(plan.tasks[0].toolArgs?.path, 'src/agent/planner/clarificationEngine.js');
  assert.notEqual(plan.tasks[0].toolArgs?.path, 'src/agent/autoFallback.test.js');
  assert.equal(plan.tasks[1].tool, 'WRITE_FILE');
  assert.equal(plan.tasks[1].toolArgs?.path, 'src/modules/aiagent/aiagent.controller.js');
  assert.equal(plan.tasks[2].tool, 'RUN_TERMINAL');
  assert.equal(plan.tasks[2].toolArgs?.command, 'npm test -- plannerPhase419');
});

test('Regression: runtime ReferenceError allows one recovery even when the stacktrace file differs from the current write target', () => {
  const workspaceRoot = 'G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f';
  const planner = new Planner([
    makeTask('run', 'CODING', [], 'RUN_TERMINAL', { command: 'npm test -- plannerPhase419' })
  ]);
  const failedTask = planner.graph.getNode('run');

  const result = tryRecovery(planner, failedTask, {
    workspaceRoot,
    validationContext: {
      stderr: [
        'ReferenceError: FallbackError is not defined',
        '    at isFallbackError (file:///G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f/src/modules/aiagent/aiagent.controller.js:4:27)',
        '    at Object.<anonymous> (file:///G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f/src/agent/autoFallback.test.js:34:16)'
      ].join('\n')
    },
    activeFailedPhaseTargetFile: 'backend/src/agent/planner/clarificationEngine.js',
    latestSuccessfulWritePath: 'backend/src/agent/planner/clarificationEngine.js',
    plannerChangedFiles: ['backend/src/agent/planner/clarificationEngine.js'],
    requiredFiles: ['backend/src/agent/planner/clarificationEngine.js']
  });

  assert.equal(result.recoveryStarted, true, 'Recovery should allow one runtime retry after a write task');
  const firstRecoveryTask = getNextRecoveryTask(planner);
  assert.ok(firstRecoveryTask, 'Expected recovery task for first runtime retry');
  assert.equal(firstRecoveryTask.tool, 'READ_FILE');
  assert.match(firstRecoveryTask.toolArgs?.path || '', /src\/modules\/aiagent\/aiagent\.controller\.js$/);
  assert.equal(planner.graph.allNodes().filter(t => t.kind === 'RECOVERY').length, 3);
  assert.equal(planner.graph.allNodes().filter(t => t.kind === 'RECOVERY')[1].tool, 'WRITE_FILE');
  assert.equal(planner.graph.allNodes().filter(t => t.kind === 'RECOVERY')[2].tool, 'RUN_TERMINAL');
  assert.equal(planner.graph.allNodes().filter(t => t.kind === 'RECOVERY').length > 0, true);
});

test('Regression: recovery tasks stay on the normal planner queue from read to write to rerun', () => {
  const workspaceRoot = 'G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f';
  const rootCause = 'src/modules/aiagent/aiagent.controller.js';
  const planner = makeRuntimeRecoveryPlanner(rootCause);
  const failedTask = planner.graph.getNode('run');

  const result = tryRecovery(planner, failedTask, {
    workspaceRoot,
    validationContext: {
      stderr: makeRuntimeStacktrace(rootCause, workspaceRoot)
    },
    changedFiles: [rootCause],
    plannerChangedFiles: [rootCause],
    latestSuccessfulWritePath: rootCause,
    activeFailedPhaseTargetFile: rootCause
  });

  assert.equal(result.recoveryStarted, true);

  const readTask = planner.getNextTask();
  assert.ok(readTask, 'Expected recovery read task from planner queue');
  assert.equal(readTask.kind, 'RECOVERY');
  assert.equal(readTask.tool, 'READ_FILE');

  notifyToolExecution(
    planner,
    'READ_FILE',
    { path: readTask.toolArgs?.path },
    {
      success: true,
      file: readTask.toolArgs?.path,
      content: 'export function analyzeClarification(prompt) { return { needsClarification: false }; }'
    }
  );
  assert.equal(planner.graph.getNode(readTask.id).status, TaskStatus.SUCCESS);

  const writeTask = planner.getNextTask();
  assert.ok(writeTask, 'Expected recovery write task from planner queue');
  assert.equal(writeTask.kind, 'RECOVERY');
  assert.equal(writeTask.tool, 'WRITE_FILE');

  notifyToolExecution(
    planner,
    'WRITE_FILE',
    { path: writeTask.toolArgs?.path, content: 'export function analyzeClarification(prompt) { return { needsClarification: false }; }' },
    { success: true, file: writeTask.toolArgs?.path, changed: true }
  );
  assert.equal(planner.graph.getNode(writeTask.id).status, TaskStatus.SUCCESS);

  const rerunTask = planner.getNextTask();
  assert.ok(rerunTask, 'Expected recovery rerun task from planner queue');
  assert.equal(rerunTask.kind, 'RECOVERY');
  assert.equal(rerunTask.tool, 'RUN_TERMINAL');
  assert.equal(rerunTask.toolArgs?.command, 'npm test -- plannerPhase419');

  notifyToolExecution(
    planner,
    'RUN_TERMINAL',
    { command: rerunTask.toolArgs?.command },
    { success: true, exitCode: 0, stdout: 'plannerPhase419 ok\n' }
  );

  assert.equal(planner.graph.getNode(rerunTask.id).status, TaskStatus.SUCCESS);
  assert.equal(checkRecoveryCompletion(planner).recoveryComplete, true);
  assert.equal(planner.graph.getNode(failedTask.id).status, TaskStatus.RECOVERED);
});

test('Regression: runtime stacktrace owned by the current write target still recovers normally', () => {
  const workspaceRoot = 'G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f';
  const rootCause = 'src/modules/aiagent/aiagent.controller.js';
  const planner = makeRuntimeRecoveryPlanner(rootCause);
  const failedTask = planner.graph.getNode('run');

  const result = tryRecovery(planner, failedTask, {
    workspaceRoot,
    validationContext: {
      stderr: makeRuntimeStacktrace(rootCause, workspaceRoot)
    },
    changedFiles: [rootCause],
    plannerChangedFiles: [rootCause],
    latestSuccessfulWritePath: rootCause,
    activeFailedPhaseTargetFile: rootCause
  });

  assert.equal(result.recoveryStarted, true, 'Recovery should still start for owned failure');
  const firstRecoveryTask = getNextRecoveryTask(planner);
  assert.ok(firstRecoveryTask);
  assert.equal(firstRecoveryTask.tool, 'READ_FILE');
  assert.equal(firstRecoveryTask.toolArgs?.path, rootCause);
});

test('Regression: runtime failure repeats after one recovery then becomes PROJECT_PREEXISTING_FAILURE', () => {
  const workspaceRoot = 'G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f';
  const ownedWritePath = 'src/modules/user/user.service.js';
  const planner = makeRuntimeRecoveryPlanner(ownedWritePath);
  const failedTask = planner.graph.getNode('run');

  const firstResult = tryRecovery(planner, failedTask, {
    workspaceRoot,
    validationContext: {
      stderr: makeRuntimeStacktrace('src/modules/order/order.service.js', workspaceRoot)
    },
    changedFiles: [ownedWritePath],
    plannerChangedFiles: [ownedWritePath],
    latestSuccessfulWritePath: ownedWritePath,
    activeFailedPhaseTargetFile: ownedWritePath
  });

  assert.equal(firstResult.recoveryStarted, true);
  assert.equal(getNextRecoveryTask(planner).tool, 'READ_FILE');

  // Simulate the same runtime failure repeating after one recovery attempt.
  const secondResult = tryRecovery(planner, failedTask, {
    workspaceRoot,
    validationContext: {
      stderr: makeRuntimeStacktrace('src/modules/order/order.service.js', workspaceRoot)
    },
    changedFiles: [ownedWritePath],
    plannerChangedFiles: [ownedWritePath],
    latestSuccessfulWritePath: ownedWritePath,
    activeFailedPhaseTargetFile: ownedWritePath
  });

  assert.equal(secondResult.recoveryStarted, false);
  assert.equal(secondResult.recoveryType, 'PROJECT_PREEXISTING_FAILURE');
  assert.equal(secondResult.reason, 'RETRY_BUDGET_EXHAUSTED');
});

test('Regression: runtime stacktrace overrides stale selectedTarget during recovery planning', () => {
  const task = makeTask('t-mismatch', 'CODING', [], 'RUN_TERMINAL', { command: 'npm test -- plannerPhase419' });
  const plan = generateRecoveryPlan(task, {
    workspaceRoot: 'G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f',
    selectedTarget: 'src/agent/planner/clarificationEngine.js',
    validationContext: {
      stderr: [
        'ReferenceError: FallbackError is not defined',
        '    at isFallbackError (file:///G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f/src/modules/aiagent/aiagent.controller.js:4:27)',
        '    at Object.<anonymous> (file:///G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f/src/agent/autoFallback.test.js:34:16)'
      ].join('\n')
    }
  });

  assert.equal(plan.recoveryType, 'TERMINAL_RECOVERY');
  assert.ok(plan.tasks.length > 0);
  assert.equal(plan.tasks[0].tool, 'READ_FILE');
  assert.match(plan.tasks[0].toolArgs?.path || '', /src\/modules\/aiagent\/aiagent\.controller\.js$/);
  assert.notEqual(plan.tasks[0].toolArgs?.path || '', 'src/agent/planner/clarificationEngine.js');
});

test('Regression: malformed recovery paths are rejected before planner tasks are built', () => {
  const workspaceRoot = 'G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f';
  assert.throws(() => assertValidRecoveryTaskPath('src/C:/Users/langtuvn/AppData/Local/Temp/phase417-legacy-guard/src/modules/aiagent/aiagent.controller.js', workspaceRoot, 'malformed_path'), /RECOVERY_INVALID_PATH/);
  assert.throws(() => assertValidRecoveryTaskPath('C:/Users/langtuvn/AppData/Local/Temp/phase417-legacy-guard/src/modules/aiagent/aiagent.controller.js', workspaceRoot, 'malformed_path'), /RECOVERY_INVALID_PATH/);
  assert.doesNotThrow(() => assertValidRecoveryTaskPath('src/modules/aiagent/aiagent.controller.js', workspaceRoot, 'valid_path'));
});

test('Regression: stacktrace filename extraction returns a workspace-relative source path across URI and Windows forms', () => {
  const workspaceRoot = 'G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f';
  const expected = 'src/modules/aiagent/aiagent.controller.js';
  const variants = [
    'file:///G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f/src/modules/aiagent/aiagent.controller.js:4:27',
    'file://G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f/src/modules/aiagent/aiagent.controller.js:4:27',
    'G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f/src/modules/aiagent/aiagent.controller.js:4:27',
    'G:\\langtuvn\\ai_local\\storage\\workspaces\\511a217f-6b8a-472e-83a7-a6ec89aadb1f\\src\\modules\\aiagent\\aiagent.controller.js:4:27',
    'src/modules/aiagent/aiagent.controller.js',
    'langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f/src/modules/aiagent/aiagent.controller.js'
  ];

  for (const variant of variants) {
    assert.equal(
      extractWorkspaceRelativeStacktracePath(variant, workspaceRoot),
      expected,
      `Expected ${variant} to normalize to ${expected}`
    );
  }

  const plan = generateRecoveryPlan(makeTask('t-stack', 'CODING', [], 'RUN_TERMINAL', { command: 'npm test -- plannerPhase419' }), {
    workspaceRoot,
    validationContext: {
      stderr: [
        'ReferenceError: FallbackError is not defined',
        '    at isFallbackError (file:///G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f/src/modules/aiagent/aiagent.controller.js:4:27)',
        '    at Object.<anonymous> (file:///G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f/src/agent/autoFallback.test.js:34:16)'
      ].join('\n')
    }
  });

  assert.ok(plan.tasks.length > 0);
  assert.equal(plan.tasks[0].tool, 'READ_FILE');
  assert.equal(plan.tasks[0].toolArgs?.path, expected);
});

test('Regression: failing test extraction returns a workspace-relative path across URI and Windows forms', () => {
  const workspaceRoot = 'G:/workspace';
  const expected = 'src/agent/tests/plannerPhase419.test.js';
  const variants = [
    'file:///G:/workspace/src/agent/tests/plannerPhase419.test.js',
    'file://G:/workspace/src/agent/tests/plannerPhase419.test.js',
    'G:/workspace/src/agent/tests/plannerPhase419.test.js',
    'G:\\workspace\\src\\agent\\tests\\plannerPhase419.test.js',
    'src/agent/tests/plannerPhase419.test.js'
  ];

  for (const variant of variants) {
    const pathValue = extractWorkspaceRelativeStacktracePath(variant, workspaceRoot);
    assert.equal(pathValue, expected, `Expected ${variant} to normalize to ${expected}`);
  }

  const extracted = extractFailingTestPath({
    stderr: [
      'AssertionError: expected false to equal true',
      '    at Context.<anonymous> (file:///G:/workspace/src/agent/tests/plannerPhase419.test.js:12:5)'
    ].join('\n')
  });

  assert.equal(extracted, expected);
});

test('Regression: runtime recovery keeps the stacktrace root cause even when polluted with malformed selectedTarget paths', () => {
  const task = makeTask('t-malformed', 'CODING', [], 'RUN_TERMINAL', { command: 'npm test -- plannerPhase419' });
  const plan = generateRecoveryPlan(task, {
    workspaceRoot: 'G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f',
    selectedTarget: 'src/C:/Users/langtuvn/AppData/Local/Temp/phase417-legacy-guard/src/agent/planner/clarificationEngine.js',
    repairTargetFile: 'src/C:/Users/langtuvn/AppData/Local/Temp/phase417-legacy-guard/src/agent/planner/clarificationEngine.js',
    validationContext: {
      stderr: [
        'ReferenceError: FallbackError is not defined',
        '    at isFallbackError (file:///G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f/src/modules/aiagent/aiagent.controller.js:4:27)',
        '    at Object.<anonymous> (file:///G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f/src/agent/autoFallback.test.js:34:16)'
      ].join('\n')
    }
  });

  assert.equal(plan.recoveryType, 'TERMINAL_RECOVERY');
  assert.ok(plan.tasks.length > 0);
  assert.equal(plan.tasks[0].tool, 'READ_FILE');
  assert.equal(plan.tasks[0].toolArgs?.path, 'src/modules/aiagent/aiagent.controller.js');
  assert.equal(String(plan.tasks[0].toolArgs?.path || '').includes('AppData'), false);
  assert.equal(String(plan.tasks[0].toolArgs?.path || '').includes('Temp'), false);
  assert.equal(String(plan.tasks[0].toolArgs?.path || '').includes('phase417-legacy-guard'), false);
  assert.equal(/^[A-Za-z]:[\\/]/.test(plan.tasks[0].toolArgs?.path || ''), false);
  assert.equal(String(plan.tasks[0].toolArgs?.path || '').includes('src/C:'), false);
});

test('Regression: file URL stacktrace on Windows resolves the real source file before the failing test', () => {
  const task = makeTask('t-win-ref', 'CODING', [], 'RUN_TERMINAL', { command: 'npm test -- plannerPhase419' });
  const plan = generateRecoveryPlan(task, {
    workspaceRoot: 'G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f',
    validationContext: {
      stdout: [
        'FAIL  backend/src/agent/tests/autoFallback.test.js',
        '  ● recovery should not jump to the controller',
        '    Expected: true',
        '    Actual: false'
      ].join('\n'),
      stderr: [
        'ReferenceError: FallbackError is not defined',
        '    at isFallbackError (file:///G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f/src/modules/aiagent/aiagent.controller.js:4:27)',
        '    at Object.<anonymous> (file:///G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f/src/agent/autoFallback.test.js:34:16)'
      ].join('\n')
    }
  });

  assert.equal(plan.recoveryType, 'TERMINAL_RECOVERY');
  assert.ok(plan.tasks.length >= 1, 'Expected terminal recovery task');
  assert.equal(plan.tasks[0].tool, 'READ_FILE');
  assert.match(plan.tasks[0].toolArgs?.path || '', /src\/modules\/aiagent\/aiagent\.controller\.js$/);
  assert.equal(/src\/test\.js$/.test(plan.tasks[0].toolArgs?.path || ''), false);
  assert.equal(/autoFallback\.test\.js$/.test(plan.tasks[0].toolArgs?.path || ''), false);
});

test('Regression: terminal recovery stores assertion context before implementation read', () => {
  const testContent = [
    "import assert from 'node:assert/strict';",
    "import { analyzeClarification } from '../planner/clarificationEngine.js';",
    '',
    "test('Phase 4.19', () => {",
    '  assert.equal(analyzeClarification("Read package.json").needsClarification, false);',
    '});'
  ].join('\n');

  const context = buildRecoveryAssertionContext({
    testPath: 'backend/src/agent/tests/plannerPhase419.test.js',
    testContent,
    validationContext: {
      assertion: 'Expected: false; Actual: true',
      expectedValue: 'false',
      actualValue: 'true'
    }
  });

  assert.ok(context, 'Expected RecoveryAssertionContext');
  assert.equal(context.testPath, 'backend/src/agent/tests/plannerPhase419.test.js');
  assert.equal(context.expectedExport, 'analyzeClarification');
  assert.equal(context.expectedFunction, 'analyzeClarification');
  assert.deepEqual(context.expectedReturnValues, ['needsClarification']);
  assert.equal(context.expectedValue, 'false');
  assert.equal(context.actualValue, 'true');
  assert.match(context.assertion, /assert\.equal/);
});

test('Regression: terminal recovery aborts when the failing test contains no assertion', () => {
  const planner = new Planner([
    makeTask('run', 'CODING', [], 'RUN_TERMINAL', { command: 'npm test -- plannerPhase419' })
  ]);

  const failure = notifyToolExecution(
    planner,
    'RUN_TERMINAL',
    { command: 'npm test -- plannerPhase419' },
    {
      success: false,
      error: 'Command failed',
      exitCode: 1,
      stdout: [
        'FAIL  backend/src/agent/tests/plannerPhase419.test.js',
        '  ● Phase 4.19: placeholder failure',
        '    Expected: false',
        '    Actual: true'
      ].join('\n')
    }
  );

  assert.equal(failure.recoveryStarted, true, 'Recovery should start after RUN_TERMINAL failure');
  const failingTestTask = getNextRecoveryTask(planner);
  assert.ok(failingTestTask, 'Expected failing test read task');

  const readResult = notifyToolExecution(
    planner,
    'READ_FILE',
    { path: failingTestTask.toolArgs?.path },
    {
      success: true,
      file: failingTestTask.toolArgs?.path,
      content: [
        'const value = 1;',
        'export default value;'
      ].join('\n')
    }
  );

  assert.equal(readResult.status, 'SUCCESS');
  assert.equal(planner.graph.getNode('run').status, TaskStatus.RECOVERY_FAILED);
  assert.equal(hasRecoveryFailed(planner), true);
  assert.equal(hasReadyRecoveryTask(planner), false);
});

test('Regression: terminal recovery prefers the active phase target over unrelated test imports', () => {
  const planner = new Planner([
    makeTask('write', 'CODING', [], 'WRITE_FILE', {
      path: 'backend/src/agent/planner/clarificationEngine.js',
      content: 'export function analyzeClarification(prompt) { return { needsClarification: false }; }'
    }),
    makeTask('run', 'CODING', ['write'], 'RUN_TERMINAL', { command: 'npm test -- plannerPhase419' })
  ]);

  planner.executionHistory.recordWrite(
    'backend/src/agent/planner/clarificationEngine.js',
    'export function analyzeClarification(prompt) { return { needsClarification: false }; }'
  );

  const result = notifyToolExecution(
    planner,
    'RUN_TERMINAL',
    { command: 'npm test -- plannerPhase419' },
    {
      success: false,
      error: 'Command failed',
      exitCode: 1,
      stdout: [
        'FAIL  backend/src/agent/tests/autoFallback.test.js',
        '  ● recovery should not jump to the controller',
        '    Expected: true',
        '    Actual: false'
      ].join('\n')
    }
  );

  assert.equal(result.recoveryStarted, true, 'Recovery should start after validation failure');

  const failingTestTask = getNextRecoveryTask(planner);
  assert.ok(failingTestTask, 'Expected failing test read task');
  assert.equal(failingTestTask.tool, 'READ_FILE');
  assert.match(failingTestTask.toolArgs?.path || '', /autoFallback\.test\.js$/);

  notifyToolExecution(
    planner,
    'READ_FILE',
    { path: failingTestTask.toolArgs?.path },
    {
      success: true,
      file: failingTestTask.toolArgs?.path,
      content: [
        "import { something } from '../modules/aiagent/aiagent.controller.js';",
        '',
        "test('auto fallback', () => {",
        '  assert.equal(something(), true);',
        '});'
      ].join('\n')
    }
  );

  const implReadTask = getNextRecoveryTask(planner);
  assert.ok(implReadTask, 'Expected implementation read task');
  assert.equal(implReadTask.tool, 'READ_FILE');
  assert.equal(
    implReadTask.toolArgs?.path,
    'backend/src/agent/planner/clarificationEngine.js',
    'Recovery should stay on the phase target implementation file'
  );
  assert.notEqual(
    implReadTask.toolArgs?.path,
    'src/modules/aiagent/aiagent.controller.js',
    'Recovery must not jump to the controller for a Phase 4.19 planner repair'
  );
});

test('tryRecovery returns recoveryStarted:false for null planner', () => {
  const result = tryRecovery(null, makeTask('t1', 'CODING'));
  assert.equal(result.recoveryStarted, false);
});

test('tryRecovery returns recoveryStarted:false for null task', () => {
  const planner = new Planner([]);
  const result = tryRecovery(planner, null);
  assert.equal(result.recoveryStarted, false);
});

test('no recovery for already-recovered tasks', () => {
  const planner = new Planner([
    makeTask('t1', 'CODING', [], 'READ_FILE', { path: 'x.json' })
  ]);

  // First failure triggers recovery — succeed
  notifyToolExecution(planner, 'READ_FILE', { path: 'x.json' }, { success: false, error: 'Not found' });
  const searchTask = getNextRecoveryTask(planner);
  notifyToolExecution(planner, 'LIST_FILES', { limit: 500 }, { success: true, files: ['x.json'] });
  const readTask = getNextRecoveryTask(planner);
  notifyToolExecution(planner, 'READ_FILE', { path: 'x.json' }, { success: true, content: 'ok' });
  checkRecoveryCompletion(planner);

  // Try to trigger recovery again on the now-RECOVERED task
  const r = notifyToolExecution(planner, 'READ_FILE', { path: 'x.json' }, { success: false, error: 'Failed again' });
  // Since the task is RECOVERED (not FAILED), findMatchingTask won't find it
  assert.equal(r.handled, false, 'Should not match RECOVERED task for tool notifications');
});

test('Regression: "Read planner-recovery-test-file.json" forces READ_FILE not LIST_FILES', () => {
  const objective = 'Read planner-recovery-test-file.json';
  const criteria = { taskType: 'ANALYSIS', requestedFiles: ['planner-recovery-test-file.json'] };

  // buildPlan must create a READ_FILE task (not a generic model-driven task)
  const plan = buildPlan(objective, criteria);
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].tool, 'READ_FILE', 'Task must have explicit READ_FILE tool');
  assert.equal(plan.tasks[0].toolArgs?.path, 'planner-recovery-test-file.json');

  // Planner dispatches this READ_FILE task directly (model never chooses LIST_FILES)
  const planner = new Planner(plan.tasks);
  const next = planner.getNextTask();
  assert.equal(next.tool, 'READ_FILE');
  assert.equal(next.toolArgs?.path, 'planner-recovery-test-file.json');

  // On READ_FILE failure, recovery is planner-owned — not model-driven
  const result = notifyToolExecution(planner, 'READ_FILE', { path: 'planner-recovery-test-file.json' }, { success: false, error: 'Not found' });
  assert.equal(result.recoveryStarted, true, 'Recovery must start on READ_FILE failure');
  assert.ok(isPlannerRecovering(planner), 'Planner must be in RECOVERING state');

  // Recovery dispatches LIST_FILES (a planner-owned tool, not model-chosen)
  const recoveryTask = getNextRecoveryTask(planner);
  assert.ok(recoveryTask, 'Recovery must have a ready task');
  assert.equal(recoveryTask.kind, 'RECOVERY', 'Recovery task must be RECOVERY kind');
  assert.equal(recoveryTask.tool, 'LIST_FILES', 'Recovery must dispatch LIST_FILES (planner-owned), not unknown tools');
});

// ===================== Regression: RECOVERY_FAILED terminal enforcement (Bug 2) =====================

test('Regression: RECOVERY_FAILED blocks ALL tools including read and undefined toolType', () => {
  const planner = new Planner([
    makeTask('t1', 'CODING', [], 'READ_FILE', { path: 'test.json' })
  ]);

  // Trigger failure + recovery
  notifyToolExecution(planner, 'READ_FILE', { path: 'test.json' }, { success: false, error: 'Not found' });

  // Execute LIST_FILES recovery but it fails → RECOVERY_FAILED
  const searchTask = getNextRecoveryTask(planner);
  notifyToolExecution(planner, 'LIST_FILES', { limit: 500 }, { success: false, error: 'No files found' });

  // RECOVERY_FAILED must be set
  assert.equal(planner.graph.getNode('t1').status, TaskStatus.RECOVERY_FAILED);
  assert.equal(hasRecoveryFailed(planner), true);

  // ALL toolTypes must be blocked — including ones that previously bypassed the guard
  assert.equal(canExecuteTool(planner, 'read').allowed, false);
  assert.equal(canExecuteTool(planner, 'write').allowed, false);
  assert.equal(canExecuteTool(planner, 'terminal').allowed, false);
  assert.equal(canExecuteTool(planner, 'final').allowed, false);
  assert.equal(canExecuteTool(planner, undefined).allowed, false, 'undefined toolType must be blocked (was Bug 2: LIST_FILES bypassed)');
  assert.equal(canExecuteTool(planner, 'list').allowed, false, '"list" toolType must be blocked');
  assert.equal(canExecuteTool(planner, 'search').allowed, false, '"search" toolType must be blocked');

  // Every blockage must report recoveryFailed: true
  assert.equal(canExecuteTool(planner, 'final').recoveryFailed, true);
  assert.equal(canExecuteTool(planner, 'read').recoveryFailed, true);
  assert.equal(canExecuteTool(planner, 'write').recoveryFailed, true);
  assert.equal(canExecuteTool(planner, undefined).recoveryFailed, true);

  // isComplete must be false (terminal condition)
  assert.equal(planner.isComplete(), false);

  // No recovery tasks should be ready
  assert.equal(hasReadyRecoveryTask(planner), false);
});

// ===================== Regression: BUG 1 — Recovery complete only after ENTIRE chain =====================

test('Regression BUG 1: Recovery not complete until entire chain succeeds', () => {
  const planner = new Planner([
    makeTask('t1', 'CODING', [], 'READ_FILE', { path: 'missing.json' })
  ]);

  // Trigger failure + recovery (creates LIST_FILES → READ_FILE chain)
  notifyToolExecution(planner, 'READ_FILE', { path: 'missing.json' }, { success: false, error: 'Not found' });

  // First recovery task (LIST_FILES) succeeds
  const first = getNextRecoveryTask(planner);
  assert.equal(first.tool, 'LIST_FILES');
  notifyToolExecution(planner, 'LIST_FILES', { limit: 500 }, { success: true, files: ['missing.json'] });

  // BUG 1: After first task succeeds, recovery must NOT be complete
  const afterFirst = checkRecoveryCompletion(planner);
  assert.equal(afterFirst.recoveryComplete, false, 'Must NOT complete after only first recovery task succeeds');

  // Original must still be RECOVERING (not prematurely RECOVERED)
  assert.equal(planner.graph.getNode('t1').status, TaskStatus.RECOVERING);

  // Second recovery task (READ_FILE) succeeds
  const second = getNextRecoveryTask(planner);
  assert.equal(second.tool, 'READ_FILE');
  notifyToolExecution(planner, 'READ_FILE', { path: 'missing.json' }, { success: true, content: '{"found": true}' });

  // After ALL recovery tasks succeed, recovery is complete
  const afterAll = checkRecoveryCompletion(planner);
  assert.equal(afterAll.recoveryComplete, true, 'Must complete after ALL recovery tasks succeed');
  assert.equal(afterAll.recoveredTaskId, 't1');
  assert.equal(planner.graph.getNode('t1').status, TaskStatus.RECOVERED);
  assert.equal(isPlannerRecovering(planner), false);
});

// ===================== Regression: BUG 2 — Planner stuck with FAILED/BLOCKED, no model call =====================

test('Regression BUG 2: Planner stuck with FAILED/BLOCKED — no READY, no PENDING', () => {
  const planner = new Planner([
    makeTask('t1', 'CODING', [], 'READ_FILE', { path: 'x.json' })
  ]);

  // Task fails → recovery starts
  notifyToolExecution(planner, 'READ_FILE', { path: 'x.json' }, { success: false, error: 'Not found' });

  // LIST_FILES recovery also fails → RECOVERY_FAILED
  const recoveryTask = getNextRecoveryTask(planner);
  notifyToolExecution(planner, 'LIST_FILES', { limit: 500 }, { success: false, error: 'No files' });

  // Planner is now stuck: RECOVERY_FAILED, no ready tasks
  assert.equal(planner.graph.getNode('t1').status, TaskStatus.RECOVERY_FAILED);
  assert.equal(planner.getNextTask(), null, 'No tasks should be READY');
  assert.equal(isPlannerRecovering(planner), false, 'Planner should not be recovering');
  assert.equal(hasReadyRecoveryTask(planner), false, 'No recovery tasks should be READY');

  // No READY/PENDING tasks remain — planner cannot make progress
  const all = planner.graph.allNodes();
  const readyOrPending = all.filter(t =>
    t.status === TaskStatus.READY ||
    t.status === TaskStatus.PENDING
  );
  assert.equal(readyOrPending.length, 0, 'No READY or PENDING tasks must remain');
  const hasFailed = all.some(t => t.status === TaskStatus.FAILED);
  const hasBlocked = all.some(t => t.status === TaskStatus.BLOCKED);
  assert.ok(hasFailed || hasBlocked, 'Must have FAILED or BLOCKED tasks');
  assert.equal(planner.isComplete(), false, 'Planner must not be complete (RECOVERY_FAILED)');
});

// ===================== Full regression: READ fail → LIST_FILES → READ fail → RECOVERY_FAILED → STOP =====================

test('Regression: READ fail → LIST_FILES → READ fail → RECOVERY_FAILED → STOP (no model call, no LIST_FILES after)', () => {
  const planner = new Planner([
    makeTask('t1', 'CODING', [], 'READ_FILE', { path: 'missing.json' })
  ]);

  // Step 1: READ_FILE fails → recovery starts
  const r1 = notifyToolExecution(planner, 'READ_FILE', { path: 'missing.json' }, { success: false, error: 'Not found' });
  assert.equal(r1.recoveryStarted, true);
  assert.equal(planner.graph.getNode('t1').status, TaskStatus.RECOVERING);

  // Step 2: LIST_FILES succeeds (first recovery task)
  const listTask = getNextRecoveryTask(planner);
  assert.equal(listTask.tool, 'LIST_FILES');
  notifyToolExecution(planner, 'LIST_FILES', { limit: 500 }, { success: true, files: ['missing.json'] });

  // Recovery NOT complete yet — READ_FILE still pending
  assert.equal(checkRecoveryCompletion(planner).recoveryComplete, false);
  assert.equal(planner.graph.getNode('t1').status, TaskStatus.RECOVERING);

  // Step 3: READ_FILE recovery task fails
  const readTask = getNextRecoveryTask(planner);
  assert.equal(readTask.tool, 'READ_FILE');
  const r2 = notifyToolExecution(planner, 'READ_FILE', { path: 'missing.json' }, { success: false, error: 'Still not found' });
  assert.equal(r2.isRecovery, true);

  // Step 4: RECOVERY_FAILED — terminal state
  assert.equal(planner.graph.getNode('t1').status, TaskStatus.RECOVERY_FAILED);
  assert.equal(hasRecoveryFailed(planner), true);

  // Step 5: NO model call — no READY tasks, not recovering
  assert.equal(planner.getNextTask(), null, 'No READY tasks — model must NOT be called');
  assert.equal(isPlannerRecovering(planner), false, 'Not recovering');
  assert.equal(hasReadyRecoveryTask(planner), false, 'No recovery tasks ready');

  // Step 6: canExecuteTool blocks everything — no further tools allowed
  assert.equal(canExecuteTool(planner, 'read').allowed, false);
  assert.equal(canExecuteTool(planner, 'list').allowed, false);
  assert.equal(canExecuteTool(planner, undefined).allowed, false);

  // Step 7: isComplete returns false
  assert.equal(planner.isComplete(), false);
});
