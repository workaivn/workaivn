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
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'workai-local-write-'));
  await execFileAsync('git', ['init'], { cwd: workspaceRoot });
  await execFileAsync('git', ['config', 'user.email', 'agent@test.local'], { cwd: workspaceRoot });
  await execFileAsync('git', ['config', 'user.name', 'Agent Test'], { cwd: workspaceRoot });
  // Ensure src/ exists in repo baseline
  await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
  await fs.writeFile(path.join(workspaceRoot, 'src', '.gitkeep'), '', 'utf8');
  await execFileAsync('git', ['add', '.'], { cwd: workspaceRoot });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: workspaceRoot });
  return workspaceRoot;
}

test('Local mode: WRITE_FILE then RUN_TERMINAL creates file and runs it', async () => {
  const workspaceRoot = await createWorkspace();
  const scriptPath = 'src/workai-local-test.js';
  const content = "console.log(\"LOCAL_AGENT_OK\");\n";
  const responses = [
    { tool: 'WRITE_FILE', args: { path: scriptPath, content }, done: false },
    { tool: 'RUN_TERMINAL', args: { command: `node ${scriptPath}` }, done: false },
    { done: true, final: 'OK' }
  ];

  try {
    const result = await runAgentLoop({
      messages: [{
        role: 'user',
        content: `Create file ${scriptPath} with content console.log(\"LOCAL_AGENT_OK\"); Then run node ${scriptPath}`
      }],
      workspaceRoot,
      maxSteps: responses.length,
      generateResponse: async () => JSON.stringify(responses.shift())
    });

    // Debug: show tool calls
    // eslint-disable-next-line no-console
    console.log('TOOL_CALLS', JSON.stringify(result.toolCalls, null, 2));
    // Tool result for WRITE_FILE exists and succeeded
    const writeCall = result.toolCalls.find(c => c.tool === 'WRITE_FILE');
    // Debug snapshot if failure occurs
    if (!writeCall || writeCall.success !== true) {
      // eslint-disable-next-line no-console
      console.log('TOOL_CALLS_DEBUG', JSON.stringify(result.toolCalls, null, 2));
    }
    assert.ok(writeCall, 'Expected WRITE_FILE tool call');
    assert.equal(writeCall.success, true, 'WRITE_FILE should succeed');
    assert.ok(result.changedFiles.includes(scriptPath), 'filesChanged should include created file');
    // RUN_TERMINAL succeeded and printed ok
    const termCall = result.toolCalls.find(c => c.tool === 'RUN_TERMINAL');
    if (!termCall || termCall.success !== true) {
      // eslint-disable-next-line no-console
      console.log('TOOL_CALLS_DEBUG', JSON.stringify(result.toolCalls, null, 2));
    }
    assert.ok(termCall, 'Expected RUN_TERMINAL tool call');
    assert.equal(termCall.success, true, 'RUN_TERMINAL should succeed');
    const stdout = String(termCall.result?.stdout || '');
    assert.match(stdout, /LOCAL_AGENT_OK/, 'stdout should include LOCAL_AGENT_OK');
    // eslint-disable-next-line no-console
    console.log('RESULT_META', { success: result.success, status: result.status, final: result.final, failures: result.qualityGate?.failures });
    assert.equal(result.success, true);
    assert.ok(String(result.final || '').length > 0);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
