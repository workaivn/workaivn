import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcceptanceCriteria } from '../acceptanceCriteria.js';

test('taskMode coding for create file', () => {
  const c = buildAcceptanceCriteria('Create file src/workai-local-test.js with console.log("OK")');
  assert.equal(c.taskMode, 'coding');
});

test('taskMode coding for modify file', () => {
  const c = buildAcceptanceCriteria('Modify package.json to add script temp:test = "echo ok"');
  assert.equal(c.taskMode, 'coding');
});

test('taskMode coding for delete file', () => {
  const c = buildAcceptanceCriteria('Delete src/obsolete.js');
  assert.equal(c.taskMode, 'coding');
});

test('taskMode coding for run command', () => {
  const c = buildAcceptanceCriteria('Run: node src/workai-local-test.js');
  assert.equal(c.taskMode, 'coding');
});
