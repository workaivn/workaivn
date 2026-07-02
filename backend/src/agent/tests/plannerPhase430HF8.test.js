import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

import { runAgentLoop } from '../runAgentLoop.js';
import { normalizeModelResponse } from '../runtime/modelResponseNormalizer.js';
import { normalizeCoordinatorResponse } from '../writeCoordinator/responseNormalizer.js';
import { parseDeltaRetryResponse } from '../writeCoordinator/validationDelta.js';
import { validateFramework } from '../framework/frameworkAdapter.js';

const execFileAsync = promisify(execFile);

async function createGitWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workai-hf8-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'hf8',
      version: '1.0.0',
      type: 'module',
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
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.map(item => {
      if (typeof item === 'string') return item;
      try {
        return JSON.stringify(item);
      } catch {
        return String(item);
      }
    }).join(' '));
  };
  return Promise.resolve()
    .then(fn)
    .then(result => ({ result, logs }))
    .finally(() => {
      console.log = originalLog;
    });
}

test('Phase 4.30-HF8: model response normalizer accepts markdown JSON, arrays, and objects', () => {
  const markdown = normalizeModelResponse([
    '```json',
    '{',
    '  "tool": "WRITE_FILE",',
    '  "args": {',
    '    "path": "src/math.js",',
    '    "content": "export const add = (a, b) => a + b;"',
    '  }',
    '}',
    '```'
  ].join('\n'));
  assert.equal(markdown.success, true);
  assert.equal(markdown.schema, 'tool');

  const arrayResult = normalizeModelResponse([
    {
      tool: 'WRITE_FILE',
      args: {
        path: 'src/math.test.js',
        content: 'import test from "node:test";'
      }
    }
  ]);
  assert.equal(arrayResult.success, true);
  assert.ok(Array.isArray(arrayResult.parsed));

  const objectResult = normalizeModelResponse({
    files: [
      {
        path: 'src/app.js',
        content: 'export const value = 1;'
      }
    ]
  });
  assert.equal(objectResult.success, true);
  assert.equal(objectResult.schema, 'files');
});

test('Phase 4.30-HF8: coordinator response adapter accepts legacy wrappers and array payloads', () => {
  const wrapped = normalizeCoordinatorResponse({
    result: {
      files: [
        {
          path: 'src/math.js',
          content: 'export const add = (a, b) => a + b;'
        }
      ]
    }
  });
  assert.equal(wrapped.success, true);
  assert.deepEqual(wrapped.files, [
    {
      path: 'src/math.js',
      content: 'export const add = (a, b) => a + b;'
    }
  ]);

  const arrayPayload = normalizeCoordinatorResponse([
    {
      path: 'src/math.test.js',
      content: 'import test from "node:test";'
    }
  ]);
  assert.equal(arrayPayload.success, true);
  assert.equal(arrayPayload.files[0].path, 'src/math.test.js');
});

test('Phase 4.30-HF8: generic-js-test capability allows node:test when the runner can execute it', () => {
  const availability = {
    framework: 'generic-js-test',
    kind: 'style-only',
    runnable: false,
    source: 'existing_test_files',
    reason: 'generic_style_only',
    validationCommand: 'node --test src/math.test.js',
    runner: 'node>=18',
    capability: {
      framework: 'generic-js-test',
      allowedImports: ['node:test', 'node:assert/strict'],
      allowedGlobals: ['test', 'describe', 'it', 'before', 'after', 'assert'],
      runner: 'node>=18',
      runnable: true,
      validationCommand: 'node --test src/math.test.js'
    }
  };

  const result = validateFramework(
    [
      'import test from "node:test";',
      'import assert from "node:assert/strict";',
      '',
      'test("math", () => {',
      '  assert.equal(1 + 1, 2);',
      '});'
    ].join('\n'),
    'generic-js-test',
    availability
  );

  assert.equal(result.success, true);
});

test('Phase 4.30-HF8: delta retry accepts array payloads and markdown JSON', () => {
  const arrayRetry = parseDeltaRetryResponse([
    {
      path: 'src/math.js',
      operation: 'replace_content',
      content: 'export const add = (a, b) => a + b;'
    }
  ], ['src/math.js']);
  assert.equal(arrayRetry.hasPatches, true);
  assert.equal(arrayRetry.patchCount, 1);

  const markdownRetry = parseDeltaRetryResponse([
    '```json',
    '{',
    '  "files": [',
    '    {',
    '      "path": "src/math.test.js",',
    '      "operation": "replace_file",',
    '      "content": "import test from \\"node:test\\";"',
    '    }',
    '  ]',
    '}',
    '```'
  ].join('\n'), ['src/math.test.js']);
  assert.equal(markdownRetry.hasPatches, true);
});

test('Phase 4.30-HF8: commit happens before post-commit validation', async () => {
  const root = await createGitWorkspace();
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.map(item => {
      if (typeof item === 'string') return item;
      try {
        return JSON.stringify(item);
      } catch {
        return String(item);
      }
    }).join(' '));
  };

  try {
    const result = await runAgentLoop({
      messages: [{
        role: 'user',
        content: 'Create src/math.js and src/math.test.js. Use node:test. Run validation.'
      }],
      workspaceRoot: root,
      maxSteps: 12,
      generateResponse: async ({ messages }) => {
        const promptText = messages.map(message => String(message?.content || '')).join('\n');
        if (promptText.includes('WRITE COORDINATOR MODE.')) {
          return JSON.stringify({
            files: [
              {
                path: 'src/math.js',
                content: 'export function add(a, b) { return a + b; }'
              },
              {
                path: 'src/math.test.js',
                content: [
                  'import test from "node:test";',
                  'import assert from "node:assert/strict";',
                  'import { add } from "./math.js";',
                  '',
                  'test("add", () => {',
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

    assert.equal(result.success, true);
    const committedIndex = logs.findIndex(line => line.includes('[CONTENT_COMMITTED]'));
    const validationIndex = logs.findIndex(line => line.includes('[POST_COMMIT_VALIDATION]'));
    assert.ok(committedIndex >= 0, 'expected CONTENT_COMMITTED log');
    assert.ok(validationIndex >= 0, 'expected POST_COMMIT_VALIDATION log');
    assert.ok(committedIndex < validationIndex, 'commit must occur before post-commit validation');
  } finally {
    console.log = originalLog;
    await fs.rm(root, { recursive: true, force: true });
  }
});
