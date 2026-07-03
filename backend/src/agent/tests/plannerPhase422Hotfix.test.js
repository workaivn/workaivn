import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildPlan, extractCommands } from '../planner/planBuilder.js';
import { scanProject } from '../projectScanner.js';
import { repairFramework } from '../framework/frameworkAutoRepair.js';
import {
  buildWriteContext,
  buildWriteValidationPolicy,
  classifyWriteTargetRole,
  validateGeneratedContentWithPolicy
} from '../workspace.js';
import { prepareWriteFileArgsForPlannerTask, runAgentLoop } from '../runAgentLoop.js';
import { OllamaProviderAdapter } from '../../services/adapters/OllamaProviderAdapter.js';
import { OpenAICompatibleProviderAdapter } from '../../services/adapters/OpenAICompatibleProviderAdapter.js';
const execFileAsync = promisify(execFile);

async function createWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workai-422-hotfix-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'hotfix-test',
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

test('Phase 4.22 Hotfix: numbered instructions are not extracted as commands', () => {
  const prompt = [
    'Create src/math.js and src/math.test.js.',
    '8. Preserve deterministic planner behavior.',
    'Do NOT modify package.json unless absolutely necessary.',
    'Run validation.'
  ].join('\n');

  assert.deepEqual(extractCommands(prompt), []);
});

test('Phase 4.22 Hotfix: protected package.json stays read-only and validation comes from project scan', async () => {
  const root = await createWorkspace();
  try {
    const scan = await scanProject(root);
    const prompt = [
      'Create src/math.js and src/math.test.js.',
      'Implement add/subtract/multiply/divide.',
      'Use existing test framework.',
      'Do NOT modify package.json unless absolutely necessary.',
      'Run validation.'
    ].join('\n');

    const plan = buildPlan(prompt, {
      taskType: 'CODING',
      taskMode: 'write_and_run',
      requestedFiles: ['src/math.js', 'src/math.test.js', 'package.json'],
      requiredCommands: [],
      projectScan: scan,
      testCommands: scan.testCommands
    });

    assert.deepEqual(
      plan.tasks.map(task => task.tool),
      ['READ_FILE', 'WRITE_FILE', 'WRITE_FILE', 'RUN_TERMINAL']
    );

    assert.deepEqual(
      plan.tasks.map(task => task.toolArgs?.path || task.toolArgs?.file || null),
      ['package.json', 'src/math.js', 'src/math.test.js', null]
    );

    assert.equal(
      plan.tasks.some(task => task.tool === 'WRITE_FILE' && String(task.toolArgs?.path || task.toolArgs?.file || '').replace(/\\/g, '/') === 'package.json'),
      false
    );

    assert.equal(plan.tasks[3].toolArgs.command, 'npm test');
    assert.deepEqual(plan.tasks[3].dependencies.length, 2);
    const writeIds = plan.tasks.filter(task => task.tool === 'WRITE_FILE').map(task => task.id);
    assert.deepEqual(plan.tasks[3].dependencies, writeIds);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Phase 4.22 Hotfix: command extraction drops prose and keeps npm test only', () => {
  const prompt = [
    'Create src/math.js and src/math.test.js.',
    'Implement add/subtract/multiply/divide.',
    'Do NOT modify package.json unless absolutely necessary.',
    'Run validation.',
    '8. Preserve deterministic planner behavior.'
  ].join('\n');

  const plan = buildPlan(prompt, {
    taskType: 'CODING',
    taskMode: 'write_and_run',
    requestedFiles: ['src/math.js', 'src/math.test.js', 'package.json'],
    requiredCommands: [],
    testCommands: ['npm test'],
    projectScan: { testCommands: ['npm test'], projectType: 'node' }
  });

  assert.deepEqual(
    extractCommands(prompt),
    []
  );
  assert.deepEqual(
    plan.tasks.map(task => task.tool),
    ['READ_FILE', 'WRITE_FILE', 'WRITE_FILE', 'RUN_TERMINAL']
  );
  assert.equal(
    plan.tasks.some(task => task.tool === 'WRITE_FILE' && String(task.toolArgs?.path || task.toolArgs?.file || '').replace(/\\/g, '/') === 'package.json'),
    false
  );
  assert.equal(plan.tasks[3].toolArgs.command, 'npm test');
});

test('Phase 4.22 Hotfix: package.json detection prompt stays read-only', () => {
  const plan = buildPlan('Read package.json to detect the existing test framework.', {
    taskType: 'ANALYSIS',
    requestedFiles: ['package.json'],
    requiredCommands: []
  });

  assert.deepEqual(plan.tasks.map(task => task.tool), ['READ_FILE']);
  assert.equal(plan.tasks.some(task => task.tool === 'WRITE_FILE'), false);
});

test('Phase 4.22 Hotfix: explicit package.json edit prompts still allow WRITE_FILE', () => {
  const plan = buildPlan('Modify package.json to add a test script.', {
    taskType: 'CODING',
    requestedFiles: ['package.json'],
    requiredCommands: []
  });

  assert.equal(plan.tasks.some(task => task.tool === 'WRITE_FILE' && String(task.toolArgs?.path || task.toolArgs?.file || '').replace(/\\/g, '/') === 'package.json'), true);
});

test('Phase 4.22 Hotfix: each WRITE_FILE gets isolated validation symbols for its own target file', async () => {
  const root = await createWorkspace();
  try {
    const scan = await scanProject(root);
    const prompt = [
      'Create src/math.js with:',
      '```',
      'export function add(a, b) { return a + b; }',
      'export function subtract(a, b) { return a - b; }',
      'export function multiply(a, b) { return a * b; }',
      'export function divide(a, b) { return a / b; }',
      '```',
      'Create src/math.test.js with exactly:',
      '```',
      'import { describe, it, expect } from "node:test";',
      'import { add, subtract, multiply, divide } from "./math.js";',
      'describe("math", () => {',
      'it("adds", () => { expect(add(1, 2)).toBe(3); });',
      '});',
      '```'
    ].join('\n');

    const mathContext = await buildWriteContext({
      workspaceRoot: root,
      targetPath: 'src/math.js',
      projectScan: scan,
      prompt,
      workspaceFiles: ['src/math.js', 'src/math.test.js']
    });
    const testContext = await buildWriteContext({
      workspaceRoot: root,
      targetPath: 'src/math.test.js',
      projectScan: scan,
      prompt,
      workspaceFiles: ['src/math.js', 'src/math.test.js']
    });

    assert.equal(mathContext.validationPolicy.role, 'implementation');
    assert.deepEqual(mathContext.validationPolicy.mustExport.sort(), ['add', 'divide', 'multiply', 'subtract']);
    assert.deepEqual(mathContext.validationPolicy.mustReference, []);
    assert.deepEqual(mathContext.validationPolicy.mustContainAny, []);

    assert.equal(testContext.validationPolicy.role, 'test');
    assert.deepEqual(testContext.validationPolicy.mustExport, []);
    assert.deepEqual(testContext.validationPolicy.mustReference.sort(), ['add', 'divide', 'multiply', 'subtract']);
    assert.deepEqual(testContext.validationPolicy.mustContainAny, []);

    assert.equal("forbiddenSymbols" in mathContext.validationPolicy, false);
    assert.equal("forbiddenSymbols" in testContext.validationPolicy, false);

    const implPolicy = buildWriteValidationPolicy({
      targetPath: 'src/math.js',
      role: classifyWriteTargetRole('src/math.js'),
      projectContext: { projectType: 'node', moduleSystem: 'esm' },
      prompt
    });
    const testPolicy = buildWriteValidationPolicy({
      targetPath: 'src/math.test.js',
      role: classifyWriteTargetRole('src/math.test.js'),
      projectContext: { projectType: 'node', moduleSystem: 'esm' },
      prompt: [
        'import { add, subtract, multiply, divide } from "./math.js";',
        '',
        'if (add(1, 2) !== 3) {',
        '  throw new Error("math functions");',
        '}'
      ].join('\n')
    });

    assert.notStrictEqual(implPolicy, testPolicy);
    const implPolicyForValidation = {
      ...implPolicy,
      mustExport: [...implPolicy.mustExport]
    };
    implPolicy.mustExport.push('fake');
    assert.equal(testPolicy.mustExport.includes('fake'), false);
    assert.equal(validateGeneratedContentWithPolicy([
      'export function add(a, b) { return a + b; }',
      'export function subtract(a, b) { return a - b; }',
      'export function multiply(a, b) { return a * b; }',
      'export function divide(a, b) { return a / b; }'
    ].join('\n'), implPolicyForValidation).success, true);

    assert.equal(validateGeneratedContentWithPolicy([
      'import { add, subtract, multiply, divide } from "./math.js";',
      '',
      'if (add(1, 2) !== 3) {',
      '  throw new Error("math functions");',
      '}'
    ].join('\n'), testPolicy).success, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Phase 4.22 Hotfix: parallel write coordinator batches multi-file generation once', async () => {
  const root = await createGitWorkspace();
  const prompt = [
    'Create src/math.js and src/math.test.js.',
    'Implement add/subtract/multiply/divide.',
    'Use existing test framework.',
    'Do NOT modify package.json unless absolutely necessary.',
    'Run validation.'
  ].join('\n');

  const coordinatorResponses = [
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
        if (promptText.includes('WRITE COORDINATOR MODE.')) {
          coordinatorCalls += 1;
          return JSON.stringify(coordinatorResponses[0]);
        }
        return JSON.stringify(coordinatorResponses[1]);
      }
    });

    assert.equal(coordinatorCalls, 1, 'Coordinator should call the model once for the write batch');
    assert.ok(result.toolCalls.some(task => task.tool === 'WRITE_FILE' && String(task.args?.path || task.args?.file || '') === 'src/math.js'));
    assert.ok(result.toolCalls.some(task => task.tool === 'WRITE_FILE' && String(task.args?.path || task.args?.file || '') === 'src/math.test.js'));
    assert.equal(result.toolCalls.filter(task => task.tool === 'RUN_TERMINAL' && task.args?.command === 'npm test').length, 1);
    assert.equal(result.qualityGate?.passed, true, `QualityGate should pass: ${JSON.stringify(result.qualityGate?.failures || [])}`);
    assert.equal(result.plannerDebugSnapshot?.writeCoordinatorUsed, true);
    assert.deepEqual(result.plannerDebugSnapshot?.coordinatorGroups?.[0]?.targetPaths, ['src/math.js', 'src/math.test.js']);
    assert.ok(result.plannerDebugSnapshot?.generatedFiles?.some(file => file.path === 'src/math.js'));
    assert.ok(result.plannerDebugSnapshot?.generatedFiles?.some(file => file.path === 'src/math.test.js'));
    assert.ok(Array.isArray(result.plannerDebugSnapshot?.frameworkAdapterResults), 'frameworkAdapterResults must be an array');
    assert.ok(result.plannerDebugSnapshot?.frameworkAdapterResults?.some(item => item.targetPath === 'src/math.test.js'));
    assert.equal(result.plannerDebugSnapshot?.fallbackReason, null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Phase 4.22 Hotfix: coordinator retries invalid node:test expect imports with framework error', async () => {
  const root = await createGitWorkspace();
  const prompt = [
    'Create src/math.js and src/math.test.js.',
    'Implement add/subtract/multiply/divide.',
    'Use the detected test framework.',
    'Do NOT modify package.json unless absolutely necessary.',
    'Run validation.'
  ].join('\n');

  const retryResponses = [
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
            'import { test, expect } from "node:test";',
            'import { add, subtract, multiply, divide } from "./math.js";',
            '',
            'test("math", () => {',
            '  expect(add(1, 2)).toBe(3);',
            '});'
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
  const coordinatorPrompts = [];
  let coordinatorCalls = 0;

  try {
    const result = await runAgentLoop({
      messages: [{ role: 'user', content: prompt }],
      workspaceRoot: root,
      maxSteps: 12,
      generateResponse: async ({ messages }) => {
        const promptText = messages.map(message => String(message?.content || '')).join('\n');
        if (promptText.includes('WRITE COORDINATOR MODE.')) {
          coordinatorPrompts.push(promptText);
          const response = retryResponses[Math.min(coordinatorCalls, retryResponses.length - 1)];
          coordinatorCalls += 1;
          return JSON.stringify(response);
        }
        return JSON.stringify(retryResponses[retryResponses.length - 1]);
      }
    });

    assert.equal(coordinatorCalls, 1, 'Coordinator should not retry when auto-repair fixes framework issue');
    assert.equal(result.qualityGate?.passed, true, `QualityGate should pass: ${JSON.stringify(result.qualityGate?.failures || [])}`);
    assert.equal(result.plannerDebugSnapshot?.writeCoordinatorUsed, true);
    assert.equal(result.plannerDebugSnapshot?.retryCount, 0, 'retryCount must be 0 when auto-repair succeeds');
    assert.equal(result.plannerDebugSnapshot?.framework, 'node:test');
    assert.equal(result.plannerDebugSnapshot?.frameworkSource, 'package.json');
    assert.equal(result.plannerDebugSnapshot?.fallbackReason, null);
    assert.ok(result.plannerDebugSnapshot?.frameworkAutoRepair, 'frameworkAutoRepair must exist in snapshot');
    assert.equal(result.plannerDebugSnapshot?.frameworkAutoRepair?.success, true, 'auto-repair must succeed');
    assert.ok(result.plannerDebugSnapshot?.frameworkAutoRepair?.appliedRepairs?.length > 0, 'auto-repair must have applied repairs');
    assert.ok(Array.isArray(result.plannerDebugSnapshot?.frameworkAdapterResults), 'frameworkAdapterResults must be an array');
    assert.ok(result.plannerDebugSnapshot?.frameworkAdapterResults?.some(item => item.targetPath === 'src/math.test.js'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Phase 4.22 Hotfix: retry preserves all exports via deterministic merge', async () => {
  const root = await createGitWorkspace();
  const prompt = [
    'Create src/math.js and src/math.test.js.',
    'Implement add/subtract/multiply/divide.',
    'Use the detected test framework.',
    'Do NOT modify package.json.',
    'Run validation.'
  ].join('\n');

  const retryResponses = [
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
    },
    {
      files: [
        {
          path: 'src/math.js',
          content: [
            'export function add(a, b) { return a + b; }',
            'export function subtract(a, b) { return a - b; }'
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
        const promptText = messages.map(m => String(m?.content || '')).join('\n');
        if (promptText.includes('WRITE COORDINATOR MODE.')) {
          const response = retryResponses[Math.min(coordinatorCalls, retryResponses.length - 1)];
          coordinatorCalls += 1;
          return JSON.stringify(response);
        }
        return JSON.stringify(retryResponses[retryResponses.length - 1]);
      }
    });

    assert.equal(coordinatorCalls, 1, 'Coordinator should not retry when auto-repair fixes framework issue');
    assert.equal(result.qualityGate?.passed, true, `QualityGate should pass: ${JSON.stringify(result.qualityGate?.failures || [])}`);
    const mathJsContent = result.toolCalls.find(t => t.tool === 'WRITE_FILE' && (t.args?.path === 'src/math.js' || t.args?.file === 'src/math.js'))?.args?.content || '';
    assert.match(mathJsContent, /export function add\(/, 'add must be preserved');
    assert.match(mathJsContent, /export function subtract\(/, 'subtract must be preserved');
    assert.match(mathJsContent, /export function multiply\(/, 'multiply must be preserved');
    assert.match(mathJsContent, /export function divide\(/, 'divide must be preserved');
    assert.equal(result.plannerDebugSnapshot?.retryCount, 0, 'retryCount must be 0 when auto-repair succeeds');
    assert.ok(result.plannerDebugSnapshot?.frameworkAutoRepair, 'frameworkAutoRepair must exist in snapshot');
    assert.equal(result.plannerDebugSnapshot?.frameworkAutoRepair?.success, true, 'auto-repair must succeed');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Phase 4.22 Hotfix: retry preserves implementation exports', async () => {
  const root = await createGitWorkspace();
  const prompt = [
    'Create src/math.js and src/math.test.js.',
    'Implement add/subtract/multiply/divide.',
    'Use the detected test framework.',
    'Run validation.'
  ].join('\n');

  const retryResponses = [
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
        const promptText = messages.map(m => String(m?.content || '')).join('\n');
        if (promptText.includes('WRITE COORDINATOR MODE.')) {
          const response = retryResponses[Math.min(coordinatorCalls, retryResponses.length - 1)];
          coordinatorCalls += 1;
          return JSON.stringify(response);
        }
        return JSON.stringify(retryResponses[retryResponses.length - 1]);
      }
    });

    assert.equal(result.qualityGate?.passed, true, `QualityGate should pass: ${JSON.stringify(result.qualityGate?.failures || [])}`);
    const mathJsContent = result.toolCalls.find(t => t.tool === 'WRITE_FILE' && (t.args?.path === 'src/math.js' || t.args?.file === 'src/math.js'))?.args?.content || '';
    assert.match(mathJsContent, /export function subtract\(/, 'subtract must be present');
    assert.match(mathJsContent, /export function multiply\(/, 'multiply must be present');
    assert.match(mathJsContent, /export function divide\(/, 'divide must be present');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Phase 4.22 Hotfix: framework repair only changes imports not test structure', async () => {
  const root = await createGitWorkspace();
  const prompt = [
    'Create src/math.js and src/math.test.js.',
    'Implement add/subtract/multiply/divide.',
    'Use the detected test framework.',
    'Run validation.'
  ].join('\n');

  let attempted = false;
  const firstTestContent = [
    'import { test, expect } from "node:test";',
    'import { add, subtract, multiply, divide } from "./math.js";',
    '',
    'test("math", () => {',
    '  expect(add(1, 2)).toBe(3);',
    '  expect(subtract(5, 2)).toBe(3);',
    '  expect(multiply(2, 3)).toBe(6);',
    '  expect(divide(6, 2)).toBe(3);',
    '});'
  ].join('\n');

  const retryTestContent = [
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
  ].join('\n');

  try {
    const result = await runAgentLoop({
      messages: [{ role: 'user', content: prompt }],
      workspaceRoot: root,
      maxSteps: 12,
      generateResponse: async ({ messages }) => {
        const promptText = messages.map(m => String(m?.content || '')).join('\n');
        if (promptText.includes('WRITE COORDINATOR MODE.')) {
          if (!attempted) {
            attempted = true;
            return JSON.stringify({
              files: [
                { path: 'src/math.js', content: 'export function add(a, b) { return a + b; }\nexport function subtract(a, b) { return a - b; }\nexport function multiply(a, b) { return a * b; }\nexport function divide(a, b) { return a / b; }' },
                { path: 'src/math.test.js', content: firstTestContent }
              ]
            });
          }
          return JSON.stringify({
            files: [
              { path: 'src/math.js', content: 'export function add(a, b) { return a + b; }\nexport function subtract(a, b) { return a - b; }\nexport function multiply(a, b) { return a * b; }\nexport function divide(a, b) { return a / b; }' },
              { path: 'src/math.test.js', content: retryTestContent }
            ]
          });
        }
        return JSON.stringify({ done: true, final: 'finished' });
      }
    });

    assert.equal(result.qualityGate?.passed, true, `QualityGate should pass: ${JSON.stringify(result.qualityGate?.failures || [])}`);
    const testContent = result.toolCalls.find(t => t.tool === 'WRITE_FILE' && (t.args?.path === 'src/math.test.js' || t.args?.file === 'src/math.test.js'))?.args?.content || '';
    assert.ok(testContent.includes('import assert from "node:assert/strict"'), 'assert import must be used');
    assert.ok(!testContent.includes('expect('), 'expect() must be replaced');
    assert.ok(testContent.includes('assert.equal(add(1, 2), 3)'), 'add test must be present');
    assert.ok(testContent.includes('assert.equal(subtract(5, 2), 3)'), 'subtract test must be present');
    assert.ok(testContent.includes('assert.equal(multiply(2, 3), 6)'), 'multiply test must be present');
    assert.ok(testContent.includes('assert.equal(divide(6, 2), 3)'), 'divide test must be present');
    assert.equal(result.plannerDebugSnapshot?.retryCount, 0);
    assert.ok(Array.isArray(result.plannerDebugSnapshot?.validationDeltas), 'validationDeltas must be an array');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Phase 4.22 Hotfix: snapshot includes validationDelta and patched regions', async () => {
  const root = await createGitWorkspace();
  const prompt = [
    'Create src/math.js and src/math.test.js.',
    'Implement add/subtract/multiply/divide.',
    'Use the detected test framework.',
    'Run validation.'
  ].join('\n');

  let attempted = false;

  try {
    const result = await runAgentLoop({
      messages: [{ role: 'user', content: prompt }],
      workspaceRoot: root,
      maxSteps: 12,
      generateResponse: async ({ messages }) => {
        const promptText = messages.map(m => String(m?.content || '')).join('\n');
        if (promptText.includes('WRITE COORDINATOR MODE.')) {
          if (!attempted) {
            attempted = true;
            return JSON.stringify({
              files: [
                { path: 'src/math.js', content: 'export function add(a, b) { return a + b; }\nexport function subtract(a, b) { return a - b; }\nexport function multiply(a, b) { return a * b; }\nexport function divide(a, b) { return a / b; }' },
                { path: 'src/math.test.js', content: 'import { test, expect } from "node:test";\nimport { add, subtract, multiply, divide } from "./math.js";\n\ntest("math", () => {\n  expect(add(1, 2)).toBe(3);\n  expect(subtract(5, 2)).toBe(3);\n  expect(multiply(2, 3)).toBe(6);\n  expect(divide(6, 2)).toBe(3);\n});' }
              ]
            });
          }
          return JSON.stringify({
            files: [
              { path: 'src/math.js', content: 'export function add(a, b) { return a + b; }\nexport function subtract(a, b) { return a - b; }\nexport function multiply(a, b) { return a * b; }\nexport function divide(a, b) { return a / b; }' },
              { path: 'src/math.test.js', content: 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { add, subtract, multiply, divide } from "./math.js";\n\ntest("math", () => {\n  assert.equal(add(1, 2), 3);\n  assert.equal(subtract(5, 2), 3);\n  assert.equal(multiply(2, 3), 6);\n  assert.equal(divide(6, 2), 3);\n});' }
            ]
          });
        }
        return JSON.stringify({ done: true, final: 'finished' });
      }
    });

    assert.equal(result.qualityGate?.passed, true, `QualityGate should pass: ${JSON.stringify(result.qualityGate?.failures || [])}`);
    const snapshot = result.plannerDebugSnapshot;
    assert.ok(snapshot, 'plannerDebugSnapshot must exist');
    assert.ok(Array.isArray(snapshot.validationDeltas), 'validationDeltas must be an array');
    if (snapshot.validationDeltas.length > 0) {
      const delta = snapshot.validationDeltas[0];
      assert.ok(delta.validationDelta, 'validationDelta must exist');
      assert.ok(Array.isArray(delta.validationDelta.preserve), 'preserve must be an array');
      assert.ok(Array.isArray(delta.validationDelta.repair), 'repair must be an array');
      assert.ok(delta.validationDelta.repair.length > 0, 'repair must contain instructions');
    }
    assert.ok(Array.isArray(snapshot.preservedRegions), 'preservedRegions must be an array');
    assert.ok(Array.isArray(snapshot.patchedRegions), 'patchedRegions must be an array');
    assert.ok(snapshot.frameworkAutoRepair, 'frameworkAutoRepair must exist in snapshot');
    assert.equal(snapshot.frameworkAutoRepair.success, true, 'auto-repair must succeed');
    assert.ok(snapshot.frameworkAutoRepair.appliedRepairs.length > 0, 'auto-repair must have applied repairs');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Phase 4.22-HF.2: repairFramework replaces import { test, expect } from node:test', () => {
  const input = 'import { test, expect } from "node:test";\nimport { add } from "./math.js";\n\ntest("math", () => {\n  expect(add(1, 2)).toBe(3);\n});\n';
  const validation = {
    framework: 'node:test',
    illegalImports: ['expect from node:test'],
    illegalCalls: ['expect'],
    repairInstructions: ['Replace expect from node:test with import from "node:assert/strict"', 'Replace expect() with assert.*']
  };
  const { repairedContent, appliedRepairs, success } = repairFramework(input, 'node:test', validation);
  assert.ok(success, 'repair must succeed');
  assert.ok(appliedRepairs.length > 0, 'must have applied repairs');
  assert.ok(repairedContent.includes('import { test } from "node:test"') || repairedContent.includes('import test from "node:test"'), 'test import must be kept');
  assert.ok(repairedContent.includes('import assert from "node:assert/strict"'), 'assert import must be added');
  assert.ok(!repairedContent.includes('expect('), 'expect() must be replaced');
  assert.ok(repairedContent.includes('assert.equal(add(1, 2), 3)'), 'expect().toBe() must become assert.equal()');
});

test('Phase 4.22-HF.2: repairFramework replaces expect().toBe() with assert.equal()', () => {
  const input = 'import { test, expect } from "node:test";\n\ntest("math", () => {\n  expect(add(1, 2)).toBe(3);\n});\n';
  const validation = {
    framework: 'node:test',
    illegalImports: ['expect from node:test'],
    illegalCalls: ['expect'],
    repairInstructions: ['Replace expect from node:test with import from "node:assert/strict"', 'Replace expect() with assert.*']
  };
  const { repairedContent, appliedRepairs, success } = repairFramework(input, 'node:test', validation);
  assert.ok(success, 'repair must succeed');
  assert.ok(repairedContent.includes('assert.equal(add(1, 2), 3)'), 'toBe must become assert.equal');
  assert.ok(!repairedContent.includes('expect('), 'expect() must be removed');
});

test('Phase 4.22-HF.2: repairFramework replaces expect(fn).toThrow() with assert.throws()', () => {
  const input = 'import { test, expect } from "node:test";\n\ntest("throws", () => {\n  expect(() => { throw new Error("foo"); }).toThrow();\n});\n';
  const validation = {
    framework: 'node:test',
    illegalImports: ['expect from node:test'],
    illegalCalls: ['expect'],
    repairInstructions: ['Replace expect from node:test with import from "node:assert/strict"', 'Replace expect() with assert.*']
  };
  const { repairedContent, appliedRepairs, success } = repairFramework(input, 'node:test', validation);
  assert.ok(success, 'repair must succeed');
  assert.ok(repairedContent.includes('assert.throws('), 'toThrow must become assert.throws');
  assert.ok(!repairedContent.includes('expect('), 'expect() must be removed');
});

test('Phase 4.22-HF6b: local provider adapters preserve a 4096 token budget', async () => {
  const originalLog = console.log;
  const capturedLogs = [];
  const capturedPayloads = [];
  const originalAxiosPost = (await import('axios')).default.post;
  const axiosModule = await import('axios');

  try {
    console.log = (...args) => capturedLogs.push(args.map(value => {
      if (typeof value === 'string') return value;
      try { return JSON.stringify(value); } catch { return String(value); }
    }).join(' '));

    axiosModule.default.post = async (_url, payload) => {
      capturedPayloads.push(payload);
      return {
        status: 200,
        data: {
          choices: [{ message: { content: 'ok' } }]
        }
      };
    };

    const llamaAdapter = new OpenAICompatibleProviderAdapter('llamacpp');
    llamaAdapter.baseUrl = 'http://127.0.0.1:8080/v1';
    llamaAdapter.apiKey = null;
    const llamaResult = await llamaAdapter.run({
      modelName: 'local-coder',
      messages: [{ role: 'user', content: 'hello' }],
      maxTokens: 4096
    });

    assert.equal(llamaResult.success, true);
    assert.equal(capturedPayloads[0].max_tokens, 4096, 'llama.cpp payload must receive 4096 tokens');
    assert.ok(!capturedLogs.some(line => line.includes('maxTokens: 512')), 'llama.cpp logs must not clamp to 512');

    capturedPayloads.length = 0;
    capturedLogs.length = 0;

    const ollamaAdapter = new OllamaProviderAdapter();
    ollamaAdapter.baseUrl = 'http://localhost:11434/v1';
    ollamaAdapter.client = {
      chat: {
        completions: {
          create: async payload => {
            capturedPayloads.push(payload);
            return {
              choices: [{ message: { content: 'ok' } }]
            };
          }
        }
      }
    };

    const ollamaResult = await ollamaAdapter.run({
      modelName: 'coder',
      messages: [{ role: 'user', content: 'hello' }],
      maxTokens: 4096
    });

    assert.equal(ollamaResult.success, true);
    assert.equal(capturedPayloads[0].max_tokens, 4096, 'Ollama payload must receive 4096 tokens');
    assert.ok(!capturedLogs.some(line => line.includes('maxTokens: 512')), 'Ollama logs must not clamp to 512');
  } finally {
    console.log = originalLog;
    axiosModule.default.post = originalAxiosPost;
  }
});

test('Phase 4.22-HF6b: recovery write target mismatches are blocked deterministically', async () => {
  const originalLog = console.log;
  const capturedLogs = [];
  try {
    console.log = (...args) => capturedLogs.push(args.map(String).join(' '));

    const result = await prepareWriteFileArgsForPlannerTask({
      task: {
        id: 'recovery-write',
        kind: 'RECOVERY',
        tool: 'WRITE_FILE',
        toolArgs: { path: 'src/math.js', content: '' }
      },
      args: { path: 'src/math.js', file: 'src/math.js' },
      objective: 'Repair src/math.js and src/math.test.js',
      workspaceRoot: process.cwd(),
      layout: {},
      workspaceFiles: ['src/math.js', 'src/math.test.js'],
      requiredSymbols: [],
      plan: 'planner',
      step: 1,
      generateResponse: async () => JSON.stringify({
        content: 'export const answer = 42;\n',
        path: 'src/modules/aiagent/aiagent.controller.js'
      }),
      conversation: [],
      maxTokens: 4096,
      onFailure: () => {}
    });

    assert.equal(result.ok, false, 'mismatched recovery target must be blocked');
    assert.match(String(result.reason || ''), /Recovery target mismatch/i);
    assert.ok(capturedLogs.some(line => line.includes('[RECOVERY_TARGET_MISMATCH_BLOCKED]')), 'must log recovery target mismatch');
  } finally {
    console.log = originalLog;
  }
});

test('Phase 4.22-HF6b: planner blocked state does not loop into LIST_FILES', async () => {
  const root = await createGitWorkspace();
  let calls = 0;
  const toolCalls = [];

  try {
    const result = await runAgentLoop({
      messages: [{ role: 'user', content: 'Create src/math.js and src/math.test.js. Run validation.' }],
      workspaceRoot: root,
      maxSteps: 6,
      generateResponse: async ({ messages }) => {
        calls += 1;
        return JSON.stringify({ tool: 'LIST_FILES', args: { limit: 500 }, done: false });
      }
    });

    toolCalls.push(...result.toolCalls);
    assert.ok(!toolCalls.some(call => call.tool === 'LIST_FILES'), 'blocked planner must not loop into LIST_FILES');
    assert.ok(
      result.status === 'needs_revision' || result.status === 'completed',
      `unexpected terminal status: ${result.status}`
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Phase 4.22-HF6c: no-change write still finalizes and releases dependency', async () => {
  const root = await createGitWorkspace();
  const logs = [];
  const originalLog = console.log;
  const mathJsContent = [
    'export function add(a, b) { return a + b; }',
    'export function subtract(a, b) { return a - b; }',
    'export function multiply(a, b) { return a * b; }',
    'export function divide(a, b) { return a / b; }'
  ].join('\n');

  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/math.js'), mathJsContent, 'utf8');

  try {
    console.log = (...args) => logs.push(args.map(value => {
      if (typeof value === 'string') return value;
      try { return JSON.stringify(value); } catch { return String(value); }
    }).join(' '));

    const result = await runAgentLoop({
      messages: [{ role: 'user', content: 'Create src/math.js and src/math.test.js. Run validation.' }],
      workspaceRoot: root,
      maxSteps: 12,
      generateResponse: async ({ messages }) => {
        const promptText = messages.map(message => String(message?.content || '')).join('\n');
        if (promptText.includes('WRITE COORDINATOR MODE.')) {
          return JSON.stringify({
            files: [
              { path: 'src/math.js', content: mathJsContent },
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
        if (promptText.includes('Generate ONLY the file content') || promptText.includes('Return JSON: {"content":"..."}')) {
          if (promptText.includes('src/math.test.js')) {
            return JSON.stringify({
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
            });
          }
          return JSON.stringify({ content: mathJsContent });
        }
        return JSON.stringify({ done: true, final: 'finished' });
      }
    });

    assert.equal(result.qualityGate?.passed, true, `QualityGate should pass: ${JSON.stringify(result.qualityGate?.failures || [])}`);
    assert.ok(logs.some(line => line.includes('[WRITE_SKIPPED_NO_CHANGE]')), 'no-change write must be logged');
    assert.ok(logs.some(line => line.includes('[WRITE_TASK_FINALIZED]')), 'write finalization must be logged');
    assert.ok(logs.some(line => line.includes('[DEPENDENCY_RELEASED]')), 'dependency release must be logged');
    assert.ok(logs.some(line => line.includes('[RUN_TERMINAL_READY]')), 'RUN_TERMINAL readiness must be logged');
    assert.ok(logs.some(line => line.includes('[WRITE_GROUP_COMPLETED]')), 'write group completion must be logged');
    assert.equal(result.toolCalls.filter(task => task.tool === 'RUN_TERMINAL' && task.args?.command === 'npm test').length, 1);
    assert.equal(result.toolCalls.some(task => task.tool === 'WRITE_FILE' && String(task.args?.path || task.args?.file || '') === 'src/math.js' && task.result?.alreadyUpToDate === true), true);
  } finally {
    console.log = originalLog;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Phase 4.22-HF6d: planner lifecycle finalizes write tasks without undefined prepared references', async () => {
  const root = await createGitWorkspace();
  const logs = [];
  const originalLog = console.log;

  try {
    console.log = (...args) => logs.push(args.map(value => {
      if (typeof value === 'string') return value;
      try { return JSON.stringify(value); } catch { return String(value); }
    }).join(' '));

    const result = await runAgentLoop({
      messages: [{ role: 'user', content: 'Create src/math.js. Use the existing project setup.' }],
      workspaceRoot: root,
      maxSteps: 10,
      generateResponse: async ({ messages }) => {
        const promptText = messages.map(message => String(message?.content || '')).join('\n');
        if (promptText.includes('WRITE COORDINATOR MODE.')) {
          return JSON.stringify({
            files: [
              {
                path: 'src/math.js',
                content: 'export function add(a, b) { return a + b; }'
              }
            ]
          });
        }
        if (promptText.includes('Generate ONLY the file content') || promptText.includes('Return JSON: {"content":"..."}')) {
          return JSON.stringify({ content: 'export function add(a, b) { return a + b; }' });
        }
        return JSON.stringify({ done: true, final: 'finished' });
      }
    });

    assert.ok(result.toolCalls.some(task => task.tool === 'WRITE_FILE'), 'write task should execute');
    assert.ok(logs.some(line => line.includes('[EXECUTOR_ENTRY]')), 'executor entry must be logged');
    assert.ok(logs.some(line => line.includes('[WRITE_FILE_DISPATCH_READY]')), 'write dispatch readiness must be logged');
    assert.ok(logs.some(line => line.includes('[EXECUTION_MEMORY_STORE]')), 'execution memory store must be logged');
    assert.ok(logs.some(line => line.includes('[EXECUTOR_EXIT]')), 'executor exit must be logged');
    assert.ok(logs.some(line => line.includes('[WRITE_TASK_FINALIZED]')), 'write finalization must be logged');
    assert.equal(logs.some(line => line.includes('prepared is not defined')), false, 'prepared reference must be defined throughout lifecycle');

    const sequence = [
      '[EXECUTOR_ENTRY]',
      '[WRITE_FILE_DISPATCH_READY]',
      '[EXECUTION_MEMORY_STORE]',
      '[EXECUTOR_EXIT]',
      '[WRITE_TASK_FINALIZED]'
    ];
    let lastIndex = -1;
    for (const marker of sequence) {
      const index = logs.findIndex((line, lineIndex) => lineIndex > lastIndex && line.includes(marker));
      assert.notEqual(index, -1, `missing lifecycle log: ${marker}`);
      lastIndex = index;
    }
  } finally {
    console.log = originalLog;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Phase 4.22-HF6c: framework auto repair preserves already-valid files', async () => {
  const root = await createGitWorkspace();
  const logs = [];
  const originalLog = console.log;

  try {
    console.log = (...args) => logs.push(args.map(value => {
      if (typeof value === 'string') return value;
      try { return JSON.stringify(value); } catch { return String(value); }
    }).join(' '));

    const result = await runAgentLoop({
      messages: [{ role: 'user', content: 'Create src/math.js and src/math.test.js. Run validation.' }],
      workspaceRoot: root,
      maxSteps: 12,
      generateResponse: async ({ messages }) => {
        const promptText = messages.map(message => String(message?.content || '')).join('\n');
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
    assert.ok(logs.some(line => line.includes('[FRAMEWORK_AUTO_REPAIR_PASS]')), 'framework auto repair must pass');
    assert.ok(logs.some(line => line.includes('[WRITE_COORDINATOR_PRESERVED_VALID_FILE]') && line.includes('src/math.js')), 'valid implementation file must be preserved');
    assert.equal(logs.some(line => line.includes('[WRITE_COORDINATOR_DISPATCH]') && line.includes('src/math.js') && line.includes('already_valid')), false, 'already valid file should not be re-dispatched as a repair');
  } finally {
    console.log = originalLog;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Phase 4.22-HF10: WRITE Coordinator compact prompt avoids local timeout fallback', async () => {
  const root = await createGitWorkspace();
  const originalLog = console.log;
  const capturedLogs = [];
  const coordinatorCalls = [];

  try {
    console.log = (...args) => capturedLogs.push(args.map(value => {
      if (typeof value === 'string') return value;
      try { return JSON.stringify(value); } catch { return String(value); }
    }).join(' '));

    const result = await runAgentLoop({
      messages: [{
        role: 'user',
        content: [
          'Create src/math.js and src/math.test.js.',
          'Implement add/subtract/multiply/divide.',
          'Use node:test.',
          'Do NOT modify package.json unless absolutely necessary.',
          'Run validation.'
        ].join('\n')
      }],
      workspaceRoot: root,
      maxSteps: 12,
      policy: { localModelMode: true },
      generateResponse: async ({ messages, maxTokens }) => {
        const promptText = messages.map(message => String(message?.content || '')).join('\n');
        if (promptText.includes('WRITE COORDINATOR MODE.')) {
          coordinatorCalls.push({ promptLength: promptText.length, maxTokens });
          if (coordinatorCalls.length === 1) {
            const error = new Error('Request timed out');
            error.code = 'ECONNABORTED';
            throw error;
          }
          return JSON.stringify({
            files: [
              {
                path: 'src/math.js',
                content: [
                  'export function add(a, b) { return a + b; }',
                  'export function subtract(a, b) { return a - b; }',
                  'export function multiply(a, b) { return a * b; }',
                  'export function divide(a, b) {',
                  '  if (b === 0) throw new Error("Cannot divide by zero");',
                  '  return a / b;',
                  '}'
                ].join('\n')
              },
              {
                path: 'src/math.test.js',
                content: [
                  'import test from "node:test";',
                  'import assert from "node:assert/strict";',
                  'import { add, subtract, multiply, divide } from "./math.js";',
                  '',
                  'test("math operations", () => {',
                  '  assert.equal(add(1, 2), 3);',
                  '  assert.equal(subtract(5, 2), 3);',
                  '  assert.equal(multiply(2, 3), 6);',
                  '  assert.equal(divide(6, 2), 3);',
                  '  assert.throws(() => divide(1, 0));',
                  '});'
                ].join('\n')
              }
            ]
          });
        }
        return JSON.stringify({ done: true, final: 'finished' });
      }
    });

    assert.equal(coordinatorCalls.length, 1, 'local coordinator should try the model once');
    assert.ok(coordinatorCalls[0].promptLength < 2500, 'compact prompt must stay small enough for two-file writes');
    assert.ok(coordinatorCalls[0].maxTokens <= 1600, 'local coordinator budget must stay compact');
    assert.ok(capturedLogs.some(line => line.includes('[WRITE_COORDINATOR_PROMPT_COMPACTED]')));
    assert.ok(capturedLogs.some(line => line.includes('[WRITE_COORDINATOR_TIMEOUT]')));
    assert.ok(capturedLogs.some(line => line.includes('[WRITE_COORDINATOR_FALLBACK_DETERMINISTIC]')));
    assert.equal(result.toolCalls.filter(task => task.tool === 'WRITE_FILE' && String(task.args?.path || task.args?.file || '') === 'src/math.js').length, 1);
    assert.equal(result.toolCalls.filter(task => task.tool === 'WRITE_FILE' && String(task.args?.path || task.args?.file || '') === 'src/math.test.js').length, 1);
    assert.equal(result.toolCalls.filter(task => task.tool === 'RUN_TERMINAL' && task.args?.command === 'npm test').length, 1);
    assert.ok(result.plannerDebugSnapshot?.writeCoordinatorUsed, 'write coordinator must stay active');
    assert.deepEqual(result.plannerDebugSnapshot?.coordinatorGroups?.[0]?.targetPaths, ['src/math.js', 'src/math.test.js']);
    assert.ok(result.plannerDebugSnapshot?.generatedFiles?.some(file => file.path === 'src/math.js'));
    assert.ok(result.plannerDebugSnapshot?.generatedFiles?.some(file => file.path === 'src/math.test.js'));
    assert.equal(result.qualityGate?.passed, true, `QualityGate should pass: ${JSON.stringify(result.qualityGate?.failures || [])}`);
  } finally {
    console.log = originalLog;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Phase 4.22-HF6c: provider generation limits are logged with the resolved budget', async () => {
  const originalLog = console.log;
  const capturedLogs = [];
  const capturedPayloads = [];
  const originalAxiosPost = (await import('axios')).default.post;
  const axiosModule = await import('axios');

  try {
    console.log = (...args) => capturedLogs.push(args.map(value => {
      if (typeof value === 'string') return value;
      try { return JSON.stringify(value); } catch { return String(value); }
    }).join(' '));

    axiosModule.default.post = async (_url, payload) => {
      capturedPayloads.push(payload);
      return {
        status: 200,
        data: {
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }]
        }
      };
    };

    const adapter = new OpenAICompatibleProviderAdapter('llamacpp');
    adapter.baseUrl = 'http://127.0.0.1:8080/v1';
    adapter.apiKey = null;
    const result = await adapter.run({
      modelName: 'local-coder',
      messages: [{ role: 'user', content: 'hello' }],
      maxTokens: 4096
    });

    assert.equal(result.success, true);
    assert.equal(capturedPayloads[0].max_tokens, 4096);
    assert.ok(capturedLogs.some(line => line.includes('[PROVIDER_GENERATION_LIMITS]')), 'generation limits must be logged');
    assert.ok(capturedLogs.some(line => line.includes('"effectiveMaxTokens":4096')), 'resolved budget must stay at 4096');
    assert.ok(!capturedLogs.some(line => line.includes('maxTokens: 512')), 'no 512 clamp should remain in generation logs');
  } finally {
    console.log = originalLog;
    axiosModule.default.post = originalAxiosPost;
  }
});

test('Phase 4.22-HF12: coordinator retry preserves previously validated files across partial batch regeneration', async () => {
  const root = await createGitWorkspace();
  const originalLog = console.log;
  const capturedLogs = [];
  const coordinatorCalls = [];

  try {
    console.log = (...args) => capturedLogs.push(args.map(value => {
      if (typeof value === 'string') return value;
      try { return JSON.stringify(value); } catch { return String(value); }
    }).join(' '));

    const result = await runAgentLoop({
      messages: [{
        role: 'user',
        content: [
          'Create src/math.js and src/math.test.js.',
          'Implement add/subtract/multiply/divide.',
          'Use the detected test framework.',
          'Do NOT modify package.json unless absolutely necessary.',
          'Run validation.'
        ].join('\n')
      }],
      workspaceRoot: root,
      maxSteps: 12,
      generateResponse: async ({ messages }) => {
        const promptText = messages.map(message => String(message?.content || '')).join('\n');
        const isCoordinatorPrompt = /COORDINATOR MODE\./.test(promptText) || /WRITE COORDINATOR MODE/i.test(promptText) || /DELTA COORDINATOR MODE/i.test(promptText);
        if (isCoordinatorPrompt) {
          coordinatorCalls.push(promptText);
          if (coordinatorCalls.length === 1) {
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
                    'const test = require("node:test");',
                    'const assert = require("node:assert/strict");',
                    'const { add, subtract, multiply, divide } = require("./math.js");',
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

          return JSON.stringify({
            files: [
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
    assert.ok(result.toolCalls.some(task => task.tool === 'WRITE_FILE' && String(task.args?.path || task.args?.file || '') === 'src/math.js'), 'math.js must survive retry');
    assert.ok(result.toolCalls.some(task => task.tool === 'WRITE_FILE' && String(task.args?.path || task.args?.file || '') === 'src/math.test.js'), 'math.test.js must survive retry');
    assert.ok(result.toolCalls.some(task => task.tool === 'RUN_TERMINAL' && task.args?.command === 'npm test'), 'RUN_TERMINAL must execute');
    assert.ok(capturedLogs.some(line => line.includes('[COORDINATOR_BATCH_CREATED]')), 'batch creation must be logged');
    assert.ok(capturedLogs.some(line => line.includes('[COORDINATOR_CURRENT_FILES_BEFORE_RETRY]')), 'current files before retry must be logged');
    assert.ok(capturedLogs.some(line => line.includes('[COORDINATOR_CURRENT_FILES_AFTER_RETRY]')), 'current files after retry must be logged');
    assert.ok(capturedLogs.some(line => line.includes('[VALIDATION_SOURCE_SELECTED]')), 'validation source must be selected from the batch state');
    assert.ok(capturedLogs.some(line => line.includes('[VALIDATION_BATCH_FILES]')), 'validation batch files must be logged');
    assert.ok(capturedLogs.some(line => line.includes('[VALIDATION_FILE_LOOKUP]')), 'validation must look up each expected file from the batch state');
    assert.equal(capturedLogs.some(line => line.includes('Missing expected file(s): src/math.js')), false, 'retry must not drop the implementation file');
  } finally {
    console.log = originalLog;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Phase 5.03-HF2: write coordinator retries only the missing file and completes the batch', async () => {
  const root = await createGitWorkspace();
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'hotfix-test',
    version: '1.0.0',
    type: 'module',
    scripts: {
      test: 'node --test src/math.test.js'
    }
  }, null, 2), 'utf8');
  const originalLog = console.log;
  const capturedLogs = [];
  let coordinatorCalls = 0;

  try {
    console.log = (...args) => capturedLogs.push(args.map(value => {
      if (typeof value === 'string') return value;
      try { return JSON.stringify(value); } catch { return String(value); }
    }).join(' '));

    const mathJsContent = [
      'export function add(a, b) { return a + b; }',
      'export function subtract(a, b) { return a - b; }',
      'export function multiply(a, b) { return a * b; }',
      'export function divide(a, b) { return a / b; }'
    ].join('\n');
    const mathTestContent = [
      'import { test } from "node:test";',
      'import * as assert from "node:assert/strict";',
      'import { add, subtract, multiply, divide } from "./math.js";',
      '',
      'test("math", () => {',
      '  assert.equal(add(1, 2), 3);',
      '  assert.equal(subtract(5, 2), 3);',
      '  assert.equal(multiply(2, 3), 6);',
      '  assert.equal(divide(6, 2), 3);',
      '});'
    ].join('\n');

    const result = await runAgentLoop({
      messages: [{
        role: 'user',
        content: [
          'Create src/math.js and src/math.test.js.',
          'Implement add/subtract/multiply/divide.',
          'Use the detected test framework.',
          'Do NOT modify package.json unless absolutely necessary.',
          'Run validation.'
        ].join('\n')
      }],
      workspaceRoot: root,
      maxSteps: 12,
      generateResponse: async ({ messages }) => {
        const promptText = messages.map(message => String(message?.content || '')).join('\n');
        if (promptText.includes('WRITE COORDINATOR MODE.')) {
          coordinatorCalls += 1;
          if (coordinatorCalls === 1) {
            return JSON.stringify({
              files: [{ path: 'src/math.js', content: mathJsContent }]
            });
          }
          return mathTestContent;
        }
        if (promptText.includes('src/math.test.js')) {
          return JSON.stringify({ content: mathTestContent });
        }
        if (promptText.includes('src/math.js')) {
          return JSON.stringify({ content: mathJsContent });
        }
        return JSON.stringify({ done: true, final: 'finished' });
      }
    });

    assert.equal(coordinatorCalls, 2, 'Coordinator must retry the missing file once');
    assert.equal(result.success, true, `Run should succeed: ${result.error || ''}`);
    assert.equal(result.qualityGate?.passed, true, `QualityGate should pass: ${JSON.stringify(result.qualityGate?.failures || [])}`);
    assert.ok(capturedLogs.some(line => line.includes('[WRITE_BATCH_COMPLETENESS_CHECK]') && line.includes('src/math.js') && line.includes('src/math.test.js')));
    assert.ok(capturedLogs.some(line => line.includes('[WRITE_BATCH_MISSING_FILES]') && line.includes('src/math.test.js')));
    assert.ok(capturedLogs.some(line => line.includes('[WRITE_BATCH_RETRY_MISSING]') && line.includes('src/math.test.js')));
    assert.ok(capturedLogs.some(line => line.includes('[WRITE_BATCH_COMPLETE]') && line.includes('src/math.js') && line.includes('src/math.test.js')));
    await fs.access(path.join(root, 'src/math.js'));
    await fs.access(path.join(root, 'src/math.test.js'));
  } finally {
    console.log = originalLog;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Phase 5.03-HF2: retry exhaustion reports the missing file explicitly and does not pass quality gate', async () => {
  const root = await createGitWorkspace();
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'hotfix-test',
    version: '1.0.0',
    type: 'module',
    scripts: {
      test: 'node --test src/math.test.js'
    }
  }, null, 2), 'utf8');
  const originalLog = console.log;
  const capturedLogs = [];
  let coordinatorCalls = 0;

  try {
    console.log = (...args) => capturedLogs.push(args.map(value => {
      if (typeof value === 'string') return value;
      try { return JSON.stringify(value); } catch { return String(value); }
    }).join(' '));

    const mathJsContent = [
      'export function add(a, b) { return a + b; }',
      'export function subtract(a, b) { return a - b; }',
      'export function multiply(a, b) { return a * b; }',
      'export function divide(a, b) { return a / b; }'
    ].join('\n');
    const mathTestContent = [
      'import { test } from "node:test";',
      'import * as assert from "node:assert/strict";',
      'import { add, subtract, multiply, divide } from "./math.js";',
      '',
      'test("math", () => {',
      '  assert.equal(add(1, 2), 3);',
      '  assert.equal(subtract(5, 2), 3);',
      '  assert.equal(multiply(2, 3), 6);',
      '  assert.equal(divide(6, 2), 3);',
      '});'
    ].join('\n');

    const result = await runAgentLoop({
      messages: [{
        role: 'user',
        content: [
          'Create src/math.js and src/math.test.js.',
          'Implement add/subtract/multiply/divide.',
          'Use the detected test framework.',
          'Do NOT modify package.json unless absolutely necessary.',
          'Run validation.'
        ].join('\n')
      }],
      workspaceRoot: root,
      maxSteps: 12,
      generateResponse: async ({ messages }) => {
        const promptText = messages.map(message => String(message?.content || '')).join('\n');
        if (promptText.includes('WRITE COORDINATOR MODE.')) {
          coordinatorCalls += 1;
          return JSON.stringify({
            files: [{ path: 'src/math.js', content: mathJsContent }]
          });
        }
        if (promptText.includes('src/math.test.js')) {
          return JSON.stringify({ content: '' });
        }
        if (promptText.includes('src/math.js')) {
          return JSON.stringify({ content: mathJsContent });
        }
        return JSON.stringify({ done: true, final: 'finished' });
      }
    });

    assert.equal(coordinatorCalls, 3, 'Coordinator must exhaust the retry budget');
    assert.equal(result.success, false, 'Run must not report success');
    assert.match(String(result.error || ''), /Finalization blocked: explicit requested file missing: src\/math\.test\.js|Expected file was not generated: src\/math\.test\.js/);
    assert.notEqual(result.qualityGate?.passed, true, 'Quality gate must not pass on an incomplete batch');
    assert.ok(capturedLogs.some(line => line.includes('[WRITE_BATCH_INCOMPLETE_BLOCKED]') && line.includes('src/math.test.js')));
    assert.ok(!capturedLogs.some(line => line.includes('generic patch validation failed')), 'failure must not collapse into generic patch validation');
  } finally {
    console.log = originalLog;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Phase 5.03-HF2: markdown file headers and fenced paths are parsed as write batch files', async () => {
  const root = await createGitWorkspace();
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'hotfix-test',
    version: '1.0.0',
    type: 'module',
    scripts: {
      test: 'node --test src/math.test.js'
    }
  }, null, 2), 'utf8');
  const originalLog = console.log;
  const capturedLogs = [];
  let coordinatorCalls = 0;

  try {
    console.log = (...args) => capturedLogs.push(args.map(value => {
      if (typeof value === 'string') return value;
      try { return JSON.stringify(value); } catch { return String(value); }
    }).join(' '));

    const mathJsContent = [
      'export function add(a, b) { return a + b; }',
      'export function subtract(a, b) { return a - b; }',
      'export function multiply(a, b) { return a * b; }',
      'export function divide(a, b) { return a / b; }'
    ].join('\n');
    const mathTestContent = [
      'import { test } from "node:test";',
      'import * as assert from "node:assert/strict";',
      'import { add, subtract, multiply, divide } from "./math.js";',
      '',
      'test("math", () => {',
      '  assert.equal(add(1, 2), 3);',
      '  assert.equal(subtract(5, 2), 3);',
      '  assert.equal(multiply(2, 3), 6);',
      '  assert.equal(divide(6, 2), 3);',
      '});'
    ].join('\n');

    const result = await runAgentLoop({
      messages: [{
        role: 'user',
        content: [
          'Create src/math.js and src/math.test.js.',
          'Implement add/subtract/multiply/divide.',
          'Use the detected test framework.',
          'Do NOT modify package.json unless absolutely necessary.',
          'Run validation.'
        ].join('\n')
      }],
      workspaceRoot: root,
      maxSteps: 12,
      generateResponse: async ({ messages }) => {
        const promptText = messages.map(message => String(message?.content || '')).join('\n');
        if (promptText.includes('WRITE COORDINATOR MODE.')) {
          coordinatorCalls += 1;
          return [
            'File: src/math.js',
            '```javascript path="src/math.js"',
            ...mathJsContent.split('\n'),
            '```',
            'Path: src/math.test.js',
            '```javascript filename="src/math.test.js"',
            ...mathTestContent.split('\n'),
            '```'
          ].join('\n');
        }
        if (promptText.includes('src/math.test.js')) {
          return JSON.stringify({ content: mathTestContent });
        }
        if (promptText.includes('src/math.js')) {
          return JSON.stringify({ content: mathJsContent });
        }
        return JSON.stringify({ done: true, final: 'finished' });
      }
    });

    assert.ok(coordinatorCalls >= 1, 'Markdown response should trigger coordinator');
    assert.equal(result.success, true, `Run should succeed: ${result.error || ''}`);
    assert.equal(result.qualityGate?.passed, true, `QualityGate should pass: ${JSON.stringify(result.qualityGate?.failures || [])}`);
    assert.ok(capturedLogs.some(line => line.includes('[WRITE_BATCH_COMPLETE]') && line.includes('src/math.js') && line.includes('src/math.test.js')));
    await fs.access(path.join(root, 'src/math.js'));
    await fs.access(path.join(root, 'src/math.test.js'));
  } finally {
    console.log = originalLog;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Phase 4.22-HF13.5: coordinator batch failure does not block sibling write tasks', async () => {
  const root = await createGitWorkspace();
  const originalLog = console.log;
  const capturedLogs = [];

  try {
    console.log = (...args) => capturedLogs.push(args.map(value => {
      if (typeof value === 'string') return value;
      try { return JSON.stringify(value); } catch { return String(value); }
    }).join(' '));

    const result = await runAgentLoop({
      messages: [{
        role: 'user',
        content: [
          'Create src/math.js and src/math.test.js.',
          'Implement add/subtract/multiply/divide.',
          'Use the detected test framework.',
          'Do NOT modify package.json unless absolutely necessary.',
          'Run validation.'
        ].join('\n')
      }],
      workspaceRoot: root,
      maxSteps: 12,
      generateResponse: async ({ messages }) => {
        const promptText = messages.map(message => String(message?.content || '')).join('\n');
        const isCoordinatorPrompt = /WRITE COORDINATOR MODE\.|DELTA COORDINATOR MODE/i.test(promptText);
        if (isCoordinatorPrompt) {
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
              }
            ]
          });
        }
        return JSON.stringify({
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
        });
      }
    });

    assert.equal(result.qualityGate?.passed, true, `QualityGate should pass: ${JSON.stringify(result.qualityGate?.failures || [])}`);
    assert.ok(result.toolCalls.some(task => task.tool === 'WRITE_FILE' && String(task.args?.path || task.args?.file || '') === 'src/math.js'), 'math.js must be generated');
    assert.ok(result.toolCalls.some(task => task.tool === 'WRITE_FILE' && String(task.args?.path || task.args?.file || '') === 'src/math.test.js'), 'math.test.js must still be executed after coordinator failure');
    assert.equal(
      result.plannerDebugSnapshot?.tasks?.some(task => task.tool === 'WRITE_FILE' && String(task.status || '').toUpperCase() === 'BLOCKED'),
      false,
      'coordinator retry failure must not block sibling write tasks'
    );
    assert.equal(result.plannerDebugSnapshot?.writeCoordinator?.batchState?.status, 'FAILED');
    assert.ok(capturedLogs.some(line => line.includes('[BATCH_STATE_CREATED]')), 'batch creation must be logged');
    assert.ok(capturedLogs.some(line => line.includes('[BATCH_STATE_UPDATED]')), 'batch updates must be logged');
    assert.ok(capturedLogs.some(line => line.includes('[BATCH_STATE_FAILED]')), 'batch failure must be logged');
  } finally {
    console.log = originalLog;
    await fs.rm(root, { recursive: true, force: true });
  }
});
