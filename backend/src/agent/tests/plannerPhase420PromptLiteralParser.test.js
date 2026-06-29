import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePromptFileLiterals,
  validatePromptLiteralContent
} from '../planner/promptLiteralParser.js';

test('Phase 4.20 HF6 Test 1: two natural language file blocks map to the right files', async () => {
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

  const parsed = parsePromptFileLiterals(prompt);
  assert.equal(parsed.files['src/bug.js'].content, 'export function add(a,b){\nreturn a-b;\n}');
  assert.equal(parsed.files['src/bug.test.js'].content, [
    'import test from "node:test";',
    'import assert from "node:assert/strict";',
    'import { add } from "./bug.js";',
    '',
    'test("add()", () => {',
    'assert.equal(add(2,3),5);',
    '});'
  ].join('\n'));
  assert.deepEqual(parsed.commands, ['node --test src/bug.test.js']);
  assert.ok(!parsed.files['src/bug.js'].content.includes('Create src/bug.test.js'));
  assert.ok(!parsed.files['src/bug.test.js'].content.includes('Then run exactly'));
});

test('Phase 4.20 HF6 Test 2: fenced code blocks strip fences and stay scoped to each file', async () => {
  const prompt = [
    'Create src/bug.js with:',
    '',
    '```javascript',
    'export function add(a,b){',
    '    return a-b;',
    '}',
    '```',
    '',
    'Create src/bug.test.js with exactly:',
    '',
    '```javascript',
    'import test from "node:test";',
    'import assert from "node:assert/strict";',
    'import { add } from "./bug.js";',
    '',
    'test("add()", () => {',
    '    assert.equal(add(2,3),5);',
    '});',
    '```'
  ].join('\n');

  const parsed = parsePromptFileLiterals(prompt);
  assert.equal(parsed.files['src/bug.js'].content, 'export function add(a,b){\n    return a-b;\n}');
  assert.ok(!parsed.files['src/bug.js'].content.includes('```'));
  assert.equal(parsed.files['src/bug.test.js'].content, [
    'import test from "node:test";',
    'import assert from "node:assert/strict";',
    'import { add } from "./bug.js";',
    '',
    'test("add()", () => {',
    '    assert.equal(add(2,3),5);',
    '});'
  ].join('\n'));
});

test('Phase 4.20 HF6 Test 3: tool-name prompt without content does not invent directive text', async () => {
  const prompt = [
    'WRITE_FILE src/bug.js',
    'WRITE_FILE src/bug.test.js',
    'RUN_TERMINAL node --test src/bug.test.js'
  ].join('\n');

  const parsed = parsePromptFileLiterals(prompt);
  assert.equal(parsed.files['src/bug.js'].content, undefined);
  assert.equal(parsed.files['src/bug.test.js'].content, undefined);
  assert.equal(parsed.commands[0], 'node --test src/bug.test.js');
});

test('Phase 4.20 HF6 Test 4: tool-name prompt with fenced content maps each fence correctly', async () => {
  const prompt = [
    'WRITE_FILE src/bug.js',
    '',
    '```js',
    'export function add(a,b){',
    '    return a-b;',
    '}',
    '```',
    '',
    'WRITE_FILE src/bug.test.js',
    '',
    '```js',
    'import test from "node:test";',
    'import assert from "node:assert/strict";',
    'import { add } from "./bug.js";',
    '```',
    '',
    'RUN_TERMINAL node --test src/bug.test.js'
  ].join('\n');

  const parsed = parsePromptFileLiterals(prompt);
  assert.equal(parsed.files['src/bug.js'].content, 'export function add(a,b){\n    return a-b;\n}');
  assert.equal(parsed.files['src/bug.test.js'].content, [
    'import test from "node:test";',
    'import assert from "node:assert/strict";',
    'import { add } from "./bug.js";'
  ].join('\n'));
  assert.deepEqual(parsed.commands, ['node --test src/bug.test.js']);
});

test('Phase 4.20 HF6 Test 5: append blocks capture append content and the follow-up command', async () => {
  const prompt = [
    'Append exactly one line to src/workaivn-test.js:',
    '',
    'console.log("SECOND_LINE");',
    '',
    'Then run:',
    '',
    'node src/workaivn-test.js'
  ].join('\n');

  const parsed = parsePromptFileLiterals(prompt);
  assert.equal(parsed.files['src/workaivn-test.js'].content, 'console.log("SECOND_LINE");');
  assert.equal(parsed.files['src/workaivn-test.js'].operation, 'append');
  assert.deepEqual(parsed.commands, ['node src/workaivn-test.js']);
});

test('Phase 4.20 HF6 Test 6: boundary lines stop literal capture before rules text', async () => {
  const prompt = [
    'Create src/a.js with:',
    '',
    'console.log("A");',
    '',
    'Rules:',
    '',
    'Do not modify package.json.'
  ].join('\n');

  const parsed = parsePromptFileLiterals(prompt);
  assert.equal(parsed.files['src/a.js'].content, 'console.log("A");');
  assert.ok(!parsed.files['src/a.js'].content.includes('Rules'));
});

test('Phase 4.20 HF6 Test 7: directive-looking content is rejected by validation', async () => {
  const rejected = validatePromptLiteralContent({
    path: 'src/bug.js',
    content: [
      'WRITE_FILE src/bug.test.js',
      'RUN_TERMINAL node --test src/bug.test.js'
    ].join('\n'),
    prompt: 'WRITE_FILE src/bug.js',
    operation: 'write'
  });

  assert.equal(rejected.success, false);
  assert.match(rejected.error, /directive/i);
});
