import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runAgentLoop } from '../runAgentLoop.js';

async function createWorkspace(pkg = { name: 'strict-pkg', version: '1.2.3', scripts: { build: 'echo build' } }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workai-strict-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
  // minimal git init to allow diff summary
  await (await import('node:child_process')).execSync?.("git init", { cwd: root });
  return root;
}

test('Read package.json -> strict final must include package name', async () => {
  const root = await createWorkspace({ name: 'strict-pkg', version: '1.0.0', scripts: {} });
  const calls = [];
  let step = 0;
  try {
    const result = await runAgentLoop({
      messages: [{ role: 'user', content: 'Read package.json. Show package name. Do not modify any file. Do not run terminal.' }],
      workspaceRoot: root,
      maxSteps: 2,
      generateResponse: async ({ messages }) => {
        calls.push(messages);
        step += 1;
        // Planner now dispatches READ_FILE directly (no model call for READ_FILE).
        // First model call receives guidance to produce FINAL with strict instructions.
        const lastSys = messages.filter(m => m.role === 'system').at(-1)?.content || '';
        assert.match(lastSys, /You have read package\.json\./);
        assert.match(lastSys, /Extract the 'name' field/);
        assert.match(lastSys, /Return JSON only/);
        return JSON.stringify({ done: true, final: "The package name is 'strict-pkg'." });
      }
    });
    const toolNames = result.toolCalls.map(c => c.tool);
    assert.ok(toolNames.includes('READ_FILE'));
    assert.ok(!toolNames.includes('RUN_TERMINAL'));
    assert.equal(result.changedFiles.length, 0);
    assert.equal(result.success, true);
    assert.ok(/strict-pkg/i.test(result.final));
    assert.equal(result.qualityGate?.passed, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
