import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExpectedToolCorrectiveInstruction, isPlannerToolCompatible } from '../runAgentLoop.js';

test('Planner hard tool lock allows only the expected planner tool set', () => {
  assert.equal(isPlannerToolCompatible('READ_FILE', 'READ_FILE'), true);
  assert.equal(isPlannerToolCompatible('WRITE_FILE', 'WRITE_FILE'), true);
  assert.equal(isPlannerToolCompatible('WRITE_FILE', 'APPLY_PATCH'), true);
  assert.equal(isPlannerToolCompatible('WRITE_FILE', 'LIST_FILES'), false);
  assert.equal(isPlannerToolCompatible('WRITE_FILE', 'SEARCH_CODE'), false);
  assert.equal(isPlannerToolCompatible('WRITE_FILE', 'SEARCH_SYMBOL'), false);
  assert.equal(isPlannerToolCompatible('WRITE_FILE', 'RUN_TERMINAL'), false);
  assert.equal(isPlannerToolCompatible('RUN_TERMINAL', 'RUN_TERMINAL'), true);
  assert.equal(isPlannerToolCompatible('RUN_TERMINAL', 'LIST_FILES'), false);
});

test('Planner hard tool lock corrective instruction names the expected tool', () => {
  const text = buildExpectedToolCorrectiveInstruction(
    'WRITE_FILE',
    { path: 'src/example.js' },
    { path: 'src/example.js' }
  );

  assert.match(text, /Expected tool for this planner task:/);
  assert.match(text, /WRITE_FILE/);
  assert.match(text, /Return only WRITE_FILE or APPLY_PATCH/);
  assert.match(text, /src\/example\.js/);
});
