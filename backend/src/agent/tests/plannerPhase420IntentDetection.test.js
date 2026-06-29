import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from '../planner/planBuilder.js';

function checkPlan(plan, expectedTools, expectedFiles) {
  const tools = plan.tasks.map(t => ({ tool: t.tool, file: t.toolArgs?.path || t.toolArgs?.file || null, deps: t.dependencies }));
  assert.equal(tools.length, expectedTools.length, `Expected ${expectedTools.length} tasks, got ${tools.length}: ${JSON.stringify(tools)}`);
  for (let i = 0; i < expectedTools.length; i++) {
    assert.equal(tools[i].tool, expectedTools[i], `Task ${i}: expected tool ${expectedTools[i]}, got ${tools[i].tool}`);
    if (expectedFiles && expectedFiles[i]) {
      const actual = tools[i].file ? tools[i].file.replace(/\\/g, '/') : null;
      assert.equal(actual, expectedFiles[i], `Task ${i}: expected file ${expectedFiles[i]}, got ${tools[i].file}`);
    }
  }
  return tools;
}

test('HF3 Test 1: Append line to file produces READ_FILE → WRITE_FILE → RUN_TERMINAL', () => {
  const prompt = [
    'Append exactly one line to src/workaivn-test.js:',
    '',
    'console.log("SECOND_LINE");',
    '',
    'Then run:',
    'node src/workaivn-test.js'
  ].join('\n');
  const plan = buildPlan(prompt, {
    taskType: 'CODING',
    requestedFiles: ['src/workaivn-test.js'],
    requiredCommands: ['node src/workaivn-test.js']
  });
  const tools = checkPlan(plan, ['READ_FILE', 'WRITE_FILE', 'RUN_TERMINAL'], ['src/workaivn-test.js', 'src/workaivn-test.js', null]);
  // WRITE_FILE must depend on READ_FILE
  const writeTask = plan.tasks.find(t => t.tool === 'WRITE_FILE');
  const readTask = plan.tasks.find(t => t.tool === 'READ_FILE');
  assert.ok(writeTask.dependencies.includes(readTask.id), 'WRITE_FILE must depend on READ_FILE');
  // RUN_TERMINAL must depend on WRITE_FILE
  const runTask = plan.tasks.find(t => t.tool === 'RUN_TERMINAL');
  assert.ok(runTask.dependencies.includes(writeTask.id), 'RUN_TERMINAL must depend on WRITE_FILE');
  // No tool=null tasks
  assert.equal(plan.tasks.some(t => t.tool === null), false, 'Must not have tool=null generic tasks');
});

test('HF3 Test 2: Replace line in file produces READ_FILE → WRITE_FILE → RUN_TERMINAL', () => {
  const prompt = [
    'Replace one line in src/workaivn-test.js with:',
    '',
    'console.log("REPLACED_LINE");',
    '',
    'Then run:',
    'node src/workaivn-test.js'
  ].join('\n');
  const plan = buildPlan(prompt, {
    taskType: 'CODING',
    requestedFiles: ['src/workaivn-test.js'],
    requiredCommands: ['node src/workaivn-test.js']
  });
  const tools = checkPlan(plan, ['READ_FILE', 'WRITE_FILE', 'RUN_TERMINAL'], ['src/workaivn-test.js', 'src/workaivn-test.js', null]);
  const writeTask = plan.tasks.find(t => t.tool === 'WRITE_FILE');
  const readTask = plan.tasks.find(t => t.tool === 'READ_FILE');
  assert.ok(writeTask.dependencies.includes(readTask.id), 'WRITE_FILE must depend on READ_FILE');
  const runTask = plan.tasks.find(t => t.tool === 'RUN_TERMINAL');
  assert.ok(runTask.dependencies.includes(writeTask.id), 'RUN_TERMINAL must depend on WRITE_FILE');
  assert.equal(plan.tasks.some(t => t.tool === null), false, 'Must not have tool=null generic tasks');
});

test('HF3 Test 3: Update file produces READ_FILE → WRITE_FILE → RUN_TERMINAL', () => {
  const prompt = [
    'Update src/workaivn-test.js so it logs:',
    '',
    'console.log("UPDATED_LINE");',
    '',
    'Then run:',
    'node src/workaivn-test.js'
  ].join('\n');
  const plan = buildPlan(prompt, {
    taskType: 'CODING',
    requestedFiles: ['src/workaivn-test.js'],
    requiredCommands: ['node src/workaivn-test.js']
  });
  const tools = checkPlan(plan, ['READ_FILE', 'WRITE_FILE', 'RUN_TERMINAL'], ['src/workaivn-test.js', 'src/workaivn-test.js', null]);
  const writeTask = plan.tasks.find(t => t.tool === 'WRITE_FILE');
  const readTask = plan.tasks.find(t => t.tool === 'READ_FILE');
  assert.ok(writeTask.dependencies.includes(readTask.id), 'WRITE_FILE must depend on READ_FILE');
  const runTask = plan.tasks.find(t => t.tool === 'RUN_TERMINAL');
  assert.ok(runTask.dependencies.includes(writeTask.id), 'RUN_TERMINAL must depend on WRITE_FILE');
  assert.equal(plan.tasks.some(t => t.tool === null), false, 'Must not have tool=null generic tasks');
});

test('HF3 Test 4: Read-only prompt produces only READ_FILE', () => {
  const plan = buildPlan('Read package.json and show project name.', {
    taskType: 'ANALYSIS',
    requestedFiles: ['package.json'],
    requiredCommands: []
  });
  checkPlan(plan, ['READ_FILE'], ['package.json']);
  assert.equal(plan.tasks.some(t => t.tool === 'WRITE_FILE'), false, 'Read-only must not produce WRITE_FILE');
  assert.equal(plan.tasks.some(t => t.tool === null), false, 'Must not have tool=null generic tasks');
});

test('HF3 Test 5: Add line to file produces READ_FILE → WRITE_FILE → RUN_TERMINAL', () => {
  const prompt = [
    'Add one line to src/workaivn-test.js:',
    '',
    'console.log("ADDED_LINE");',
    '',
    'Then run:',
    'node src/workaivn-test.js'
  ].join('\n');
  const plan = buildPlan(prompt, {
    taskType: 'CODING',
    requestedFiles: ['src/workaivn-test.js'],
    requiredCommands: ['node src/workaivn-test.js']
  });
  checkPlan(plan, ['READ_FILE', 'WRITE_FILE', 'RUN_TERMINAL'], ['src/workaivn-test.js', 'src/workaivn-test.js', null]);
  assert.equal(plan.tasks.some(t => t.tool === null), false, 'Must not have tool=null generic tasks');
});

test('HF3 Test 6: Prepend line to file produces READ_FILE → WRITE_FILE → RUN_TERMINAL', () => {
  const prompt = [
    'Prepend one line to src/workaivn-test.js:',
    '',
    'console.log("PREPENDED_LINE");',
    '',
    'Then run:',
    'node src/workaivn-test.js'
  ].join('\n');
  const plan = buildPlan(prompt, {
    taskType: 'CODING',
    requestedFiles: ['src/workaivn-test.js'],
    requiredCommands: ['node src/workaivn-test.js']
  });
  checkPlan(plan, ['READ_FILE', 'WRITE_FILE', 'RUN_TERMINAL'], ['src/workaivn-test.js', 'src/workaivn-test.js', null]);
  assert.equal(plan.tasks.some(t => t.tool === null), false, 'Must not have tool=null generic tasks');
});

test('HF3 Test 7: Insert line in file produces READ_FILE → WRITE_FILE → RUN_TERMINAL', () => {
  const prompt = [
    'Insert one line in src/workaivn-test.js:',
    '',
    'console.log("INSERTED_LINE");',
    '',
    'Then run:',
    'node src/workaivn-test.js'
  ].join('\n');
  const plan = buildPlan(prompt, {
    taskType: 'CODING',
    requestedFiles: ['src/workaivn-test.js'],
    requiredCommands: ['node src/workaivn-test.js']
  });
  checkPlan(plan, ['READ_FILE', 'WRITE_FILE', 'RUN_TERMINAL'], ['src/workaivn-test.js', 'src/workaivn-test.js', null]);
  assert.equal(plan.tasks.some(t => t.tool === null), false, 'Must not have tool=null generic tasks');
});

test('HF3 Test 8: Edit file produces READ_FILE → WRITE_FILE → RUN_TERMINAL', () => {
  const prompt = [
    'Edit src/workaivn-test.js to add a console.log statement.',
    '',
    'Then run:',
    'node src/workaivn-test.js'
  ].join('\n');
  const plan = buildPlan(prompt, {
    taskType: 'CODING',
    requestedFiles: ['src/workaivn-test.js'],
    requiredCommands: ['node src/workaivn-test.js']
  });
  checkPlan(plan, ['READ_FILE', 'WRITE_FILE', 'RUN_TERMINAL'], ['src/workaivn-test.js', 'src/workaivn-test.js', null]);
  assert.equal(plan.tasks.some(t => t.tool === null), false, 'Must not have tool=null generic tasks');
});

test('HF3 Test 9: Modify file produces READ_FILE → WRITE_FILE → RUN_TERMINAL', () => {
  const prompt = [
    'Modify src/workaivn-test.js so it logs MODIFIED_LINE.',
    '',
    'Then run:',
    'node src/workaivn-test.js'
  ].join('\n');
  const plan = buildPlan(prompt, {
    taskType: 'CODING',
    requestedFiles: ['src/workaivn-test.js'],
    requiredCommands: ['node src/workaivn-test.js']
  });
  checkPlan(plan, ['READ_FILE', 'WRITE_FILE', 'RUN_TERMINAL'], ['src/workaivn-test.js', 'src/workaivn-test.js', null]);
  assert.equal(plan.tasks.some(t => t.tool === null), false, 'Must not have tool=null generic tasks');
});

test('HF3 Test 10: Rename variable prompt still produces READ → WRITE → RUN', () => {
  const prompt = [
    'Rename variable foo to bar in src/workaivn-test.js.',
    '',
    'Then run:',
    'node src/workaivn-test.js'
  ].join('\n');
  const plan = buildPlan(prompt, {
    taskType: 'CODING',
    requestedFiles: ['src/workaivn-test.js'],
    requiredCommands: ['node src/workaivn-test.js']
  });
  checkPlan(plan, ['READ_FILE', 'WRITE_FILE', 'RUN_TERMINAL'], ['src/workaivn-test.js', 'src/workaivn-test.js', null]);
  assert.equal(plan.tasks.some(t => t.tool === null), false, 'Must not have tool=null generic tasks');
});
