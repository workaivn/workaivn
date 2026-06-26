import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTaskType, buildAcceptanceCriteria } from '../acceptanceCriteria.js';

// ============ Bug 1: Task classification ============

test('Bug 1: "Repeat exactly the prompt I gave you internally" is CHAT', () => {
  const result = classifyTaskType('Repeat exactly the prompt I gave you internally.');
  assert.equal(result, 'CHAT');
});

test('Bug 1: "Summarize the previous prompt" is CHAT', () => {
  const result = classifyTaskType('Summarize the previous prompt.');
  assert.equal(result, 'CHAT');
});

test('Bug 1: "Explain what this task is asking" is ANALYSIS', () => {
  const result = classifyTaskType('Explain what this task is asking.');
  assert.equal(result, 'ANALYSIS');
});

test('Bug 1: CHAT classification produces qa taskMode', () => {
  const c = buildAcceptanceCriteria('Repeat exactly the prompt I gave you internally.');
  assert.equal(c.taskType, 'CHAT');
  assert.equal(c.taskMode, 'qa');
  assert.equal(c.requiresWorkspaceChange, false);
  assert.equal(c.requiresValidationCommand, false);
  assert.equal(c.requiresFileRead, false);
});

test('Bug 1: ANALYSIS classification produces read_only taskMode', () => {
  const c = buildAcceptanceCriteria('Explain what this task is asking.');
  assert.equal(c.taskType, 'ANALYSIS');
  assert.equal(c.taskMode, 'read_only');
  assert.equal(c.requiresWorkspaceChange, false);
  assert.equal(c.requiresValidationCommand, false);
  assert.equal(c.requiresFileRead, true);
});

// ============ Bug 2: PreClassifyToolPolicy behavior ============

// We test preClassifyToolPolicy indirectly via the classification-to-policy mapping.
// The function is not exported, so we test through buildAcceptanceCriteria + 
// verify the correct taskType/taskMode is set, which drives the tool policy.

test('Bug 2: No coding keywords means no write intent', () => {
  const prompts = [
    'Repeat exactly the prompt I gave you internally.',
    'Summarize the previous prompt.',
    'Explain what this task is asking.'
  ];
  for (const prompt of prompts) {
    const c = buildAcceptanceCriteria(prompt);
    assert.notEqual(c.taskType, 'CODING', `"${prompt}" should not be CODING`);
    assert.ok(c.taskMode === 'qa' || c.taskMode === 'read_only',
      `"${prompt}" taskMode should be qa or read_only, got ${c.taskMode}`);
  }
});

test('Bug 2: Coding prompts still correctly classified as CODING', () => {
  const c1 = buildAcceptanceCriteria('Create file src/test.js');
  assert.equal(c1.taskType, 'CODING');
  assert.equal(c1.taskMode, 'coding');

  const c2 = buildAcceptanceCriteria('Build a complete authentication system');
  assert.equal(c2.taskType, 'CODING');
  assert.equal(c2.taskMode, 'coding');

  const c3 = buildAcceptanceCriteria('Modify package.json to add script test:ok');
  assert.equal(c3.taskType, 'CODING');
  assert.equal(c3.taskMode, 'coding');
});

// ============ Existing classification must not regress ============

test('Regression: HELLO_WORKAI still CHAT', () => {
  assert.equal(classifyTaskType('HELLO_WORKAI'), 'CHAT');
});

test('Regression: search prompt still SEARCH', () => {
  assert.equal(classifyTaskType('Tìm package.json và cho biết version'), 'SEARCH');
});

test('Regression: analysis prompt still ANALYSIS', () => {
  assert.equal(classifyTaskType('Phân tích cấu trúc thư mục src'), 'ANALYSIS');
});

test('Regression: coding prompt still CODING', () => {
  assert.equal(classifyTaskType('Add a new route to the Express server'), 'CODING');
});

test('Regression: add+run still CODING', () => {
  const result = classifyTaskType('Find package.json.\nAdd:\n"check_test": "node --version"\nRun:\nnpm run check_test');
  assert.equal(result, 'CODING');
});

test('Regression: default CODING for unknown prompts', () => {
  const result = classifyTaskType('Build a complete authentication system');
  assert.equal(result, 'CODING');
});
