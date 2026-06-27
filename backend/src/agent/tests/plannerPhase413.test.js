import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runAgentLoop, isDeterministicPlannerTask } from '../runAgentLoop.js';

const execFileAsync = promisify(execFile);

async function createWorkspace() {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'workai-p413-'));
  await execFileAsync('git', ['init'], { cwd: workspaceRoot });
  await execFileAsync('git', ['config', 'user.email', 'agent@test.local'], { cwd: workspaceRoot });
  await execFileAsync('git', ['config', 'user.name', 'Agent Test'], { cwd: workspaceRoot });
  await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
  // Create package.json so READ_FILE has a target
  await fs.writeFile(path.join(workspaceRoot, 'package.json'), JSON.stringify({ name: 'p413', version: '1.0.0' }, null, 2), 'utf8');
  await fs.writeFile(path.join(workspaceRoot, 'src', '.gitkeep'), '', 'utf8');
  await execFileAsync('git', ['add', '.'], { cwd: workspaceRoot });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: workspaceRoot });
  return workspaceRoot;
}

// Test 1: isDeterministicPlannerTask helper
test('Phase 4.13 — isDeterministicPlannerTask correctly classifies tasks', async () => {
  // Valid deterministic tasks
  assert.equal(isDeterministicPlannerTask({ tool: 'READ_FILE', toolArgs: { path: 'test.txt' } }), true);
  assert.equal(isDeterministicPlannerTask({ tool: 'WRITE_FILE', toolArgs: { path: 'test.txt', content: 'hello' } }), true);
  assert.equal(isDeterministicPlannerTask({ tool: 'RUN_TERMINAL', toolArgs: { command: 'node test.js' } }), true);
  assert.equal(isDeterministicPlannerTask({ tool: 'APPLY_PATCH', toolArgs: { patch: 'some patch' } }), true);
  assert.equal(isDeterministicPlannerTask({ tool: 'APPLY_PATCH', toolArgs: { file: 'test.txt' } }), true);

  // Invalid/missing args — should return false
  assert.equal(isDeterministicPlannerTask(null), false);
  assert.equal(isDeterministicPlannerTask({}), false);
  assert.equal(isDeterministicPlannerTask({ tool: 'WRITE_FILE', toolArgs: {} }), false);
  assert.equal(isDeterministicPlannerTask({ tool: 'WRITE_FILE', toolArgs: { path: 'test.txt' } }), false);
  assert.equal(isDeterministicPlannerTask({ tool: 'READ_FILE', toolArgs: {} }), false);
  assert.equal(isDeterministicPlannerTask({ tool: 'RUN_TERMINAL', toolArgs: {} }), false);
  assert.equal(isDeterministicPlannerTask({ tool: 'APPLY_PATCH', toolArgs: {} }), false);
  assert.equal(isDeterministicPlannerTask({ tool: 'UNKNOWN_TOOL', toolArgs: { path: 'test.txt' } }), false);
});

// Test 2: Happy deterministic path — READ_FILE, WRITE_FILE, RUN_TERMINAL
test('Phase 4.13 — happy deterministic path: READ_FILE → WRITE_FILE → RUN_TERMINAL', async () => {
  const workspaceRoot = await createWorkspace();
  const scriptPath = 'src/test413';
  // Model responses only needed as fallback; planner should dispatch all tasks
  const responses = [
    { done: true, final: 'fallback' }
  ];
  try {
    const result = await runAgentLoop({
      messages: [{
        role: 'user',
        content: `Read package.json. Create file ${scriptPath}.js with content: console.log("OK")\nThen run: node ${scriptPath}.js`
      }],
      workspaceRoot,
      maxSteps: 20,
      generateResponse: async () => JSON.stringify(responses.shift())
    });

    // Debug output
    console.log('P413_TEST2', { success: result.success, status: result.status, final: result.final });
    console.log('P413_TOOL_CALLS', JSON.stringify(result.toolCalls.map(c => ({ tool: c.tool, success: c.success }))));

    // Should have dispatched all 3 tools
    const readCall = result.toolCalls.find(c => c.tool === 'READ_FILE');
    const writeCall = result.toolCalls.find(c => c.tool === 'WRITE_FILE');
    const termCall = result.toolCalls.find(c => c.tool === 'RUN_TERMINAL');

    assert.ok(readCall, 'Expected READ_FILE tool call');
    assert.equal(readCall.success, true, 'READ_FILE should succeed');
    assert.ok(writeCall, 'Expected WRITE_FILE tool call');
    assert.equal(writeCall.success, true, 'WRITE_FILE should succeed');
    assert.ok(termCall, 'Expected RUN_TERMINAL tool call');
    assert.equal(termCall.success, true, 'RUN_TERMINAL should succeed');

    // Quality gate and final status
    assert.equal(result.success, true);
    assert.equal(result.status, 'completed');
    assert.ok(result.qualityGate?.passed, 'Quality Gate should pass');

    // Final text should exist
    assert.ok(result.final, 'Final text should exist');

    // No FINAL tool call (model was not called for final)
    const finalCalls = result.toolCalls.filter(c => c.tool === 'FINAL');
    assert.equal(finalCalls.length, 0, 'No FINAL tool call expected');
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

// Test 3: No model call after planner complete
test('Phase 4.13 — no model call after PLANNER_COMPLETE', async () => {
  const workspaceRoot = await createWorkspace();
  const scriptPath = 'src/test413nocal';
  const responses = [
    { tool: 'READ_FILE', args: { path: 'package.json' }, done: false },
    { tool: 'WRITE_FILE', args: { path: `${scriptPath}.js`, content: 'console.log("NOCALL")\n' }, done: false },
    { tool: 'RUN_TERMINAL', args: { command: `node ${scriptPath}.js` }, done: false },
    { done: true, final: 'should never be reached' }
  ];
  try {
    const result = await runAgentLoop({
      messages: [{
        role: 'user',
        content: `Read package.json. Create file ${scriptPath}.js with content: console.log("NOCALL")\nThen run: node ${scriptPath}.js`
      }],
      workspaceRoot,
      maxSteps: 20,
      generateResponse: async () => JSON.stringify(responses.shift())
    });

    // Should complete quickly without consuming all responses
    assert.equal(result.success, true);
    assert.equal(result.status, 'completed');

    // The last response 'should never be reached' should still be in the array
    // (planner dispatched all tasks without calling model)
    assert.equal(responses.length, 4, 'generateResponse should not have been called after planner complete');
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
