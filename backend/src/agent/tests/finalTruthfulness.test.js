import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runAgentLoop } from '../runAgentLoop.js';

const execFileAsync = promisify(execFile);

async function createWorkspaceWithScript() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workai-truth-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  const script = path.join(root, 'src', 'workai-local-test.js');
  await fs.writeFile(script, 'console.log("LOCAL_AGENT_OK")\n', 'utf8');
  const pkg = path.join(root, 'package.json');
  await fs.writeFile(pkg, JSON.stringify({
    name: 'test-pkg',
    scripts: { 'local:ok': 'node src/workai-local-test.js' }
  }, null, 2), 'utf8');
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'agent@test.local'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'Agent Test'], { cwd: root });
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: root });
  return root;
}

test('deterministic truthful final for idempotent WRITE_FILE (file already up to date)', async () => {
  const root = await createWorkspaceWithScript();
  const responses = [
    { tool: 'WRITE_FILE', args: { path: 'src/workai-local-test.js', content: 'console.log("LOCAL_AGENT_OK")\n' }, done: false },
    { done: true, final: 'Script was added to workai and the file was created.' },
    { tool: 'RUN_TERMINAL', args: { command: 'node src/workai-local-test.js' }, done: false },
  ];
  try {
    const result = await runAgentLoop({
      messages: [{ role: 'user', content: 'Create file src/workai-local-test.js with content: console.log("LOCAL_AGENT_OK")\nThen run: node src/workai-local-test.js' }],
      workspaceRoot: root,
      maxSteps: responses.length,
      generateResponse: async () => JSON.stringify(responses.shift())
    });

    // Quality gate should pass with truthful deterministic final
    assert.equal(result.qualityGate?.passed, true);

    // Status should be completed
    assert.equal(result.status, 'completed');

    // Final text must be truthful — must say "already existed" not "added" or "created"
    assert.match(result.final, /already had the expected content/);
    assert.doesNotMatch(result.final, /\badded\b/i);
    assert.doesNotMatch(result.final, /\bcreated\b/i);
    assert.doesNotMatch(result.final, /\bmodified\b/i);

    // DETERMINISTIC_FINAL_SUMMARY must be emitted
    const detFinalEvents = result.events.filter(e => e.section === 'DETERMINISTIC_FINAL_SUMMARY');
    assert.equal(detFinalEvents.length >= 1, true, 'Expected DETERMINISTIC_FINAL_SUMMARY event');
    assert.equal(detFinalEvents[0].requestedChangeStatus, 'already_satisfied');

    // REQUESTED_CHANGE_STATUS must be emitted with already_satisfied
    const changeStatusEvents = result.events.filter(e => e.section === 'REQUESTED_CHANGE_STATUS');
    const alreadySatisfiedEvents = changeStatusEvents.filter(e => e.status === 'already_satisfied');
    assert.equal(alreadySatisfiedEvents.length >= 1, true, 'Expected REQUESTED_CHANGE_STATUS already_satisfied');

    // FINAL_TRUTHFULNESS_GUIDANCE must NOT be emitted (deterministic path prevented the lie)
    const truthfulnessEvents = result.events.filter(e => e.section === 'FINAL_TRUTHFULNESS_GUIDANCE');
    assert.equal(truthfulnessEvents.length, 0, 'Expected no FINAL_TRUTHFULNESS_GUIDANCE');

    // At least one idempotent write
    const writes = result.toolCalls.filter(c => c.tool === 'WRITE_FILE');
    const idempotentWrites = writes.filter(w => w.result?.changed === false);
    assert.equal(idempotentWrites.length >= 1, true);

    // RUN_TERMINAL executed successfully
    const terminals = result.toolCalls.filter(c => c.tool === 'RUN_TERMINAL');
    assert.equal(terminals.length >= 1, true);
    assert.equal(terminals[0].success, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('deterministic truthful final for read-confirmed idempotent (script already in package.json)', async () => {
  const root = await createWorkspaceWithScript();
  const responses = [
    { tool: 'READ_FILE', args: { path: 'package.json' }, done: false },
    { done: true, final: 'Added script local:ok and ran it.' },
    { tool: 'RUN_TERMINAL', args: { command: 'npm run local:ok' }, done: false },
  ];
  try {
    const result = await runAgentLoop({
      messages: [{ role: 'user', content: 'Add npm script local:ok with value: node src/workai-local-test.js\nThen run: npm run local:ok' }],
      workspaceRoot: root,
      maxSteps: responses.length,
      generateResponse: async () => JSON.stringify(responses.shift())
    });

    // Quality gate should pass with truthful deterministic final
    assert.equal(result.qualityGate?.passed, true);

    // Status should be completed
    assert.equal(result.status, 'completed');

    // Final text must mention the script already existed
    assert.match(result.final, /already existed/);
    assert.doesNotMatch(result.final, /\badded\b/i);
    assert.doesNotMatch(result.final, /\bcreated\b/i);

    // DETERMINISTIC_FINAL_SUMMARY must be emitted with already_satisfied
    const detFinalEvents = result.events.filter(e => e.section === 'DETERMINISTIC_FINAL_SUMMARY');
    assert.equal(detFinalEvents.length >= 1, true, 'Expected DETERMINISTIC_FINAL_SUMMARY');
    assert.equal(detFinalEvents[0].requestedChangeStatus, 'already_satisfied');

    // REQUESTED_CHANGE_STATUS must be emitted with already_satisfied from read_confirmed
    const changeStatusEvents = result.events.filter(e => e.section === 'REQUESTED_CHANGE_STATUS');
    const readConfirmed = changeStatusEvents.filter(e => e.source === 'read_confirmed');
    assert.equal(readConfirmed.length >= 1, true, 'Expected REQUESTED_CHANGE_STATUS from read_confirmed');

    // No WRITE_FILE or APPLY_PATCH should have been attempted
    const writes = result.toolCalls.filter(c => c.tool === 'WRITE_FILE' || c.tool === 'APPLY_PATCH');
    assert.equal(writes.length, 0, 'Expected no write attempts for already-satisfied script');

    // RUN_TERMINAL executed successfully
    const terminals = result.toolCalls.filter(c => c.tool === 'RUN_TERMINAL');
    assert.equal(terminals.length >= 1, true);
    assert.equal(terminals[0].success, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
