import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runAgentLoop } from '../runAgentLoop.js';

const execFileAsync = promisify(execFile);

async function createWorkspace(pkg = { name: 'acc-crit', version: '1.0.0', scripts: {} }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workai-crit-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'agent@test.local'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'Agent Test'], { cwd: root });
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: root });
  return root;
}

test('acceptanceCriteria reflects effective read-only mode', async () => {
  const root = await createWorkspace({ name: 'acc-crit-ro', version: '1.0.0', scripts: {} });
  const responses = [
    { tool: 'READ_FILE', args: { path: 'package.json' }, done: false },
    { tool: 'FINAL', final: 'Project name is acc-crit-ro', done: true }
  ];
  try {
    const result = await runAgentLoop({
      messages: [{ role: 'user', content: 'Read package.json and show the package name. Do not modify anything.' }],
      workspaceRoot: root,
      maxSteps: responses.length,
      generateResponse: async () => JSON.stringify(responses.shift())
    });
    // Verify acceptanceCriteria in the result matches effective read-only override
    assert.equal(result.acceptanceCriteria?.taskType, 'ANALYSIS');
    assert.equal(result.acceptanceCriteria?.taskMode, 'read_only');
    assert.equal(result.acceptanceCriteria?.requiresWorkspaceChange, false);
    assert.equal(result.acceptanceCriteria?.requiresValidationCommand, false);
    assert.equal(result.acceptanceCriteria?.requiresFileRead, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
