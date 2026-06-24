import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildAcceptanceCriteria } from '../acceptanceCriteria.js';
import { evaluateQualityGate } from '../qualityGate.js';

const execFileAsync = promisify(execFile);

async function createWorkspaceWithPkg(name) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workai-readonly-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name, version: '1.0.0', scripts: {} }, null, 2), 'utf8');
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'agent@test.local'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'Agent Test'], { cwd: root });
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: root });
  return root;
}

test('Read-only: final must include package name (pass)', async () => {
  const root = await createWorkspaceWithPkg('val-pkg');
  try {
    const content = await fs.readFile(path.join(root, 'package.json'), 'utf8');
    const toolCalls = [{ tool: 'READ_FILE', success: true, args: { path: 'package.json' }, result: { file: 'package.json', content } }];
    const criteria = buildAcceptanceCriteria('Read package.json. Show package name.');
    const criteriaRO = { ...criteria, intentMode: 'READ_ONLY', taskType: 'ANALYSIS', taskClass: 'ANALYSIS', taskMode: 'read_only', requiresWorkspaceChange: false, requiresValidationCommand: false, requiresFileRead: true };
    const gate = await evaluateQualityGate({ acceptanceCriteria: criteriaRO, changedFiles: [], toolCalls, workspaceRoot: root, finalText: 'The package name is val-pkg' });
    // eslint-disable-next-line no-console
    console.log('RO_PASS_META', { passed: gate.passed, failures: gate.failures });
    assert.equal(gate.passed, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Read-only: final missing package name should fail', async () => {
  const root = await createWorkspaceWithPkg('fail-pkg');
  try {
    const content = await fs.readFile(path.join(root, 'package.json'), 'utf8');
    const toolCalls = [{ tool: 'READ_FILE', success: true, args: { path: 'package.json' }, result: { file: 'package.json', content } }];
    const criteria = buildAcceptanceCriteria('Read package.json. Show package name. Do not modify any file. Do not run terminal.');
    const criteriaRO = { ...criteria, intentMode: 'READ_ONLY', taskType: 'ANALYSIS', taskClass: 'ANALYSIS', taskMode: 'read_only', requiresWorkspaceChange: false, requiresValidationCommand: false, requiresFileRead: true };
    const gate = await evaluateQualityGate({ acceptanceCriteria: criteriaRO, changedFiles: [], toolCalls, workspaceRoot: root, finalText: 'The package.json file is correctly formatted.' });
    // eslint-disable-next-line no-console
    console.log('RO_FAIL_META', { passed: gate.passed, failures: gate.failures });
    assert.equal(gate.passed, false);
    assert.ok(gate.failures.some(f => /does not answer/i.test(f)));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
