import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCoordinatorPatch, parseDeltaRetryResponse } from '../writeCoordinator/validationDelta.js';

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

test('Delta retry normalizes a single patch object', () => {
  const { result, logs } = captureLogs(() => parseDeltaRetryResponse({
    path: 'src/app.js',
    operation: 'replace_imports',
    content: 'import fs from "node:fs";'
  }, ['src/app.js']));

  assert.equal(result.hasPatches, true);
  assert.equal(result.patchCount, 1);
  assert.deepEqual(result.patches, [{
    path: 'src/app.js',
    operation: 'replace_imports',
    content: 'import fs from "node:fs";'
  }]);
  assert.ok(logs.some(line => line.includes('DELTA_RETRY_SCHEMA_DETECTED')));
  assert.ok(logs.some(line => line.includes('DELTA_RETRY_PATCH_NORMALIZED')));
});

test('Delta retry normalizes a patches array', () => {
  const { result } = captureLogs(() => parseDeltaRetryResponse({
    patches: [
      {
        path: 'src/app.js',
        operation: 'append',
        content: '\nconsole.log("a");'
      },
      {
        path: 'src/test.js',
        operation: 'prepend',
        content: 'import test from "node:test";'
      }
    ]
  }, ['src/app.js', 'src/test.js']));

  assert.equal(result.hasPatches, true);
  assert.equal(result.patchCount, 2);
  assert.deepEqual(result.patches.map(item => item.operation), ['append', 'prepend']);
});

test('Delta retry normalizes a files array', () => {
  const { result } = captureLogs(() => parseDeltaRetryResponse({
    files: [
      {
        file: 'src/server.js',
        content: 'export default function server() { return null; }'
      }
    ]
  }, ['src/server.js']));

  assert.equal(result.hasPatches, true);
  assert.equal(result.patchCount, 1);
  assert.equal(result.patches[0].path, 'src/server.js');
  assert.equal(result.patches[0].operation, 'replace_file');
});

test('Delta retry rejects invalid objects after normalization', () => {
  const { result, logs } = captureLogs(() => parseDeltaRetryResponse({
    path: 'src/app.js',
    operation: 'unknown',
    content: 'x'
  }, ['src/app.js']));

  assert.equal(result.hasPatches, false);
  assert.equal(result.patchCount, 0);
  assert.ok(Array.isArray(result.errors));
  assert.ok(result.errors.length > 0);
  assert.ok(logs.some(line => line.includes('DELTA_RETRY_PATCH_REJECTED')));
});

test('Delta retry parses markdown-wrapped JSON', () => {
  const raw = [
    '```json',
    '{',
    '  "path": "src/app.js",',
    '  "operation": "replace_content",',
    '  "content": "export default function App() { return null; }"',
    '}',
    '```'
  ].join('\n');

  const { result } = captureLogs(() => parseDeltaRetryResponse(raw, ['src/app.js']));

  assert.equal(result.hasPatches, true);
  assert.equal(result.patchCount, 1);
  assert.equal(result.patches[0].operation, 'replace_content');
  assert.equal(result.patches[0].path, 'src/app.js');
});

test('Delta retry merge supports normalized replace_content and prepend operations', () => {
  const merged = mergeCoordinatorPatch([
    'import a from "a";',
    '',
    'export function run() {',
    '  return a();',
    '}'
  ].join('\n'), [
    {
      path: 'src/app.js',
      operation: 'prepend',
      content: 'import test from "node:test";'
    },
    {
      path: 'src/app.js',
      operation: 'replace_content',
      content: 'export function run() { return true; }'
    }
  ]);

  assert.match(merged, /export function run/);
  assert.equal(merged.startsWith('import test from "node:test";'), false);
});

