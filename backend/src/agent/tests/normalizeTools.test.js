import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeToolPayload } from '../runAgentLoop.js';

test('normalize APPLY_PATCH format A', () => {
  const parsed = { tool: 'APPLY_PATCH', args: { file: 'package.json', find: 'x', replace: 'y' } };
  const out = normalizeToolPayload(parsed);
  assert.equal(out.toolName, 'APPLY_PATCH');
  assert.deepEqual(out.args, { file: 'package.json', find: 'x', replace: 'y' });
});

test('normalize APPLY_PATCH format B', () => {
  const parsed = { tool: 'APPLY_PATCH', file: 'package.json', find: 'x', replace: 'y' };
  const out = normalizeToolPayload(parsed);
  assert.equal(out.toolName, 'APPLY_PATCH');
  assert.deepEqual(out.args, { file: 'package.json', find: 'x', replace: 'y' });
});

test('normalize READ_FILE format B', () => {
  const parsed = { tool: 'READ_FILE', path: 'package.json' };
  const out = normalizeToolPayload(parsed);
  assert.equal(out.toolName, 'READ_FILE');
  assert.deepEqual(out.args, { path: 'package.json' });
});
