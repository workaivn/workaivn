import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runAgentLoop } from '../runAgentLoop.js';
import { scanProject } from '../projectScanner.js';
import {
  buildFrameworkGenerationContract,
  checkFrameworkContract
} from '../framework/frameworkContractBuilder.js';

const execFileAsync = promisify(execFile);

async function createWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workai-422-hf8-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'hf8-test',
      version: '1.0.0',
      scripts: {
        test: 'node --test src/math.test.js'
      }
    }, null, 2),
    'utf8'
  );
  return root;
}

async function createGitWorkspace() {
  const root = await createWorkspace();
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'agent@test.local'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'Agent Test'], { cwd: root });
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: root });
  return root;
}

test('Phase 4.22-HF8 Test A: node:test contract contains required rules', () => {
  const contract = buildFrameworkGenerationContract({
    framework: 'node:test',
    moduleSystem: 'esm',
    targetPath: 'src/math.test.js',
    role: 'test'
  });

  assert.ok(contract, 'contract must be built for test files');
  assert.equal(contract.framework, 'node:test');
  assert.ok(contract.requiredImports.some(imp => imp.includes('node:test')), 'must require node:test');
  assert.ok(contract.requiredImports.some(imp => imp.includes('node:assert/strict')), 'must require node:assert/strict');
  assert.ok(contract.forbiddenImports.some(f => f.includes('expect')), 'must forbid expect import');
  assert.ok(contract.forbiddenGlobals.includes('expect'), 'must forbid expect global');
  assert.ok(contract.allowedAssertions.some(a => a.includes('assert.equal')), 'must allow assert.equal');
  assert.ok(contract.allowedAssertions.some(a => a.includes('assert.throws')), 'must allow assert.throws');
  assert.ok(contract.hardRules.some(r => r.includes('Do not call expect')), 'must have hard rule against expect');
});

test('Phase 4.22-HF8 Test B: coordinator prompt includes framework contract for test file', async () => {
  const root = await createGitWorkspace();
  const prompt = [
    'Create src/math.js and src/math.test.js.',
    'Implement add/subtract/multiply/divide.',
    'Use the detected test framework.',
    'Run validation.'
  ].join('\n');

  const coordinatorPrompts = [];

  try {
    await runAgentLoop({
      messages: [{ role: 'user', content: prompt }],
      workspaceRoot: root,
      maxSteps: 12,
      generateResponse: async ({ messages }) => {
        const promptText = messages.map(m => String(m?.content || '')).join('\n');
        if (promptText.includes('WRITE COORDINATOR MODE.')) {
          coordinatorPrompts.push(promptText);
          return JSON.stringify({
            files: [
              {
                path: 'src/math.js',
                content: 'export function add(a, b) { return a + b; }\nexport function subtract(a, b) { return a - b; }\nexport function multiply(a, b) { return a * b; }\nexport function divide(a, b) { return a / b; }'
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
                  '});'
                ].join('\n')
              }
            ]
          });
        }
        return JSON.stringify({ done: true, final: 'finished' });
      }
    });

    assert.ok(coordinatorPrompts.length > 0, 'coordinator prompt must be built');
    const coordinatorPrompt = coordinatorPrompts[0];
    assert.ok(coordinatorPrompt.includes('FRAMEWORK CONTRACT FOR src/math.test.js'), 'must include contract header');
    assert.ok(coordinatorPrompt.includes('import { test } from "node:test";'), 'must include required test import');
    assert.ok(coordinatorPrompt.includes('import assert from "node:assert/strict";'), 'must include required assert import');
    assert.ok(coordinatorPrompt.includes('Do not use expect().toBe() or expect() with node:test.'), 'must forbid expect call');
    assert.ok(coordinatorPrompt.includes('"frameworkContract"'), 'must include structured contract');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Phase 4.22-HF8 Test C: contract check catches expect violations', () => {
  const contract = buildFrameworkGenerationContract({
    framework: 'node:test',
    moduleSystem: 'esm',
    targetPath: 'src/math.test.js',
    role: 'test'
  });

  const invalidContent = [
    'import { test, expect } from "node:test";',
    'expect(add(1,2)).toBe(3);'
  ].join('\n');

  const logs = [];
  const originalLog = console.log;
  try {
    console.log = (...args) => logs.push(args.map(value => {
      if (typeof value === 'string') return value;
      try { return JSON.stringify(value); } catch { return String(value); }
    }).join(' '));

    const result = checkFrameworkContract(invalidContent, contract);
    assert.equal(result.pass, false);
    assert.ok(result.violations.some(v => v.includes('expect from node:test') || v.includes('expect from')), 'must report expect import violation');
    assert.ok(result.violations.some(v => v.includes('expect(')), 'must report expect call violation');
    assert.ok(logs.some(line => line.includes('[FRAMEWORK_CONTRACT_CHECK_FAIL]')), 'must log contract check fail');
  } finally {
    console.log = originalLog;
  }
});

test('Phase 4.22-HF8 Test D: contract-compliant content passes check', () => {
  const contract = buildFrameworkGenerationContract({
    framework: 'node:test',
    moduleSystem: 'esm',
    targetPath: 'src/math.test.js',
    role: 'test'
  });

  const validContent = [
    'import { test } from "node:test";',
    'import assert from "node:assert/strict";',
    '',
    'test("add", () => {',
    '  assert.equal(add(1,2), 3);',
    '});'
  ].join('\n');

  const logs = [];
  const originalLog = console.log;
  try {
    console.log = (...args) => logs.push(args.map(value => {
      if (typeof value === 'string') return value;
      try { return JSON.stringify(value); } catch { return String(value); }
    }).join(' '));

    const result = checkFrameworkContract(validContent, contract);
    assert.equal(result.pass, true);
    assert.deepEqual(result.violations, []);
    assert.ok(logs.some(line => line.includes('[FRAMEWORK_CONTRACT_CHECK_PASS]')), 'must log contract check pass');
  } finally {
    console.log = originalLog;
  }
});

test('Phase 4.22-HF8 Test E: auto repair fallback still fixes contract violations', async () => {
  const root = await createGitWorkspace();
  const prompt = [
    'Create src/math.js and src/math.test.js.',
    'Implement add/subtract/multiply/divide.',
    'Use the detected test framework.',
    'Run validation.'
  ].join('\n');

  const logs = [];
  const originalLog = console.log;

  try {
    console.log = (...args) => logs.push(args.map(value => {
      if (typeof value === 'string') return value;
      try { return JSON.stringify(value); } catch { return String(value); }
    }).join(' '));

    const result = await runAgentLoop({
      messages: [{ role: 'user', content: prompt }],
      workspaceRoot: root,
      maxSteps: 12,
      generateResponse: async ({ messages }) => {
        const promptText = messages.map(m => String(m?.content || '')).join('\n');
        if (promptText.includes('WRITE COORDINATOR MODE.')) {
          return JSON.stringify({
            files: [
              {
                path: 'src/math.js',
                content: 'export function add(a, b) { return a + b; }\nexport function subtract(a, b) { return a - b; }\nexport function multiply(a, b) { return a * b; }\nexport function divide(a, b) { return a / b; }'
              },
              {
                path: 'src/math.test.js',
                content: [
                  'import { test, expect } from "node:test";',
                  'import { add, subtract, multiply, divide } from "./math.js";',
                  '',
                  'test("math", () => {',
                  '  expect(add(1, 2)).toBe(3);',
                  '  expect(subtract(5, 2)).toBe(3);',
                  '  expect(multiply(2, 3)).toBe(6);',
                  '  expect(divide(6, 2)).toBe(3);',
                  '});'
                ].join('\n')
              }
            ]
          });
        }
        return JSON.stringify({ done: true, final: 'finished' });
      }
    });

    assert.equal(result.qualityGate?.passed, true, `QualityGate should pass: ${JSON.stringify(result.qualityGate?.failures || [])}`);
    assert.ok(logs.some(line => line.includes('[FRAMEWORK_CONTRACT_BUILT]') && line.includes('src/math.test.js') && line.includes('node:test')), 'must build contract for test file');
    assert.ok(logs.some(line => line.includes('[FRAMEWORK_CONTRACT_INJECTED]')), 'must inject contract');
    assert.ok(logs.some(line => line.includes('[FRAMEWORK_CONTRACT_CHECK_FAIL]')), 'contract check must fail for invalid content');
    assert.ok(logs.some(line => line.includes('[FRAMEWORK_VALIDATION_FAIL]')), 'framework validation must fail');
    assert.ok(logs.some(line => line.includes('[FRAMEWORK_AUTO_REPAIR_START]')), 'auto repair must start');
    assert.ok(logs.some(line => line.includes('[FRAMEWORK_AUTO_REPAIR_PASS]')), 'auto repair must pass');
    assert.ok(result.toolCalls.some(t => t.tool === 'WRITE_FILE' && String(t.args?.path || t.args?.file || '') === 'src/math.test.js'), 'test file must be written');
  } finally {
    console.log = originalLog;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Phase 4.22-HF8 Test F: implementation file does not get test framework contract', async () => {
  const root = await createGitWorkspace();
  const prompt = [
    'Create src/math.js with an add function.',
    'Do not create any test files.',
    'Run validation.'
  ].join('\n');

  const logs = [];
  const originalLog = console.log;

  try {
    console.log = (...args) => logs.push(args.map(value => {
      if (typeof value === 'string') return value;
      try { return JSON.stringify(value); } catch { return String(value); }
    }).join(' '));

    const result = await runAgentLoop({
      messages: [{ role: 'user', content: prompt }],
      workspaceRoot: root,
      maxSteps: 12,
      generateResponse: async ({ messages }) => {
        const promptText = messages.map(m => String(m?.content || '')).join('\n');
        if (promptText.includes('Generate ONLY the file content') || promptText.includes('Return JSON: {"content":"..."}')) {
          return JSON.stringify({ content: 'export function add(a, b) { return a + b; }' });
        }
        if (promptText.includes('WRITE COORDINATOR MODE.')) {
          return JSON.stringify({
            files: [
              { path: 'src/math.js', content: 'export function add(a, b) { return a + b; }' }
            ]
          });
        }
        return JSON.stringify({ done: true, final: 'finished' });
      }
    });

    assert.ok(logs.some(line => line.includes('FRAMEWORK_DETECTION_SKIPPED') && line.includes('src/math.js')), 'must skip framework detection for implementation file');
    assert.equal(logs.some(line => line.includes('[FRAMEWORK_CONTRACT_BUILT]') && line.includes('src/math.js')), false, 'must not build contract for implementation file');
    assert.ok(result.toolCalls.some(t => t.tool === 'WRITE_FILE' && String(t.args?.path || t.args?.file || '') === 'src/math.js'), 'implementation file must be written');
  } finally {
    console.log = originalLog;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Phase 4.22-HF8 Stress: ideal path uses contract and passes validation without auto repair', async () => {
  const root = await createGitWorkspace();
  const prompt = [
    'Create src/math.js and src/math.test.js.',
    'Implement add/subtract/multiply/divide.',
    'Use the detected test framework.',
    'Run validation.'
  ].join('\n');

  const logs = [];
  const originalLog = console.log;

  try {
    console.log = (...args) => logs.push(args.map(value => {
      if (typeof value === 'string') return value;
      try { return JSON.stringify(value); } catch { return String(value); }
    }).join(' '));

    const result = await runAgentLoop({
      messages: [{ role: 'user', content: prompt }],
      workspaceRoot: root,
      maxSteps: 12,
      generateResponse: async ({ messages }) => {
        const promptText = messages.map(m => String(m?.content || '')).join('\n');
        if (promptText.includes('WRITE COORDINATOR MODE.')) {
          return JSON.stringify({
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
          });
        }
        return JSON.stringify({ done: true, final: 'finished' });
      }
    });

    assert.equal(result.qualityGate?.passed, true, `QualityGate should pass: ${JSON.stringify(result.qualityGate?.failures || [])}`);
    assert.ok(logs.some(line => line.includes('[FRAMEWORK_CONTRACT_BUILT]') && line.includes('src/math.test.js') && line.includes('node:test')), 'must build contract');
    assert.ok(logs.some(line => line.includes('[FRAMEWORK_CONTRACT_INJECTED]')), 'must inject contract');
    assert.ok(logs.some(line => line.includes('[FRAMEWORK_CONTRACT_CHECK_PASS]')), 'contract check must pass');
    assert.ok(logs.some(line => line.includes('[FRAMEWORK_VALIDATION_PASS]')), 'framework validation must pass');
    assert.equal(logs.some(line => line.includes('[FRAMEWORK_AUTO_REPAIR_START]')), false, 'auto repair should not start on valid content');
    assert.ok(result.toolCalls.some(t => t.tool === 'WRITE_FILE' && String(t.args?.path || t.args?.file || '') === 'src/math.js'), 'math.js must be written');
    assert.ok(result.toolCalls.some(t => t.tool === 'WRITE_FILE' && String(t.args?.path || t.args?.file || '') === 'src/math.test.js'), 'math.test.js must be written');
    assert.ok(result.toolCalls.some(t => t.tool === 'RUN_TERMINAL' && t.args?.command === 'npm test'), 'npm test must run');
  } finally {
    console.log = originalLog;
    await fs.rm(root, { recursive: true, force: true });
  }
});
