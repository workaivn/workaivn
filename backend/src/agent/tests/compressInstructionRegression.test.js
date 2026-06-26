import test from 'node:test';
import assert from 'node:assert/strict';
import { compressLocalInstruction } from '../runAgentLoop.js';

test('compressLocalInstruction: returns original for prompts < 2000 chars', () => {
  const short = 'Read package.json. Check version.';
  const result = compressLocalInstruction(short);
  assert.equal(result, short);
});

test('compressLocalInstruction: preserves task intent for long prompts', () => {
  const prompt = `
PHASE 4.5 TEST A — VERIFY RETRY ENGINE

Steps:
1. Run a READ_FILE on missing-file-xyz.json

   Expected:
   Tool fails (READ_FILE timeout) -> retry -> success

   Actual:
   No retry after first failure

   (check retry hook...)
   (NO_RETRY_TEST_HOOK_FOUND)

2. The system should have retried but it did not.
`.repeat(8); // Make it > 2000 chars

  assert.ok(prompt.length > 2000, 'test prompt must be > 2000 chars');
  const result = compressLocalInstruction(prompt);

  // Must preserve the original task structure
  assert.ok(result.includes('PHASE 4.5 TEST A'), 'must preserve phase label');
  assert.ok(result.includes('VERIFY RETRY ENGINE'), 'must preserve intent');
  assert.ok(result.includes('READ_FILE on missing-file-xyz.json'), 'must preserve tool');
  assert.ok(result.includes('NO_RETRY_TEST_HOOK_FOUND'), 'must preserve error message');
  assert.ok(result.includes('retry -> success'), 'must preserve expected output');
  assert.ok(result.includes('No retry after first failure'), 'must preserve actual result');

  // Must NOT contain fabricated actions
  assert.ok(!result.includes('Open package.json'), 'must not inject Open package.json');
  assert.ok(!result.includes('Rename script'), 'must not inject rename');
  assert.ok(!result.includes('Add script'), 'must not inject add');
});

test('compressLocalInstruction: preserves nested quotes', () => {
  const base = `
TEST: Validate nested quote safety

Run: node -e "console.log('retry-test')"

Expected:
Output contains "retry-test"

Actual:
Output empty

Also check: node -e "const x = 1; console.log(x)"
`;
  const prompt = base.repeat(15); // Make it > 2000 chars and contain many double-quotes (> 4)

  const doubleQuoteCount = (prompt.match(/"/g) || []).length;
  assert.ok(doubleQuoteCount > 4, 'test prompt must have > 4 double quotes');
  assert.ok(prompt.length > 2000, 'test prompt must be > 2000 chars');

  const result = compressLocalInstruction(prompt);

  assert.ok(result.includes('nested quote safety'), 'must preserve content');
  assert.ok(result.includes('node -e'), 'must preserve command with nested quotes');
  assert.ok(result.includes('console.log'), 'must preserve console.log');
  assert.equal(result, prompt.trim(), 'must return trimmed original unchanged when doubleQuoteCount > 4');
});

test('compressLocalInstruction: collapses excess whitespace for long prompts only', () => {
  const text = 'line1\n\n\n\n\nline2\n\n\n\n\nline3';
  // Not > 2000 chars
  assert.ok(text.length < 2000);
  const result = compressLocalInstruction(text);
  assert.equal(result, text, 'must return unchanged for < 2000 chars');
});

test('compressLocalInstruction: collapsible long prompt only affects whitespace', () => {
  // Build a > 2000 char prompt that only has excessive blank lines (safe to collapse)
  let text = 'Start here.\n\n\n\n\nMiddle section with content.\n\n\n\n\nEnd here.';
  while (text.length < 2500) {
    text += '\n\n' + 'More detail line ' + text.length;
  }
  assert.ok(text.length > 2000);

  const result = compressLocalInstruction(text);
  assert.ok(result.includes('Start here.'), 'must preserve content start');
  assert.ok(result.includes('End here.'), 'must preserve content end');
  assert.ok(result.includes('Middle section'), 'must preserve middle content');
  assert.ok(result.includes('More detail line'), 'must preserve repeated lines');

  // Should collapse \n{3,} -> \n\n but not change \n\n
  assert.ok(!result.includes('\n\n\n'), 'must not have triple blank lines');
  assert.ok(result.length < text.length, 'must be shorter (whitespace collapsed)');
  assert.equal(result.split('\n').filter(l => l.trim()).length,
    text.split('\n').filter(l => l.trim()).length,
    'must preserve all non-empty lines');
});

test('compressLocalInstruction: never invents commands', () => {
  const base = `
REGRESSION: Compress Local Instruction

This prompt contains the word "add" and a pattern "something: to"
and also "name: value" which should not trigger semantic replacement.

Never inject fabricated instructions like rename or add script.

Steps:
- Navigate to status
- Check status
- Something test to verify
`;
  const prompt = base.repeat(10); // > 2000 chars

  assert.ok(prompt.length > 2000);
  const result = compressLocalInstruction(prompt);

  assert.ok(!result.includes('Open package.json'), 'must not inject Open package.json');
  assert.ok(!result.includes('Rename script'), 'must not inject rename');
  assert.ok(!result.includes('Add script'), 'must not inject add');
  assert.ok(result.includes('REGRESSION'), 'must preserve original content');
  assert.ok(result.includes('Something test to verify'), 'must preserve line with "to"');
});

test('compressLocalInstruction: handles empty string', () => {
  assert.equal(compressLocalInstruction(''), '');
  assert.equal(compressLocalInstruction(null), '');
  assert.equal(compressLocalInstruction(undefined), '');
});
