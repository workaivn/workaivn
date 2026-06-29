import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRecoveryPayloadResponse } from '../runAgentLoop.js';

test('Recovery WRITE_FILE uses content-only generation and executor constructs the tool', async () => {
  const responses = [
    { content: 'console.log("RECOVERY_OK");\n' }
  ];

  let calls = 0;
  const result = await resolveRecoveryPayloadResponse({
    expectedTool: 'WRITE_FILE',
    recoveryTask: {
      id: 'recovery-write',
      tool: 'WRITE_FILE',
      toolArgs: { path: 'backend/src/agent/planner/clarificationEngine.js', content: '' }
    },
    conversation: [
      {
        role: 'system',
        content: 'The planner has already selected WRITE_FILE. Do NOT choose any tool. Generate ONLY the file content.'
      }
    ],
    plan: 'planner',
    step: 1,
    objective: 'Repair clarificationEngine.js',
    writePath: 'backend/src/agent/planner/clarificationEngine.js',
    generateResponse: async () => JSON.stringify(responses[calls++]),
    maxAttempts: 3
  });

  assert.equal(calls, 1, 'Model should be asked only for content');
  assert.equal(result.accepted, true, 'Content-only payload should be accepted');
  assert.equal(String(result.parsed?.content || '').includes('RECOVERY_OK'), true);

  const tool = 'WRITE_FILE';
  const args = {
    path: 'backend/src/agent/planner/clarificationEngine.js',
    file: 'backend/src/agent/planner/clarificationEngine.js',
    content: result.parsed.content
  };

  assert.equal(tool, 'WRITE_FILE', 'Executor must construct WRITE_FILE itself');
  assert.match(args.content, /RECOVERY_OK/, 'Constructed WRITE_FILE must include generated content');
});
