import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runAgentLoop } from '../runAgentLoop.js';

const execFileAsync = promisify(execFile);

async function createWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workai-fblock-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  const pkg = { name: 'test', version: '1.0.0', scripts: { 'local:ok': 'node src/workai-local-test.js' } };
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
  await fs.writeFile(path.join(root, 'src', 'workai-local-test.js'), 'console.log("LOCAL_AGENT_OK")\n', 'utf8');
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'agent@test.local'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'Agent Test'], { cwd: root });
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: root });
  return root;
}

test('WRITE_AND_RUN: FINAL blocked when required command pending, accepted after command runs (no file write needed)', async () => {
  const root = await createWorkspace();
  const responses = [
    { tool: 'READ_FILE', args: { path: 'package.json' }, done: false },
    { done: true, final: 'Script already exists. Running...' },
    { tool: 'RUN_TERMINAL', args: { command: 'npm run local:ok' }, done: false },
    { done: true, final: 'done' }
  ];
  try {
    const result = await runAgentLoop({
      messages: [{ role: 'user', content: 'Check the script local:ok exists.\nThen run: npm run local:ok' }],
      workspaceRoot: root,
      maxSteps: responses.length,
      generateResponse: async () => JSON.stringify(responses.shift())
    });
    const terminals = result.toolCalls.filter(c => c.tool === 'RUN_TERMINAL');
    assert.equal(terminals.length >= 1, true, 'Must have executed at least one terminal command');
    assert.equal(terminals[0].args?.command, 'npm run local:ok',
      `Expected "npm run local:ok", got "${terminals[0]?.args?.command}"`);
    assert.equal(terminals[0].success, true, 'Command must succeed');
    assert.match(terminals[0].result?.stdout || '', /LOCAL_AGENT_OK/);
    assert.equal(result.qualityGate?.passed, true, 'Quality Gate must pass');
    // Verify no WRITE_FILE was called (read-only situation)
    const writes = result.toolCalls.filter(c => c.tool === 'WRITE_FILE');
    assert.equal(writes.length, 0, 'No WRITE_FILE should occur');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
