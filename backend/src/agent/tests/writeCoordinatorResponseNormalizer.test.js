import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCoordinatorResponse } from '../writeCoordinator/responseNormalizer.js';

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

test('WRITE response normalizer accepts content arrays', () => {
  const { result, logs } = captureLogs(() => normalizeCoordinatorResponse({
    files: [
      {
        path: 'src/app.js',
        content: ['export const value = 1;', 'export const other = 2;']
      }
    ]
  }));

  assert.equal(result.success, true);
  assert.equal(result.protocolError, false);
  assert.deepEqual(result.files, [
    {
      path: 'src/app.js',
      content: 'export const value = 1;\nexport const other = 2;'
    }
  ]);
  assert.equal(result.originalSchema, 'content');
  assert.ok(logs.some(line => line.includes('[WRITE_RESPONSE_NORMALIZED]')));
});

test('WRITE response normalizer accepts text schema', () => {
  const { result } = captureLogs(() => normalizeCoordinatorResponse({
    files: [
      {
        path: 'src/app.js',
        text: 'console.log("text");'
      }
    ]
  }));

  assert.equal(result.success, true);
  assert.equal(result.originalSchema, 'text');
  assert.deepEqual(result.files, [
    {
      path: 'src/app.js',
      content: 'console.log("text");'
    }
  ]);
});

test('WRITE response normalizer accepts code schema', () => {
  const { result } = captureLogs(() => normalizeCoordinatorResponse({
    files: [
      {
        path: 'src/app.js',
        code: 'const answer = 42;'
      }
    ]
  }));

  assert.equal(result.success, true);
  assert.equal(result.originalSchema, 'code');
  assert.deepEqual(result.files[0], {
    path: 'src/app.js',
    content: 'const answer = 42;'
  });
});

test('WRITE response normalizer accepts source schema', () => {
  const { result } = captureLogs(() => normalizeCoordinatorResponse({
    files: [
      {
        path: 'src/app.js',
        source: 'export default function App() {}'
      }
    ]
  }));

  assert.equal(result.success, true);
  assert.equal(result.originalSchema, 'source');
  assert.deepEqual(result.files[0], {
    path: 'src/app.js',
    content: 'export default function App() {}'
  });
});

test('WRITE response normalizer converts file to path', () => {
  const { result } = captureLogs(() => normalizeCoordinatorResponse({
    files: [
      {
        file: 'src/file-alias.js',
        content: 'export const fileAlias = true;'
      }
    ]
  }));

  assert.equal(result.success, true);
  assert.deepEqual(result.files[0], {
    path: 'src/file-alias.js',
    content: 'export const fileAlias = true;'
  });
});

test('WRITE response normalizer converts target to path', () => {
  const { result } = captureLogs(() => normalizeCoordinatorResponse({
    files: [
      {
        target: 'src/target-alias.js',
        content: 'export const targetAlias = true;'
      }
    ]
  }));

  assert.equal(result.success, true);
  assert.deepEqual(result.files[0], {
    path: 'src/target-alias.js',
    content: 'export const targetAlias = true;'
  });
});

for (const [schemaKey, fieldName] of [
  ['changes', 'changes'],
  ['patches', 'patches'],
  ['diff', 'diff'],
  ['replace', 'replace'],
  ['operations', 'operations']
]) {
  test(`WRITE response normalizer rejects patch-only schema ${schemaKey}`, () => {
    const { result, logs } = captureLogs(() => normalizeCoordinatorResponse({
      files: [
        {
          path: 'src/app.js',
          [fieldName]: fieldName === 'operations' ? [{ operation: 'replace', path: 'src/app.js' }] : fieldName
        }
      ]
    }));

    assert.equal(result.success, false);
    assert.equal(result.protocolError, true);
    assert.equal(result.reason, 'PATCH_ONLY_RESPONSE');
    assert.equal(result.originalSchema, schemaKey);
    assert.deepEqual(result.files, []);
    assert.ok(logs.some(line => line.includes('[WRITE_PROTOCOL_ERROR]')));
  });
}
