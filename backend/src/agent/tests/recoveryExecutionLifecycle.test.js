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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workai-recovery-exec-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'recovery-exec',
    version: '1.0.0',
    scripts: {}
  }, null, 2), 'utf8');
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'agent@test.local'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'Agent Test'], { cwd: root });
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: root });
  return root;
}

function captureLogs() {
  const logs = [];
  const original = console.log;
  console.log = (...args) => {
    logs.push(args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' '));
    original.apply(console, args);
  };
  return {
    logs,
    restore() {
      console.log = original;
    }
  };
}

test('Recovery tasks emit the normal executor lifecycle and do not bypass the planner executor', async () => {
  const workspaceRoot = await createWorkspace();
  const scriptPath = 'src/recovery-exec.js';
  const responses = [];
  let callCount = 0;

  const logger = captureLogs();
  try {
    const result = await runAgentLoop({
      messages: [{
        role: 'user',
        content: `Create file ${scriptPath} and run node ${scriptPath}.
Then run:
node ${scriptPath}`
      }],
      workspaceRoot,
      maxSteps: 20,
      generateResponse: async ({ messages }) => {
        callCount += 1;
        const prompt = messages.map(message => String(message.content || '')).join('\n');
        responses.push(prompt);

        if (/Recovery requires WRITE_FILE/i.test(prompt) || /The planner has already selected WRITE_FILE/i.test(prompt)) {
          return JSON.stringify({
            content: 'console.log("RECOVERY_OK");\n'
          });
        }

        if (callCount === 1) {
          return JSON.stringify({
            content: 'throw new Error("boom");\n'
          });
        }

        return JSON.stringify({ done: true, final: 'completed' });
      }
    });

    const toolNames = result.toolCalls.map(call => call.tool);
    assert.ok(toolNames.includes('WRITE_FILE'));
    assert.ok(toolNames.includes('RUN_TERMINAL'));
    assert.ok(toolNames.includes('READ_FILE'), 'Recovery should read before repairing');
    assert.ok(result.changedFiles.includes(scriptPath));

    const recoveryDispatchIndex = logger.logs.findIndex(line => line.includes('[PLANNER_RECOVERY_DISPATCH]'));
    const executorEntryIndex = logger.logs.findIndex((line, index) => index > recoveryDispatchIndex && line.includes('[EXECUTOR_ENTRY]'));
    const plannerTaskStartedIndex = logger.logs.findIndex((line, index) => index > recoveryDispatchIndex && line.includes('[PLANNER_TASK_STARTED]'));
    const plannerSuccessIndex = logger.logs.findIndex((line, index) => index > recoveryDispatchIndex && line.includes('[PLANNER_SUCCESS]'));
    const executorExitIndex = logger.logs.findIndex((line, index) => index > recoveryDispatchIndex && line.includes('[EXECUTOR_EXIT]'));

    assert.ok(recoveryDispatchIndex >= 0, 'Expected recovery dispatch log');
    assert.ok(executorEntryIndex > recoveryDispatchIndex, 'Recovery must enter the normal executor');
    assert.ok(plannerTaskStartedIndex > recoveryDispatchIndex, 'Recovery must emit planner task start');
    assert.ok(plannerSuccessIndex > recoveryDispatchIndex, 'Recovery must emit planner success');
    assert.ok(executorExitIndex > recoveryDispatchIndex, 'Recovery must emit executor exit');
    assert.equal(result.success, true);
  } finally {
    logger.restore();
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
