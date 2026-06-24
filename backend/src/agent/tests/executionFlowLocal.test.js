import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runAgentLoop } from '../runAgentLoop.js';

const execFileAsync = promisify(execFile);

async function createWorkspace(pkg = { name: 'pkg-name', version: '1.0.0', scripts: {} }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workai-exec-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'agent@test.local'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'Agent Test'], { cwd: root });
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: root });
  return root;
}

test('A: Read package.json then FINAL — no rewrite, no terminal', async () => {
  const root = await createWorkspace({ name: 'exec-a', version: '1.0.0', scripts: {} });
  const responses = [
    { tool: 'READ_FILE', args: { path: 'package.json' }, done: false },
    { tool: 'FINAL', final: 'Project name is exec-a', done: true }
  ];
  try {
    const result = await runAgentLoop({
      messages: [{ role: 'user', content: 'Read package.json and show package name.' }],
      workspaceRoot: root,
      maxSteps: responses.length,
      generateResponse: async () => JSON.stringify(responses.shift())
    });
    const names = result.toolCalls.map(c => c.tool);
    assert.ok(names.includes('READ_FILE'));
    assert.ok(!names.includes('APPLY_PATCH'));
    assert.ok(!names.includes('RUN_TERMINAL'));
    assert.equal(result.success, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('B: Read package.json then FINAL — do not modify, do not run', async () => {
  const root = await createWorkspace({ name: 'exec-b', version: '1.0.0', scripts: { build: 'echo build' } });
  const responses = [
    { tool: 'READ_FILE', args: { path: 'package.json' }, done: false },
    { tool: 'FINAL', final: 'Scripts: build', done: true }
  ];
  try {
    const result = await runAgentLoop({
      messages: [{ role: 'user', content: 'Read package.json and show package name. Do not modify any file. Do not run terminal.' }],
      workspaceRoot: root,
      maxSteps: responses.length,
      generateResponse: async () => JSON.stringify(responses.shift())
    });
    const names = result.toolCalls.map(c => c.tool);
    assert.ok(names.includes('READ_FILE'));
    assert.ok(!names.includes('APPLY_PATCH'));
    assert.ok(!names.includes('RUN_TERMINAL'));
    assert.equal(result.success, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
