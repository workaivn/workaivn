import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeRunPayload } from '../runPayload.js';

test('RUN payload sanitizer truncates huge stdout and nested debug fields', () => {
  const huge = 'x'.repeat(2 * 1024 * 1024);
  const payload = {
    validationContext: {
      stdout: huge,
      stderr: huge
    },
    failureText: huge,
    plannerDebugSnapshot: {
      toolCalls: [
        {
          result: {
            stdout: huge,
            stderr: huge
          }
        }
      ]
    }
  };

  const sanitized = sanitizeRunPayload(payload, { field: 'run' });

  assert.ok(String(sanitized.validationContext.stdout).length < huge.length);
  assert.ok(String(sanitized.validationContext.stderr).length < huge.length);
  assert.ok(String(sanitized.failureText).length < huge.length);
  assert.ok(String(sanitized.plannerDebugSnapshot.toolCalls[0].result.stdout).length < huge.length);
  assert.ok(String(sanitized.plannerDebugSnapshot.toolCalls[0].result.stderr).length < huge.length);
});
