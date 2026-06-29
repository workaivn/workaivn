import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPlannerGenerateWriteContentLog,
  buildRecoveryConversation
} from '../runAgentLoop.js';

test('Planner generate-content log uses a clearer write-content message payload', () => {
  const payload = buildPlannerGenerateWriteContentLog({
    id: 'task-1',
    tool: 'WRITE_FILE',
    toolArgs: { path: 'backend/src/agent/planner/clarificationEngine.js' }
  });

  assert.deepEqual(payload, {
    taskId: 'task-1',
    path: 'backend/src/agent/planner/clarificationEngine.js',
    expectedTool: 'WRITE_FILE',
    reason: 'generate_content'
  });
});

test('Recovery prompt includes validation command, exit code, stdout, stderr, and assertion context', () => {
  const messages = buildRecoveryConversation({
    objective: 'Implement clarification engine',
    recoveryTask: {
      id: 'recovery-1',
      tool: 'WRITE_FILE',
      toolArgs: {
        path: 'backend/src/agent/planner/clarificationEngine.js',
        recoveryAssertionContext: {
          assertion: 'assert.equal(analyzeClarification("Read package.json").needsClarification, false);',
          expectedExport: 'analyzeClarification',
          expectedFunction: 'analyzeClarification',
          expectedReturnValues: ['needsClarification'],
          expectedValue: 'false',
          actualValue: 'true'
        }
      },
      goal: 'Recovery: repair backend/src/agent/planner/clarificationEngine.js before rerun'
    },
    latestFailure: 'Failed validation must be repaired directly.',
    expectedTool: 'WRITE_FILE',
    expectedArgs: { path: 'backend/src/agent/planner/clarificationEngine.js' },
    responseMode: 'content',
    validationContext: {
      failedCommand: 'npm test -- plannerPhase419',
      exitCode: 1,
      stdout: 'stdout line 1\nstdout line 2',
      stderr: 'stderr line 1',
      assertion: 'Expected: false; Actual: true',
      expectedValue: 'false',
      actualValue: 'true',
      changedFiles: ['backend/src/agent/planner/clarificationEngine.js']
    }
  });

  const combined = messages.map(m => String(m.content || '')).join('\n\n');
  assert.match(combined, /Original user prompt: Implement clarification engine/);
  assert.match(combined, /Recovery Repair/);
  assert.match(combined, /Target: backend\/src\/agent\/planner\/clarificationEngine\.js/);
  assert.match(combined, /Validation command: npm test -- plannerPhase419/);
  assert.match(combined, /Exit code: 1/);
  assert.match(combined, /stdout: stdout line 1/);
  assert.match(combined, /stderr: stderr line 1/);
  assert.match(combined, /Assertion: Expected: false; Actual: true/);
  assert.match(combined, /Expected: false/);
  assert.match(combined, /Actual: true/);
  assert.match(combined, /Recovery assertion context:/);
  assert.match(combined, /Expected export: analyzeClarification/);
  assert.match(combined, /Expected function: analyzeClarification/);
  assert.match(combined, /Expected return values: needsClarification/);
  assert.match(combined, /Latest diff \/ changed files: backend\/src\/agent\/planner\/clarificationEngine\.js/);
  assert.match(combined, /The planner has already selected WRITE_FILE\./);
});
