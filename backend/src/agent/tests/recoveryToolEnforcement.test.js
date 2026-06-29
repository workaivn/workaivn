import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRecoveryToolResponse } from '../runAgentLoop.js';

test('Recovery tool enforcement rejects wrong tool and retries until WRITE_FILE is returned', async () => {
  const conversation = [
    { role: 'system', content: 'Recovery task: write file backend/src/agent/planner/clarificationEngine.js' }
  ];

  const responses = [
    { tool: 'RUN_TERMINAL', args: { command: 'npm test -- plannerPhase419' }, done: false },
    {
      tool: 'WRITE_FILE',
      args: {
        path: 'backend/src/agent/planner/clarificationEngine.js',
        content: 'export function analyzeClarification(prompt) { return { needsClarification: false }; }\n'
      },
      done: false
    }
  ];

  let calls = 0;
  const logs = [];
  const originalLog = console.log;
  let result;
  try {
    console.log = (...args) => {
      logs.push(args.map(String).join(' '));
    };

    result = await resolveRecoveryToolResponse({
      expectedTool: 'WRITE_FILE',
      recoveryTask: {
        id: 'recovery-write',
        tool: 'WRITE_FILE',
        toolArgs: { path: 'backend/src/agent/planner/clarificationEngine.js', content: '' }
      },
      conversation,
      plan: 'planner',
      step: 1,
      objective: 'Repair clarificationEngine.js',
      writePath: 'backend/src/agent/planner/clarificationEngine.js',
      generateResponse: async () => JSON.stringify(responses[calls++]),
      maxAttempts: 3
    });
  } finally {
    console.log = originalLog;
  }

  assert.equal(calls, 2, 'Recovery should retry after the wrong tool response');
  assert.equal(result.accepted, true, 'Recovery should eventually accept WRITE_FILE');
  assert.equal(String(result.parsed?.tool || '').toUpperCase(), 'WRITE_FILE');
  assert.match(String(result.parsed?.args?.content || ''), /analyzeClarification/);
  assert.ok(logs.some(line => line.includes('RECOVERY_TOOL_MISMATCH')), 'Should log recovery tool mismatch');
  assert.ok(logs.some(line => line.includes('RECOVERY_CORRECTIVE_INSTRUCTION')), 'Should log recovery corrective instruction');
});
