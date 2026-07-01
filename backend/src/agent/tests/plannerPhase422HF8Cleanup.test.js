import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runAgentLoop } from '../runAgentLoop.js';
import {
  buildWriteContext,
  validateGeneratedWriteContent
} from '../workspace.js';

const execFileAsync = promisify(execFile);

function captureLogs() {
  const logs = [];
  const original = console.log;
  console.log = (...args) => logs.push(args.map(value => {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  }).join(' '));
  return {
    logs,
    restore() { console.log = original; }
  };
}

function count(logs, marker) {
  return logs.filter(line => line.includes(marker)).length;
}

async function createGitWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workai-422-hf8-cleanup-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'hf8-cleanup-test',
      version: '1.0.0',
      type: 'module',
      scripts: { test: 'node --test src/math.test.js' }
    }, null, 2),
    'utf8'
  );
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'agent@test.local'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'Agent Test'], { cwd: root });
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: root });
  return root;
}

const VALID_TEST_CONTENT = [
  'import test from "node:test";',
  'import assert from "node:assert/strict";',
  'import { add } from "./math.js";',
  '',
  'test("math", () => {',
  '  assert.equal(add(1, 2), 3);',
  '});'
].join('\n');

const VALID_IMPL_CONTENT = 'export function add(a, b) { return a + b; }';

test('Phase 4.22-HF8-Cleanup A: coordinator reuses ValidationPolicy and emits hints exactly once', async () => {
  const root = await createGitWorkspace();
  const prompt = [
    'Create src/math.js and src/math.test.js.',
    'Implement add.',
    'Use the detected test framework.',
    'Run validation.'
  ].join('\n');

  const cap = captureLogs();
  try {
    const result = await runAgentLoop({
      messages: [{ role: 'user', content: prompt }],
      workspaceRoot: root,
      maxSteps: 12,
      generateResponse: async ({ messages }) => {
        const promptText = messages.map(m => String(m?.content || '')).join('\n');
        if (promptText.includes('WRITE COORDINATOR MODE.')) {
          return JSON.stringify({
            files: [
              { path: 'src/math.js', content: VALID_IMPL_CONTENT },
              { path: 'src/math.test.js', content: VALID_TEST_CONTENT }
            ]
          });
        }
        return JSON.stringify({ done: true, final: 'finished' });
      }
    });

    const { logs } = cap;

    // 1. ValidationPolicy built exactly once per write task (no Executor rebuild).
    assert.equal(count(logs, '[WRITE_VALIDATION_POLICY]'), 0,
      'Executor must NOT rebuild ValidationPolicy (no [WRITE_VALIDATION_POLICY] from coordinator path)');

    // 2. Executor reuses coordinator policy.
    const reused = logs.filter(line => line.includes('[WRITE_VALIDATION_POLICY_REUSED]'));
    assert.ok(reused.length >= 1, 'must emit [WRITE_VALIDATION_POLICY_REUSED]');
    const coordinatorReused = reused.find(line => line.includes('"source":"coordinator"') || line.includes('"source": "coordinator"'));
    assert.ok(coordinatorReused, 'at least one REUSED log must come from the coordinator');

    // 3. taskId preserved through write validation.
    const reusedWithTaskId = reused.find(line => line.includes('"taskId"') && !line.includes('"taskId":null') && !line.includes('"taskId": null'));
    assert.ok(reusedWithTaskId, 'REUSED log must retain the originating taskId');

    // 4. FrameworkGenerationHints emitted exactly once (prompt build only, no regeneration).
    assert.equal(count(logs, '[FRAMEWORK_GENERATION_HINTS]'), 1,
      'FrameworkGenerationHints must be emitted exactly once (during prompt construction)');

    // 5. No duplicated FrameworkRules.
    assert.equal(count(logs, '[FRAMEWORK_RULES]'), 1,
      'FrameworkRules must be emitted exactly once');

    // 6. buildWriteContext (FRAMEWORK_DETECTED) runs exactly once for the test file — proves no rebuild.
    assert.equal(count(logs, '[FRAMEWORK_DETECTED]'), 1,
      'framework detection (buildWriteContext) must run exactly once for the test file');

    // 7. FrameworkContractCheck still passes.
    assert.ok(logs.some(line => line.includes('[FRAMEWORK_CONTRACT_CHECK_PASS]')),
      'FrameworkContractCheck must still pass');

    // 8. Framework validation still runs.
    assert.ok(logs.some(line => line.includes('[FRAMEWORK_VALIDATION_PASS]')),
      'framework validation must pass');

    // 9. No auto repair on valid content.
    assert.equal(count(logs, '[FRAMEWORK_AUTO_REPAIR_START]'), 0,
      'auto repair must not run on valid content');

    assert.equal(result.qualityGate?.passed, true,
      `QualityGate should pass: ${JSON.stringify(result.qualityGate?.failures || [])}`);
  } finally {
    cap.restore();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Phase 4.22-HF8-Cleanup B: validateGeneratedWriteContent reuses provided writeContext and skips hint regeneration', async () => {
  const root = await createGitWorkspace();
  await fs.writeFile(path.join(root, 'src', 'math.js'), VALID_IMPL_CONTENT, 'utf8');

  const writeContext = await buildWriteContext({
    workspaceRoot: root,
    targetPath: 'src/math.test.js',
    projectScan: { files: ['src/math.js', 'src/math.test.js'] },
    prompt: 'Create src/math.test.js using node:test',
    workspaceFiles: ['src/math.js', 'src/math.test.js'],
    taskId: 'task-cleanup-b'
  });

  // Case 1: coordinator reuse (frameworkHintsEmitted=true) -> no second hints.
  {
    const cap = captureLogs();
    try {
      await validateGeneratedWriteContent({
        task: { id: 'task-cleanup-b' },
        workspaceRoot: root,
        targetPath: 'src/math.test.js',
        content: VALID_TEST_CONTENT,
        projectScan: { files: ['src/math.js', 'src/math.test.js'] },
        prompt: 'Create src/math.test.js using node:test',
        validationSource: 'write_coordinator',
        writeContext,
        frameworkHintsEmitted: true,
        policySource: 'coordinator'
      });
    } finally {
      cap.restore();
    }
    const { logs } = cap;
    assert.equal(count(logs, '[WRITE_VALIDATION_POLICY]'), 0, 'must not rebuild policy');
    assert.ok(count(logs, '[WRITE_VALIDATION_POLICY_REUSED]') === 1, 'must log REUSED exactly once');
    assert.ok(logs.some(line => line.includes('[WRITE_VALIDATION_POLICY_REUSED]') && line.includes('"source":"coordinator"')),
      'REUSED source must be coordinator');
    assert.equal(count(logs, '[FRAMEWORK_GENERATION_HINTS]'), 0,
      'must NOT regenerate hints when frameworkHintsEmitted=true');
    assert.equal(count(logs, '[FRAMEWORK_RULES]'), 1,
      'must still emit FRAMEWORK_RULES once (without hints)');
    assert.equal(count(logs, '[FRAMEWORK_DETECTED]'), 0,
      'must NOT re-run framework detection (reused writeContext)');
  }

  // Case 2: single-file reuse (frameworkHintsEmitted defaults false) -> hints emitted once.
  {
    const cap = captureLogs();
    try {
      await validateGeneratedWriteContent({
        task: { id: 'task-cleanup-b2' },
        workspaceRoot: root,
        targetPath: 'src/math.test.js',
        content: VALID_TEST_CONTENT,
        projectScan: { files: ['src/math.js', 'src/math.test.js'] },
        prompt: 'Create src/math.test.js using node:test',
        validationSource: 'generated_write',
        writeContext,
        policySource: 'write_generator'
      });
    } finally {
      cap.restore();
    }
    const { logs } = cap;
    assert.equal(count(logs, '[WRITE_VALIDATION_POLICY]'), 0, 'must not rebuild policy');
    assert.ok(count(logs, '[WRITE_VALIDATION_POLICY_REUSED]') === 1, 'must log REUSED exactly once');
    assert.equal(count(logs, '[FRAMEWORK_GENERATION_HINTS]'), 1,
      'must emit hints exactly once when frameworkHintsEmitted is false');
    assert.equal(count(logs, '[FRAMEWORK_RULES]'), 1,
      'must emit FRAMEWORK_RULES once (with hints)');
  }

  // Case 3: no writeContext provided -> build path (backward compatible).
  {
    const cap = captureLogs();
    try {
      await validateGeneratedWriteContent({
        task: { id: 'task-cleanup-b3' },
        workspaceRoot: root,
        targetPath: 'src/math.test.js',
        content: VALID_TEST_CONTENT,
        projectScan: { files: ['src/math.js', 'src/math.test.js'] },
        prompt: 'Create src/math.test.js using node:test',
        validationSource: 'target_prompt'
      });
    } finally {
      cap.restore();
    }
    const { logs } = cap;
    assert.ok(count(logs, '[WRITE_VALIDATION_POLICY]') === 1, 'must build policy when no writeContext provided');
    assert.equal(count(logs, '[WRITE_VALIDATION_POLICY_REUSED]'), 0, 'must not log REUSED when building');
    assert.equal(count(logs, '[FRAMEWORK_GENERATION_HINTS]'), 1, 'must emit hints once when building');
    assert.ok(count(logs, '[FRAMEWORK_DETECTED]') === 1, 'must run framework detection when building');
  }

  await fs.rm(root, { recursive: true, force: true });
});
