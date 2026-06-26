import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runAgentLoop } from '../runAgentLoop.js';

const execFileAsync = promisify(execFile);

async function createWorkspaceWithFile() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workai-idem-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  const file = path.join(root, 'src', 'workai-local-test.js');
  await fs.writeFile(file, 'console.log("LOCAL_AGENT_OK")\n', 'utf8');
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'agent@test.local'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'Agent Test'], { cwd: root });
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: root });
  return root;
}

test('WRITE_AND_RUN idempotent write should force RUN_TERMINAL, not loop WRITE_FILE', async () => {
  const root = await createWorkspaceWithFile();
  const responses = [
    { tool: 'WRITE_FILE', args: { path: 'src/workai-local-test.js', content: 'console.log("LOCAL_AGENT_OK")\n' }, done: false },
    { tool: 'RUN_TERMINAL', args: { command: 'node src/workai-local-test.js' }, done: false },
    { done: true, final: 'done' }
  ];
  try {
    const result = await runAgentLoop({
      messages: [{ role: 'user', content: 'Create file src/workai-local-test.js with content: console.log("LOCAL_AGENT_OK")\nThen run: node src/workai-local-test.js' }],
      workspaceRoot: root,
      maxSteps: responses.length,
      generateResponse: async () => JSON.stringify(responses.shift())
    });
    const writes = result.toolCalls.filter(c => c.tool === 'WRITE_FILE');
    const terminals = result.toolCalls.filter(c => c.tool === 'RUN_TERMINAL');
    assert.equal(writes.length >= 1, true);
    assert.equal(terminals.length >= 1, true);
    assert.equal(terminals[0].success, true);
    assert.match(terminals[0].result?.stdout || '', /LOCAL_AGENT_OK/);
    assert.equal(result.qualityGate?.passed, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
