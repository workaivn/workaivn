import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runAgentLoop } from '../runAgentLoop.js';

const execFileAsync = promisify(execFile);

async function createWorkspace(pkg = { name: 'app', version: '1.0.0', scripts: { test: 'node --test' } }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workai-intent-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'agent@test.local'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'Agent Test'], { cwd: root });
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: root });
  return root;
}

test('A: Read package.json, show package name — read only', async () => {
  const root = await createWorkspace({ name: 'sample-app', version: '1.0.0', scripts: {} });
  const responses = [
    { tool: 'READ_FILE', args: { path: 'package.json' }, done: false },
    { done: true, final: 'Project name: sample-app' }
  ];
  try {
    const result = await runAgentLoop({
      messages: [{ role: 'user', content: 'Read package.json and show package name.' }],
      workspaceRoot: root,
      maxSteps: responses.length,
      generateResponse: async () => JSON.stringify(responses.shift())
    });
    assert.equal(result.success, true);
    assert.equal(result.changedFiles.length, 0);
    assert.ok(result.toolCalls.some(c => c.tool === 'READ_FILE'));
    assert.ok(!result.toolCalls.some(c => c.tool === 'RUN_TERMINAL'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('B: Read package.json, show package name — do not modify, do not run', async () => {
  const root = await createWorkspace({ name: 'sample-app', version: '1.0.0', scripts: {} });
  const responses = [
    { tool: 'READ_FILE', args: { path: 'package.json' }, done: false },
    { done: true, final: 'Project name: sample-app' }
  ];
  try {
    const result = await runAgentLoop({
      messages: [{ role: 'user', content: 'Read package.json and show package name. Do not modify any file. Do not run terminal.' }],
      workspaceRoot: root,
      maxSteps: responses.length,
      generateResponse: async () => JSON.stringify(responses.shift())
    });
    assert.equal(result.success, true);
    assert.equal(result.changedFiles.length, 0);
    assert.ok(result.toolCalls.some(c => c.tool === 'READ_FILE'));
    assert.ok(!result.toolCalls.some(c => c.tool === 'RUN_TERMINAL'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('C: Create file and run', async () => {
  const root = await createWorkspace();
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  const responses = [
    { tool: 'WRITE_FILE', args: { path: 'src/workai-local-test.js', content: 'console.log("LOCAL_AGENT_OK")\n' }, done: false },
    { tool: 'RUN_TERMINAL', args: { command: 'node src/workai-local-test.js' }, done: false },
    { done: true, final: 'OK' }
  ];
  try {
    const result = await runAgentLoop({
      messages: [{ role: 'user', content: 'Create file src/workai-local-test.js with content console.log("LOCAL_AGENT_OK"). Then run: node src/workai-local-test.js' }],
      workspaceRoot: root,
      maxSteps: responses.length,
      generateResponse: async () => JSON.stringify(responses.shift())
    });
    assert.equal(result.success, true);
    assert.ok(result.changedFiles.includes('src/workai-local-test.js'));
    const term = result.toolCalls.find(c => c.tool === 'RUN_TERMINAL');
    assert.ok(term && term.success);
    assert.match(String(term.result?.stdout || ''), /LOCAL_AGENT_OK/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('D: Read scripts only, do not edit or run', async () => {
  const root = await createWorkspace({ name: 'sample', version: '1.0.0', scripts: { build: 'echo build' } });
  const responses = [
    { tool: 'READ_FILE', args: { path: 'package.json' }, done: false },
    { done: true, final: 'Scripts: build' }
  ];
  try {
    const result = await runAgentLoop({
      messages: [{ role: 'user', content: 'Read package.json. Tell me the scripts available. Do not edit package.json. Do not run npm.' }],
      workspaceRoot: root,
      maxSteps: responses.length,
      generateResponse: async () => JSON.stringify(responses.shift())
    });
    assert.equal(result.success, true);
    assert.equal(result.changedFiles.length, 0);
    assert.ok(result.toolCalls.some(c => c.tool === 'READ_FILE'));
    assert.ok(!result.toolCalls.some(c => c.tool === 'RUN_TERMINAL'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('HOTFIX: Create landing page with npm build remains coding WRITE_AND_RUN', async () => {
  const root = await createWorkspace({ name: 'landing-app', version: '1.0.0', scripts: { build: 'echo build' } });
  const prompt = `Create a simple landing page for WorkAIVN with:

* Hero title
* Subtitle
* 3 feature cards
* CTA button

Use the existing React application.
Do not create a new project.

Run:
npm run build`;

  try {
    const result = await runAgentLoop({
      messages: [{ role: 'user', content: prompt }],
      workspaceRoot: root,
      maxSteps: 0,
      generateResponse: async () => JSON.stringify({ done: true, final: 'not used' })
    });

    const classifier = result.events.find(e => e.section === 'CLASSIFIER_RESULT')?.result;
    assert.ok(classifier, 'Classifier debug event should be present');
    assert.equal(classifier.taskMode, 'coding');
    assert.equal(classifier.intentMode, 'WRITE_AND_RUN');
    assert.deepEqual(classifier.forbiddenTools, []);
    assert.deepEqual(classifier.requiredCommands, ['npm run build']);
    assert.equal(result.acceptanceCriteria.taskMode, 'coding');
    assert.equal(result.acceptanceCriteria.intentMode, 'WRITE_AND_RUN');
    assert.equal(result.acceptanceCriteria.doNotModify, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
