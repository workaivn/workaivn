import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  extractWriteContent
} from '../planner/planBuilder.js';
import {
  isDeterministicPlannerTask,
  prepareWriteFileArgsForPlannerTask
} from '../runAgentLoop.js';

async function createWorkspace() {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'workai-phase420-hf5-'));
  await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify({
      name: 'phase420-write-content',
      version: '1.0.0',
      type: 'module'
    }, null, 2),
    'utf8'
  );
  return workspaceRoot;
}

function captureLogs() {
  const logs = [];
  const original = console.log;
  console.log = (...args) => {
    logs.push(args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(' '));
    original.apply(console, args);
  };
  return {
    logs,
    restore() {
      console.log = original;
    }
  };
}

test('Phase 4.20 HF5 Test 1: WRITE_FILE prompt literals are extracted for the exact target file', async () => {
  const objective = [
    'Create src/alpha.js with:',
    'export const alpha = 1;',
    'Then run:',
    'npm test'
  ].join('\n');

  const content = extractWriteContent(objective, 'src/alpha.js');
  assert.equal(content, 'export const alpha = 1;');
});

test('Phase 4.20 HF5 Test 2: different WRITE_FILE targets keep their own literal content', async () => {
  const alphaObjective = [
    'Create src/alpha.js with:',
    'export const alpha = 1;'
  ].join('\n');
  const betaObjective = [
    'Create src/beta.js with:',
    'export const beta = 2;'
  ].join('\n');

  assert.equal(extractWriteContent(alphaObjective, 'src/alpha.js'), 'export const alpha = 1;');
  assert.equal(extractWriteContent(betaObjective, 'src/beta.js'), 'export const beta = 2;');
});

test('Phase 4.20 HF5 Test 3: WRITE_FILE without content is not deterministic', async () => {
  assert.equal(
    isDeterministicPlannerTask({ tool: 'WRITE_FILE', toolArgs: { path: 'src/bug.js' } }),
    false
  );
  assert.equal(
    isDeterministicPlannerTask({ tool: 'WRITE_FILE', toolArgs: { path: 'src/bug.js', content: '' } }),
    false
  );
  assert.equal(
    isDeterministicPlannerTask({ tool: 'WRITE_FILE', toolArgs: { path: 'src/bug.js', content: 'export {};' } }),
    true
  );
});

test('Phase 4.20 HF5 Test 4: shared preflight uses prompt literal content without model calls', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    let calls = 0;
    const result = await prepareWriteFileArgsForPlannerTask({
      task: { id: 'write-1', tool: 'WRITE_FILE', toolArgs: { path: 'src/alpha.js' } },
      args: { path: 'src/alpha.js' },
      originalPrompt: [
        'Create src/alpha.js with:',
        'export const alpha = 1;',
        'Then run:',
        'npm test'
      ].join('\n'),
      objective: 'Create src/alpha.js.',
      workspaceRoot,
      layout: { projectType: 'node', appRoots: ['src'], sourceRoots: ['src'] },
      workspaceFiles: ['src/alpha.js'],
      requiredSymbols: [],
      conversation: [],
      plan: 'planner',
      step: 1,
      generateResponse: async () => {
        calls += 1;
        return JSON.stringify({ content: 'export const shouldNotBeUsed = true;\n' });
      }
    });

    assert.equal(calls, 0);
    assert.equal(result.ok, true);
    assert.equal(result.generated, false);
    assert.equal(result.source, 'prompt_literal');
    assert.match(result.args.content, /export const alpha = 1;/);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('Phase 4.20 HF5 Test 5: shared preflight falls back to model generation when no literal exists', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    let calls = 0;
    const result = await prepareWriteFileArgsForPlannerTask({
      task: { id: 'write-2', tool: 'WRITE_FILE', toolArgs: { path: 'src/beta.js' } },
      args: { path: 'src/beta.js' },
      originalPrompt: 'Create src/beta.js as a small module.',
      objective: 'Create src/beta.js as a small module.',
      workspaceRoot,
      layout: { projectType: 'node', appRoots: ['src'], sourceRoots: ['src'] },
      workspaceFiles: ['src/beta.js'],
      requiredSymbols: [],
      conversation: [],
      plan: 'planner',
      step: 1,
      generateResponse: async () => {
        calls += 1;
        return JSON.stringify({ content: 'export const beta = 2;\n' });
      }
    });

    assert.equal(calls, 1);
    assert.equal(result.ok, true);
    assert.equal(result.generated, true);
    assert.equal(result.source, 'model_generated');
    assert.match(result.args.content, /export const beta = 2/);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('Phase 4.20 HF5 Test 6: empty model output fails after two attempts without dispatching WRITE_FILE', async () => {
  const workspaceRoot = await createWorkspace();
  const logger = captureLogs();
  try {
    let calls = 0;
    const result = await prepareWriteFileArgsForPlannerTask({
      task: { id: 'write-3', tool: 'WRITE_FILE', toolArgs: { path: 'src/gamma.js' } },
      args: { path: 'src/gamma.js' },
      originalPrompt: 'Create src/gamma.js.',
      objective: 'Create src/gamma.js.',
      workspaceRoot,
      layout: { projectType: 'node', appRoots: ['src'], sourceRoots: ['src'] },
      workspaceFiles: ['src/gamma.js'],
      requiredSymbols: [],
      conversation: [],
      plan: 'planner',
      step: 1,
      generateResponse: async () => {
        calls += 1;
        return JSON.stringify({ content: '   ' });
      }
    });

    assert.ok(calls >= 2);
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'WRITE_CONTENT_GENERATION_FAILED');
    assert.match(result.reason, /WRITE content generation failed/i);
    assert.ok(logger.logs.some(line => line.includes('[WRITE_CONTENT_GENERATION_FAILED]')));
  } finally {
    logger.restore();
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('Phase 4.20 HF5 Test 7: existing WRITE_FILE content is preserved as-is', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const result = await prepareWriteFileArgsForPlannerTask({
      task: { id: 'write-4', tool: 'WRITE_FILE', toolArgs: { path: 'src/delta.js', content: 'export const delta = 4;\n' } },
      args: { path: 'src/delta.js', content: 'export const delta = 4;\n' },
      originalPrompt: 'Create src/delta.js.',
      objective: 'Create src/delta.js.',
      workspaceRoot,
      layout: { projectType: 'node', appRoots: ['src'], sourceRoots: ['src'] },
      workspaceFiles: ['src/delta.js'],
      requiredSymbols: [],
      conversation: [],
      plan: 'planner',
      step: 1,
      generateResponse: async () => {
        throw new Error('should not be called');
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.generated, false);
    assert.equal(result.source, 'existing_transformed');
    assert.equal(result.args.content, 'export const delta = 4;\n');
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('Phase 4.20 HF5 Test 8: parser content is used before model fallback for natural language prompts', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    let calls = 0;
    const prompt = [
      'Create src/bug.js with:',
      '',
      'export function add(a,b){',
      'return a-b;',
      '}',
      '',
      'Create src/bug.test.js with exactly:',
      '',
      'import test from "node:test";',
      'import assert from "node:assert/strict";',
      'import { add } from "./bug.js";',
      '',
      'test("add()", () => {',
      'assert.equal(add(2,3),5);',
      '});',
      '',
      'Then run exactly:',
      '',
      'node --test src/bug.test.js'
    ].join('\n');

    const result = await prepareWriteFileArgsForPlannerTask({
      task: { id: 'write-5', tool: 'WRITE_FILE', toolArgs: { path: 'src/bug.js' } },
      args: { path: 'src/bug.js' },
      originalPrompt: prompt,
      objective: prompt,
      workspaceRoot,
      layout: { projectType: 'node', appRoots: ['src'], sourceRoots: ['src'] },
      workspaceFiles: ['src/bug.js', 'src/bug.test.js'],
      requiredSymbols: ['add'],
      conversation: [],
      plan: 'planner',
      step: 1,
      generateResponse: async () => {
        calls += 1;
        return JSON.stringify({ content: 'export const shouldNotBeUsed = true;\n' });
      }
    });

    assert.equal(calls, 0);
    assert.equal(result.ok, true);
    assert.equal(result.generated, false);
    assert.equal(result.source, 'prompt_literal');
    assert.match(result.args.content, /function add/);
    assert.ok(!result.args.content.includes('WRITE_FILE src/bug.test.js'));
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('Phase 4.20 HF5 Test 9: directive-only tool prompts reject literal text and fall back to the model', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    let calls = 0;
    const prompt = [
      'WRITE_FILE src/bug.js',
      'WRITE_FILE src/bug.test.js',
      'RUN_TERMINAL node --test src/bug.test.js'
    ].join('\n');

    const result = await prepareWriteFileArgsForPlannerTask({
      task: { id: 'write-6', tool: 'WRITE_FILE', toolArgs: { path: 'src/bug.js' } },
      args: { path: 'src/bug.js' },
      originalPrompt: prompt,
      objective: prompt,
      workspaceRoot,
      layout: { projectType: 'node', appRoots: ['src'], sourceRoots: ['src'] },
      workspaceFiles: ['src/bug.js', 'src/bug.test.js'],
      requiredSymbols: ['add'],
      conversation: [],
      plan: 'planner',
      step: 1,
      generateResponse: async () => {
        calls += 1;
        return JSON.stringify({ content: 'export function add(a, b) {\n  return a + b;\n}\n' });
      }
    });

    assert.equal(calls, 1);
    assert.equal(result.ok, true);
    assert.equal(result.generated, true);
    assert.equal(result.source, 'model_generated');
    assert.match(result.args.content, /return a \+ b/);
    assert.ok(!result.args.content.includes('WRITE_FILE src/bug.test.js'));
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('Phase 4.20 HF5 Test 10: parallel WRITE_FILE prompts keep file content isolated', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const prompt = [
      'Create src/bug.js with:',
      '',
      'export function add(a,b){',
      'return a-b;',
      '}',
      '',
      'Create src/bug.test.js with exactly:',
      '',
      'import test from "node:test";',
      'import assert from "node:assert/strict";',
      'import { add } from "./bug.js";',
      '',
      'test("add()", () => {',
      'assert.equal(add(2,3),5);',
      '});'
    ].join('\n');

    const [implResult, testResult] = await Promise.all([
      prepareWriteFileArgsForPlannerTask({
        task: { id: 'write-7a', tool: 'WRITE_FILE', toolArgs: { path: 'src/bug.js' } },
        args: { path: 'src/bug.js' },
        originalPrompt: prompt,
        objective: prompt,
        workspaceRoot,
        layout: { projectType: 'node', appRoots: ['src'], sourceRoots: ['src'] },
        workspaceFiles: ['src/bug.js', 'src/bug.test.js'],
        requiredSymbols: ['add'],
        conversation: [],
        plan: 'planner',
        step: 1,
        generateResponse: async () => {
          throw new Error('model should not be called for src/bug.js');
        }
      }),
      prepareWriteFileArgsForPlannerTask({
        task: { id: 'write-7b', tool: 'WRITE_FILE', toolArgs: { path: 'src/bug.test.js' } },
        args: { path: 'src/bug.test.js' },
        originalPrompt: prompt,
        objective: prompt,
        workspaceRoot,
        layout: { projectType: 'node', appRoots: ['src'], sourceRoots: ['src'] },
        workspaceFiles: ['src/bug.js', 'src/bug.test.js'],
        requiredSymbols: [],
        conversation: [],
        plan: 'planner',
        step: 1,
        generateResponse: async () => {
          throw new Error('model should not be called for src/bug.test.js');
        }
      })
    ]);

    assert.equal(implResult.ok, true);
    assert.equal(testResult.ok, true);
    assert.match(implResult.args.content, /function add/);
    assert.ok(!implResult.args.content.includes('node:test'));
    assert.match(testResult.args.content, /node:test/);
    assert.ok(!testResult.args.content.includes('return a-b;'));
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
