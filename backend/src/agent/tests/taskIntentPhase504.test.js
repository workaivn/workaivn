import assert from 'node:assert/strict';
import test from 'node:test';

import { detectProjectIntent } from '../projectIntelligence/index.js';
import { resolvePlannerPolicies } from '../planner/context/PlannerPolicy.js';
import {
  assertTaskIntentConsistency,
  createTaskIntent,
  freezeTaskIntent
} from '../planner/taskIntent.js';

function captureLogs() {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.map(item => {
      if (typeof item === 'string') return item;
      try {
        return JSON.stringify(item);
      } catch {
        return String(item);
      }
    }).join(' '));
  };
  return {
    logs,
    restore() {
      console.log = originalLog;
    }
  };
}

test('Phase 5.04: TaskIntent is created, frozen, and preserves WRITE_AND_RUN authority', () => {
  const { logs, restore } = captureLogs();
  try {
    const created = createTaskIntent({
      taskMode: 'WRITE_AND_RUN',
      goalType: 'WRITE_AND_RUN',
      executionMode: 'WRITE_AND_RUN',
      source: 'task-classifier'
    });
    const frozen = freezeTaskIntent(created);

    assert.equal(created.taskMode, 'WRITE_AND_RUN');
    assert.equal(created.goalType, 'WRITE_AND_RUN');
    assert.equal(created.executionMode, 'WRITE_AND_RUN');
    assert.ok(Object.isFrozen(frozen));
    assert.ok(Object.isFrozen(frozen.metadata));
    assert.ok(logs.some(line => line.includes('[TASK_INTENT_CREATED]')));
    assert.ok(logs.some(line => line.includes('[TASK_INTENT_FROZEN]')));
  } finally {
    restore();
  }
});

test('Phase 5.04: detectProjectIntent consumes TaskIntent and does not drift from authority mode', () => {
  const { logs, restore } = captureLogs();
  try {
    const taskIntent = freezeTaskIntent(createTaskIntent({
      taskMode: 'READ_ONLY',
      goalType: 'READ_ONLY',
      executionMode: 'READ_ONLY',
      source: 'task-classifier'
    }));

    const result = detectProjectIntent('Explain React hooks.', {
      taskIntent
    });

    assert.equal(result.goalType, 'READ_ONLY');
    assert.equal(result.taskIntent.taskMode, 'READ_ONLY');
    assert.ok(logs.some(line => line.includes('[TASK_INTENT_CONSUMED]')));
    assert.ok(logs.some(line => line.includes('[GOAL_CLASSIFICATION_RESULT]')));
  } finally {
    restore();
  }
});

test('Phase 5.04: authority mismatch is rejected with INTENT_AUTHORITY_VIOLATION', () => {
  const taskIntent = freezeTaskIntent(createTaskIntent({
    taskMode: 'CODING',
    goalType: 'CODING',
    executionMode: 'WRITE',
    source: 'task-classifier'
  }));

  assert.throws(() => {
    assertTaskIntentConsistency(taskIntent, [
      {
        stage: 'GoalClassifier',
        taskMode: 'READ_ONLY',
        goalType: 'READ_ONLY',
        executionMode: 'READ_ONLY'
      }
    ]);
  }, error => error?.code === 'INTENT_AUTHORITY_VIOLATION');
});

test('Phase 5.04: PlannerPolicy respects frozen TaskIntent authority flags', () => {
  const taskIntent = freezeTaskIntent({
    taskMode: 'READ_ONLY',
    goalType: 'READ_ONLY',
    executionMode: 'READ_ONLY',
    writeAllowed: false,
    readAllowed: true,
    runAllowed: false,
    validationAllowed: false,
    bootstrapAllowed: false,
    projectInitializationAllowed: false,
    source: 'task-classifier'
  });

  const policies = resolvePlannerPolicies({
    workspaceState: {
      existingFiles: []
    },
    projectScan: {
      facts: {
        packageJsonFound: false,
        testCommands: [],
        buildCommands: []
      }
    },
    projectIntent: {
      prompt: 'Explain React hooks.',
      objective: 'Explain React hooks.',
      taskIntent
    },
    validatedAssumptions: []
  });

  assert.equal(policies.ALLOW_PROJECT_BOOTSTRAP, false);
  assert.equal(policies.ALLOW_NEW_PROJECT_INITIALIZATION, false);
  assert.equal(policies.ALLOW_PROJECT_INITIALIZATION, false);
  assert.equal(policies.ALLOW_VALIDATION_DERIVATION, false);
});
