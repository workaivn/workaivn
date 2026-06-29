import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRecoveryConversation, resolveRecoveryPayloadResponse } from '../runAgentLoop.js';

test('Recovery hard lock seeds a minimal recovery prompt and rejects wrong tools until content is returned', async () => {
  const conversation = buildRecoveryConversation({
    objective: 'Implement a new module:\nbackend/src/agent/planner/clarificationEngine.js',
    recoveryTask: {
      id: 'recovery-write',
      tool: 'WRITE_FILE',
      toolArgs: { path: 'backend/src/agent/planner/clarificationEngine.js', content: '' },
      goal: 'Recovery: repair backend/src/agent/planner/clarificationEngine.js before rerun'
    },
    latestFailure: 'npm test -- plannerPhase419 returned RUN_TERMINAL instead of WRITE_FILE.',
    expectedTool: 'WRITE_FILE',
    expectedArgs: { path: 'backend/src/agent/planner/clarificationEngine.js' },
    responseMode: 'content'
  });

  const seenMessages = [];
  const responses = [
    JSON.stringify({ tool: 'RUN_TERMINAL', args: { command: 'npm test -- plannerPhase419' } }),
    JSON.stringify({ tool: 'RUN_TERMINAL', args: { command: 'npm test -- plannerPhase419' } }),
    JSON.stringify({ content: 'export function analyzeClarification(prompt) {\n  return { needsClarification: false };\n}' })
  ];

  let index = 0;
  const result = await resolveRecoveryPayloadResponse({
    expectedTool: 'WRITE_FILE',
    recoveryTask: {
      id: 'recovery-write',
      tool: 'WRITE_FILE',
      toolArgs: { path: 'backend/src/agent/planner/clarificationEngine.js', content: '' }
    },
    conversation,
    plan: 'planner',
    step: 1,
    objective: 'Implement a new module:\nbackend/src/agent/planner/clarificationEngine.js',
    writePath: 'backend/src/agent/planner/clarificationEngine.js',
    generateResponse: async ({ messages }) => {
      seenMessages.push(messages.map(message => ({
        role: message.role,
        content: String(message.content || '')
      })));
      return responses[index++];
    },
    maxAttempts: 3
  });

  assert.equal(result.accepted, true, 'Recovery should eventually accept content-only output');
  assert.equal(index, 3, 'Recovery should retry until content is returned');
  assert.ok(seenMessages.length >= 1, 'Recovery should invoke the model');
  assert.ok(
    seenMessages.every(batch => batch.every(message => message.role === 'system')),
    'Recovery prompt should stay system-only and avoid prior assistant/tool chatter'
  );
  assert.ok(
    seenMessages[0].some(message => message.content.includes('Original user prompt: Implement a new module')),
    'Recovery prompt should include the original user prompt'
  );
  assert.ok(
    seenMessages[0].some(message => message.content.includes('Recovery objective: Recovery: repair backend/src/agent/planner/clarificationEngine.js before rerun')),
    'Recovery prompt should include the recovery objective'
  );
  assert.ok(
    seenMessages[0].some(message => message.content.includes('Latest terminal failure: npm test -- plannerPhase419 returned RUN_TERMINAL instead of WRITE_FILE.')),
    'Recovery prompt should include the latest terminal failure'
  );
  assert.ok(
    seenMessages[0].some(message => message.content.includes('The planner has already selected WRITE_FILE.')),
    'Recovery prompt should hard-lock the expected tool'
  );
});
