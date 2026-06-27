import test from 'node:test';
import assert from 'node:assert/strict';
import { selectExecutionStrategy, isToolAllowedByStrategy } from '../planner/strategyEngine.js';
import { extractCommands } from '../planner/planBuilder.js';

// ===================== Command Extraction Tests =====================

test('Phase 4.18: Run exactly command with arguments is extracted', () => {
  const prompt = 'Run exactly:\nnpm test -- plannerPhase417\n\nDo not modify source code. Only execute the command.';
  const commands = extractCommands(prompt);
  assert.deepEqual(commands, ['npm test -- plannerPhase417']);
});

test('Phase 4.18: Run exactly this command extracts full command', () => {
  const prompt = 'Run exactly this command: npm test -- plannerPhase417. Do not modify any source code.';
  const commands = extractCommands(prompt);
  assert.deepEqual(commands, ['npm test -- plannerPhase417']);
});

// ===================== Strategy Selection Tests =====================

test('Phase 4.18: Read-only prompt selects READ_ONLY strategy', () => {
  const result = selectExecutionStrategy({
    originalPrompt: 'Read package.json and explain the package name. Do not modify files.',
    taskType: 'CODING',
    requiredFiles: ['package.json']
  });

  assert.equal(result.strategy, 'READ_ONLY');
  assert.equal(result.constraints.allowWrites, false);
  assert.equal(result.constraints.allowTerminal, false);
  assert.ok(result.reasons.some(r => r.includes('read-only') || r.includes('do not modify')));
});

test('Phase 4.18: Read-only with explicit keywords selects READ_ONLY', () => {
  const result = selectExecutionStrategy({
    originalPrompt: 'Read package.json and show me the version',
    taskType: 'CODING'
  });

  assert.equal(result.strategy, 'READ_ONLY');
  assert.equal(result.constraints.allowWrites, false);
  assert.equal(result.constraints.allowTerminal, false);
});

test('Phase 4.18: Command-only prompt selects COMMAND_ONLY', () => {
  const result = selectExecutionStrategy({
    originalPrompt: 'Run exactly this command: npm test -- plannerPhase417. Do not modify any source code. Only execute the command.',
    taskType: 'CODING'
  });

  assert.equal(result.strategy, 'COMMAND_ONLY');
  assert.equal(result.constraints.allowWrites, false);
  assert.equal(result.constraints.allowTerminal, true);
});

test('Phase 4.18: Coding prompt selects EDIT_AND_VALIDATE', () => {
  const result = selectExecutionStrategy({
    originalPrompt: 'Create src/phase418-test.js that prints PHASE418_OK and run node src/phase418-test.js',
    taskType: 'CODING',
    requiredFiles: ['src/phase418-test.js'],
    requiredCommands: ['node src/phase418-test.js']
  });

  assert.equal(result.strategy, 'EDIT_AND_VALIDATE');
  assert.equal(result.constraints.allowWrites, true);
  assert.equal(result.constraints.allowTerminal, true);
  assert.equal(result.constraints.requireValidation, true);
});

test('Phase 4.18: Debug prompt selects INVESTIGATE_THEN_EDIT', () => {
  const result = selectExecutionStrategy({
    originalPrompt: 'Quality Gate shows NEEDS_REVISION but logs say completed success=true. Find root cause and fix.',
    taskType: 'CODING'
  });

  assert.equal(result.strategy, 'INVESTIGATE_THEN_EDIT');
  assert.equal(result.constraints.allowWrites, true);
  assert.equal(result.constraints.allowTerminal, true);
  assert.equal(result.constraints.requireValidation, true);
});

test('Phase 4.18: Debug prompt with error/stack trace selects INVESTIGATE_THEN_EDIT', () => {
  const result = selectExecutionStrategy({
    originalPrompt: 'Error in UI shows failing. What is the stack trace? Debug and fix the bug.',
    taskType: 'CODING'
  });

  assert.equal(result.strategy, 'INVESTIGATE_THEN_EDIT');
  assert.equal(result.constraints.allowWrites, true);
});

test('Phase 4.18: Loop prompt selects LOOP_SAFE_RETRY', () => {
  const result = selectExecutionStrategy({
    originalPrompt: 'Run the same missing command several times and ensure loop detector stops the fourth identical command. Do not modify source code.',
    taskType: 'CODING'
  });

  assert.equal(result.strategy, 'LOOP_SAFE_RETRY');
  assert.equal(result.constraints.allowWrites, false);
  assert.equal(result.constraints.allowTerminal, true);
  assert.ok(result.constraints.maxRepairAttempts <= 2, 'maxRepairAttempts should be <= 2');
});

test('Phase 4.18: Loop prompt with write intent allows writes', () => {
  const result = selectExecutionStrategy({
    originalPrompt: 'Run test several times and fix any issues found. Modify the code to make tests pass.',
    taskType: 'CODING'
  });

  assert.equal(result.strategy, 'LOOP_SAFE_RETRY');
  assert.equal(result.constraints.allowWrites, true);
});

// ===================== Tool Permission Tests =====================

test('Phase 4.18: READ_ONLY strategy blocks write tools', () => {
  assert.equal(isToolAllowedByStrategy('READ_ONLY', 'WRITE_FILE', { allowWrites: false, allowTerminal: false }), false);
  assert.equal(isToolAllowedByStrategy('READ_ONLY', 'APPLY_PATCH', { allowWrites: false }), false);
  assert.equal(isToolAllowedByStrategy('READ_ONLY', 'CREATE_FILE', { allowWrites: false }), false);
  assert.equal(isToolAllowedByStrategy('READ_ONLY', 'DELETE_FILE', { allowWrites: false }), false);
});

test('Phase 4.18: READ_ONLY strategy allows read tools', () => {
  assert.equal(isToolAllowedByStrategy('READ_ONLY', 'READ_FILE'), true);
  assert.equal(isToolAllowedByStrategy('READ_ONLY', 'LIST_FILES'), true);
  assert.equal(isToolAllowedByStrategy('READ_ONLY', 'SEARCH_CODE'), true);
});

test('Phase 4.18: READ_ONLY strategy blocks terminal by default', () => {
  assert.equal(isToolAllowedByStrategy('READ_ONLY', 'RUN_TERMINAL', { allowTerminal: false }), false);
});

test('Phase 4.18: COMMAND_ONLY strategy allows terminal', () => {
  assert.equal(isToolAllowedByStrategy('COMMAND_ONLY', 'RUN_TERMINAL'), true);
});

test('Phase 4.18: COMMAND_ONLY strategy blocks write tools', () => {
  assert.equal(isToolAllowedByStrategy('COMMAND_ONLY', 'WRITE_FILE', { allowWrites: false }), false);
  assert.equal(isToolAllowedByStrategy('COMMAND_ONLY', 'APPLY_PATCH', { allowWrites: false }), false);
});

test('Phase 4.18: EDIT_AND_VALIDATE strategy allows all tools', () => {
  assert.equal(isToolAllowedByStrategy('EDIT_AND_VALIDATE', 'WRITE_FILE'), true);
  assert.equal(isToolAllowedByStrategy('EDIT_AND_VALIDATE', 'APPLY_PATCH'), true);
  assert.equal(isToolAllowedByStrategy('EDIT_AND_VALIDATE', 'READ_FILE'), true);
  assert.equal(isToolAllowedByStrategy('EDIT_AND_VALIDATE', 'RUN_TERMINAL'), true);
});

test('Phase 4.18: INVESTIGATE_THEN_EDIT strategy allows all tools', () => {
  assert.equal(isToolAllowedByStrategy('INVESTIGATE_THEN_EDIT', 'WRITE_FILE'), true);
  assert.equal(isToolAllowedByStrategy('INVESTIGATE_THEN_EDIT', 'APPLY_PATCH'), true);
  assert.equal(isToolAllowedByStrategy('INVESTIGATE_THEN_EDIT', 'RUN_TERMINAL'), true);
});

test('Phase 4.18: LOOP_SAFE_RETRY strategy allows terminal', () => {
  assert.equal(isToolAllowedByStrategy('LOOP_SAFE_RETRY', 'RUN_TERMINAL', { allowTerminal: true }), true);
});

test('Phase 4.18: LOOP_SAFE_RETRY strategy has limited repair attempts', () => {
  const result = selectExecutionStrategy({
    originalPrompt: 'Try the command several times',
    taskType: 'CODING'
  });
  
  assert.ok(result.constraints.maxRepairAttempts <= 2);
});

// ===================== Determinism Tests =====================

test('Phase 4.18: Strategy selection is deterministic', () => {
  const prompt = 'Read package.json and explain the version';
  const result1 = selectExecutionStrategy({ originalPrompt: prompt });
  const result2 = selectExecutionStrategy({ originalPrompt: prompt });
  const result3 = selectExecutionStrategy({ originalPrompt: prompt });

  assert.deepEqual(result1, result2);
  assert.deepEqual(result2, result3);
});

test('Phase 4.18: Empty input returns safe READ_ONLY default', () => {
  const result = selectExecutionStrategy({});

  assert.equal(result.strategy, 'READ_ONLY');
  assert.equal(result.constraints.allowWrites, false);
});

test('Phase 4.18: CHAT task type selects READ_ONLY', () => {
  const result = selectExecutionStrategy({
    originalPrompt: 'What is the package name?',
    taskType: 'CHAT'
  });

  assert.equal(result.strategy, 'READ_ONLY');
  assert.equal(result.constraints.allowWrites, false);
});

test('Phase 4.18: ANALYSIS task type selects READ_ONLY', () => {
  const result = selectExecutionStrategy({
    originalPrompt: 'Analyze package.json',
    taskType: 'ANALYSIS'
  });

  assert.equal(result.strategy, 'READ_ONLY');
});

test('Phase 4.18: Search task type selects READ_ONLY', () => {
  const result = selectExecutionStrategy({
    originalPrompt: 'Search for imports',
    taskType: 'SEARCH'
  });

  assert.equal(result.strategy, 'READ_ONLY');
});

// ===================== Integration Test =====================

test('Phase 4.18: Strategy output format is correct', () => {
  const result = selectExecutionStrategy({
    originalPrompt: 'Create a test file',
    taskType: 'CODING',
    requiredFiles: ['test.js']
  });

  assert.ok(['READ_ONLY', 'COMMAND_ONLY', 'EDIT_AND_VALIDATE', 'INVESTIGATE_THEN_EDIT', 'LOOP_SAFE_RETRY'].includes(result.strategy));
  assert.equal(typeof result.confidence, 'number');
  assert.ok(result.confidence >= 0 && result.confidence <= 1);
  assert.ok(Array.isArray(result.reasons));
  assert.ok(result.constraints.allowWrites !== undefined);
  assert.ok(result.constraints.allowTerminal !== undefined);
  assert.ok(result.constraints.requireValidation !== undefined);
  assert.ok(result.constraints.maxRepairAttempts !== undefined);
});