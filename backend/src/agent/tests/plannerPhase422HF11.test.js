import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { detectFramework } from '../framework/frameworkAdapter.js';
import { validateStructuralContent } from '../writeCoordinator/validationDelta.js';
import { runAgentLoop } from '../runAgentLoop.js';

const execFileAsync = promisify(execFile);

async function createGitWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workai-422-hf11-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'hf11-test',
      version: '1.0.0',
      scripts: {
        test: 'node --test src/math.test.js'
      }
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

function captureLogs(fn) {
  const logs = [];
  const original = console.log;
  console.log = (...args) => {
    logs.push(args.map(arg => {
      if (typeof arg === 'string') return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }).join(' '));
  };
  try {
    const result = fn();
    return { result, logs };
  } finally {
    console.log = original;
  }
}

test('Phase 4.22-HF11: generic test framework availability is non-runnable without commands', () => {
  const { result, logs } = captureLogs(() => detectFramework({}));

  assert.equal(result.framework, 'generic-js-test');
  assert.equal(result.availability.framework, 'generic-js-test');
  assert.equal(result.availability.runnable, false);
  assert.equal(result.availability.reason, 'generic_style_only');
  assert.ok(logs.some(line => line.includes('[TEST_FRAMEWORK_AVAILABILITY]')));
});

test('Phase 4.22-HF11: package.json test script makes the test framework runnable', () => {
  const { result } = captureLogs(() => detectFramework({
    packageJson: {
      scripts: {
        test: 'node --test src/math.test.js'
      }
    }
  }));

  assert.equal(result.framework, 'node:test');
  assert.equal(result.availability.framework, 'node:test');
  assert.equal(result.availability.runnable, true);
  assert.equal(result.availability.validationCommand, 'node --test src/math.test.js');
  assert.equal(result.availability.source, 'package.json');
});

test('Phase 4.22-HF11: structural validation rejects import-only test output and forces a retry', async () => {
  const root = await createGitWorkspace();
  const prompt = [
    'Create src/math.js and src/math.test.js.',
    'Implement add/subtract/multiply/divide.',
    'Use the detected test framework.',
    'Run validation.'
  ].join('\n');

  const responses = [
    {
      files: [
        {
          path: 'src/math.js',
          content: [
            'export function add(a, b) { return a + b; }',
            'export function subtract(a, b) { return a - b; }',
            'export function multiply(a, b) { return a * b; }',
            'export function divide(a, b) { return a / b; }'
          ].join('\n')
        },
        {
          path: 'src/math.test.js',
          content: [
            'import test from "node:test";',
            'import assert from "node:assert/strict";',
            'import { add, subtract, multiply, divide } from "./math.js";'
          ].join('\n')
        }
      ]
    },
    {
      files: [
        {
          path: 'src/math.js',
          content: [
            'export function add(a, b) { return a + b; }',
            'export function subtract(a, b) { return a - b; }',
            'export function multiply(a, b) { return a * b; }',
            'export function divide(a, b) { return a / b; }'
          ].join('\n')
        },
        {
          path: 'src/math.test.js',
          content: [
            'import test from "node:test";',
            'import assert from "node:assert/strict";',
            'import { add, subtract, multiply, divide } from "./math.js";',
            '',
            'test("math", () => {',
            '  assert.equal(add(1, 2), 3);',
            '  assert.equal(subtract(5, 2), 3);',
            '  assert.equal(multiply(2, 3), 6);',
            '  assert.equal(divide(6, 2), 3);',
            '});'
          ].join('\n')
        }
      ]
    },
    { done: true, final: 'finished' }
  ];

  let coordinatorCalls = 0;

  try {
    const result = await runAgentLoop({
      messages: [{ role: 'user', content: prompt }],
      workspaceRoot: root,
      maxSteps: 12,
      generateResponse: async ({ messages }) => {
        const promptText = messages.map(message => String(message?.content || '')).join('\n');
        const isCoordinatorPrompt = promptText.includes('WRITE COORDINATOR MODE.') || promptText.includes('DELTA COORDINATOR MODE.');
        if (isCoordinatorPrompt) {
          const response = responses[Math.min(coordinatorCalls, responses.length - 1)];
          coordinatorCalls += 1;
          return JSON.stringify(response);
        }
        return JSON.stringify(responses[responses.length - 1]);
      }
    });

    assert.ok(coordinatorCalls >= 2, `expected a retry after structural rejection, got ${coordinatorCalls}`);
    assert.equal(result.qualityGate?.passed, true, `QualityGate should pass: ${JSON.stringify(result.qualityGate?.failures || [])}`);
    assert.ok(result.toolCalls.some(entry => entry.tool === 'WRITE_FILE' && String(entry.args?.path || entry.args?.file || '') === 'src/math.js'));
    assert.ok(result.toolCalls.some(entry => entry.tool === 'WRITE_FILE' && String(entry.args?.path || entry.args?.file || '') === 'src/math.test.js'));

    const validationDelta = validateStructuralContent({
      targetPath: 'src/math.test.js',
      content: [
        'import test from "node:test";',
        'import assert from "node:assert/strict";',
        'import { add } from "./math.js";'
      ].join('\n'),
      role: 'test'
    });
    assert.equal(validationDelta.success, false);
    assert.equal(validationDelta.reason, 'import_only_or_partial_test_file');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
