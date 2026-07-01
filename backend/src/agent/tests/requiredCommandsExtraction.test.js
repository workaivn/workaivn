import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runAgentLoop } from '../runAgentLoop.js';
import { buildPlan, extractCommands } from '../planner/planBuilder.js';
import { Planner } from '../planner/planner.js';
import { TaskStatus } from '../planner/plannerTypes.js';

const execFileAsync = promisify(execFile);

async function createWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workai-reqcmd-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  const initialPkg = { name: 'test', version: '1.0.0', scripts: {} };
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(initialPkg, null, 2), 'utf8');
  await fs.writeFile(path.join(root, 'src', 'workai-local-test.js'), 'console.log("LOCAL_AGENT_OK")\n', 'utf8');
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'agent@test.local'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'Agent Test'], { cwd: root });
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: root });
  return root;
}

async function createValidationWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workai-reqcmd-validation-'));
  const pkg = { name: 'validation-test', version: '1.0.0', scripts: { test: 'node -e "console.log(\\"TEST_OK\\")"' } };
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'agent@test.local'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'Agent Test'], { cwd: root });
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: root });
  return root;
}

async function createFailingValidationWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workai-reqcmd-failing-validation-'));
  const pkg = { name: 'validation-test', version: '1.0.0', scripts: { test: 'node -e "process.exit(1)"' } };
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'agent@test.local'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'Agent Test'], { cwd: root });
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: root });
  return root;
}

test('requiredCommands extraction: no "npm script", only "npm run local:ok"', async () => {
  const root = await createWorkspace();
  const pkgWithScript = JSON.stringify(
    { name: 'test', version: '1.0.0', scripts: { 'local:ok': 'node src/workai-local-test.js' } },
    null, 2
  );
  const responses = [
    { tool: 'WRITE_FILE', args: { path: 'package.json', content: pkgWithScript }, done: false },
    { done: true, final: 'done' }
  ];
  try {
    const result = await runAgentLoop({
      messages: [{ role: 'user', content: 'Add npm script local:ok with value:\nnode src/workai-local-test.js\n\nThen run:\nnpm run local:ok' }],
      workspaceRoot: root,
      maxSteps: responses.length,
      generateResponse: async () => JSON.stringify(responses.shift())
    });
    const terminals = result.toolCalls.filter(c => c.tool === 'RUN_TERMINAL');
    for (const t of terminals) {
      assert.notEqual(t.args?.command, 'npm script', 'Must not execute "npm script" as a command');
    }
    for (const t of terminals) {
      assert.equal(t.args?.command, 'npm run local:ok',
        `Expected "npm run local:ok", got "${t.args?.command}"`);
    }
    assert.equal(result.success, true, 'Run should complete successfully');
    assert.equal(result.status, 'completed', 'Run should finish in completed status');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Phase 4.9 multiline run command is extracted, planned, and executed', async () => {
  const root = await createValidationWorkspace();
  const prompt = 'Read package.json.\n\nThen run:\n\nnpm test\n\nDo not modify any files. Planner must estimate cost before executing tasks.';

  try {
    assert.deepEqual(extractCommands(prompt), ['npm test']);

    const { tasks } = buildPlan(prompt, {
      taskType: 'ANALYSIS',
      taskMode: 'read_only',
      requestedFiles: ['package.json'],
      requiredCommands: ['npm test']
    });
    assert.deepEqual(tasks.map(t => t.tool), ['READ_FILE', 'RUN_TERMINAL']);

    const result = await runAgentLoop({
      messages: [{ role: 'user', content: prompt }],
      workspaceRoot: root,
      maxSteps: 2,
      generateResponse: async () => JSON.stringify({ done: true, final: 'unexpected model final' })
    });

    const terminals = result.toolCalls.filter(c => c.tool === 'RUN_TERMINAL');
    assert.equal(terminals.length, 1);
    assert.equal(terminals[0].args?.command, 'npm test');
    assert.equal(terminals[0].success, true);
    assert.equal(result.success, true);
    assert.equal(result.changedFiles.length, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Phase 4.9 inline run command is extracted, planned, and executed', async () => {
  const root = await createValidationWorkspace();
  const prompt = 'Read package.json. Then run: npm test';

  try {
    assert.deepEqual(extractCommands(prompt), ['npm test']);

    const { tasks } = buildPlan(prompt, {
      taskType: 'ANALYSIS',
      taskMode: 'read_only',
      requestedFiles: ['package.json'],
      requiredCommands: ['npm test']
    });
    assert.deepEqual(tasks.map(t => t.tool), ['READ_FILE', 'RUN_TERMINAL']);

    const result = await runAgentLoop({
      messages: [{ role: 'user', content: prompt }],
      workspaceRoot: root,
      maxSteps: 2,
      generateResponse: async () => JSON.stringify({ done: true, final: 'unexpected model final' })
    });

    const terminals = result.toolCalls.filter(c => c.tool === 'RUN_TERMINAL');
    assert.equal(terminals.length, 1);
    assert.equal(terminals[0].args?.command, 'npm test');
    assert.equal(terminals[0].success, true);
    assert.equal(result.success, true);
    assert.equal(result.changedFiles.length, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Phase 4.19 explicit validation command ignores generic example Run npm test text', () => {
  const prompt = [
    'Implement Phase 4.19.',
    'After implementation run:',
    '',
    'npm test -- plannerPhase419',
    '',
    'For example, Run npm test should not be treated as a required command.'
  ].join('\n');

  assert.deepEqual(extractCommands(prompt), ['npm test -- plannerPhase419']);
});

test('Phase 4.19 only explicit structured commands are extracted, no generic npm test from bare Run npm test', () => {
  const prompt = [
    'Run npm test.',
    'After implementation run:',
    '',
    'npm test -- plannerPhase419'
  ].join('\n');

  const commands = extractCommands(prompt);
  assert.deepEqual(commands, ['npm test -- plannerPhase419']);

  const { tasks } = buildPlan(prompt, {
    taskType: 'CODING',
    taskMode: 'write_and_run',
    requiredCommands: commands,
    requestedFiles: []
  });

  assert.deepEqual(
    tasks.filter(task => task.tool === 'RUN_TERMINAL').map(task => task.toolArgs.command),
    ['npm test -- plannerPhase419']
  );
});

test('Phase 4.22 stress prompt ignores numbered prose and extracts only npm test', () => {
  const prompt = [
    'Create src/math.js and src/math.test.js.',
    'Implement add/subtract/multiply/divide.',
    'Do NOT modify package.json unless absolutely necessary.',
    'Run validation.',
    '8. Preserve deterministic planner behavior.'
  ].join('\n');

  const { tasks } = buildPlan(prompt, {
    taskType: 'CODING',
    taskMode: 'write_and_run',
    requestedFiles: ['src/math.js', 'src/math.test.js', 'package.json'],
    requiredCommands: [],
    testCommands: ['npm test'],
    projectScan: { testCommands: ['npm test'], projectType: 'node' }
  });

  assert.deepEqual(
    tasks.filter(task => task.tool === 'RUN_TERMINAL').map(task => task.toolArgs.command),
    ['npm test']
  );
});

test('Phase 4.22 requiredCommands sanitization removes prose from deterministic command lists', () => {
  const { tasks } = buildPlan('Create src/math.js and src/math.test.js.', {
    taskType: 'CODING',
    taskMode: 'write_and_run',
    requestedFiles: ['src/math.js', 'src/math.test.js'],
    requiredCommands: ['npm test', '8. Preserve deterministic planner behavior'],
    projectScan: { testCommands: ['npm test'], projectType: 'node' }
  });

  assert.deepEqual(
    tasks.filter(task => task.tool === 'RUN_TERMINAL').map(task => task.toolArgs.command),
    ['npm test']
  );
});

test('Phase 4.9 failed validation still synthesizes final text and reports failed command', async () => {
  const root = await createFailingValidationWorkspace();
  const prompt = 'Read package.json.\n\nThen run:\n\nnpm test\n\nDo not modify any files. Planner must estimate cost before executing tasks.';

  try {
    const result = await runAgentLoop({
      messages: [{ role: 'user', content: prompt }],
      workspaceRoot: root,
      maxSteps: 5,
      generateResponse: async () => JSON.stringify({ done: true, final: 'unexpected model final' })
    });

    const terminals = result.toolCalls.filter(c => c.tool === 'RUN_TERMINAL' && c.args?.command === 'npm test');
    assert.ok(terminals.length >= 1);
    assert.ok(terminals.some(c => c.success === false));
    assert.equal(result.success, false);
    assert.equal(result.status, 'needs_revision');
    assert.ok(String(result.final || '').trim(), 'finalText must be synthesized before QualityGate');
    assert.ok(result.qualityGate?.failures?.some(message => /Required commands failed: npm test/i.test(message)));
    assert.ok(!result.qualityGate?.failures?.some(message => /Required commands not executed: npm test/i.test(message)));
    assert.ok(!result.qualityGate?.failures?.some(message => /No final text/i.test(message)));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Phase 4.9 planner RUN_TERMINAL dependency uses READ_FILE task id', () => {
  const { tasks } = buildPlan('Read package.json. Then run: npm test', {
    taskType: 'ANALYSIS',
    taskMode: 'read_only',
    requestedFiles: ['package.json'],
    requiredCommands: ['npm test']
  });

  const readTask = tasks.find(t => t.tool === 'READ_FILE');
  const runTask = tasks.find(t => t.tool === 'RUN_TERMINAL');

  assert.ok(readTask);
  assert.ok(runTask);
  assert.deepEqual(runTask.dependencies, [readTask.id]);
  assert.notDeepEqual(runTask.dependencies, ['package.json']);

  const planner = new Planner(tasks);
  assert.equal(planner.graph.getNode(readTask.id).status, TaskStatus.READY);
  assert.equal(planner.graph.getNode(runTask.id).status, TaskStatus.PENDING);

  planner.markSuccess(readTask.id, { success: true });
  assert.equal(planner.graph.getNode(runTask.id).status, TaskStatus.READY);
});
