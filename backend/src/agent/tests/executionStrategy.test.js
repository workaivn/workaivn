import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExecutionStrategy } from '../strategy/index.js';
import { tryRecovery } from '../planner/executionController.js';

function captureLogs() {
  const logs = [];
  const original = console.log;
  console.log = (...args) => {
    logs.push(args.map(arg => {
      if (typeof arg === 'string') return arg;
      try { return JSON.stringify(arg); } catch { return String(arg); }
    }).join(' '));
  };
  return {
    logs,
    restore() {
      console.log = original;
    }
  };
}

test('Phase 4.24 A: syntax errors choose RetryModel', () => {
  const logger = captureLogs();
  try {
    const decision = evaluateExecutionStrategy({
      failedTask: { id: 'task-a', kind: 'CODING', tool: 'WRITE_FILE' },
      validationResult: { stderr: 'SyntaxError: Unexpected token }' },
      workspaceMetadata: { terminalAvailable: true, packageManagerAvailable: true, packageEditable: true },
      projectScan: {}
    });

    assert.equal(decision.decision, 'RetryModel');
    assert.equal(decision.owner, 'MODEL');
    assert.equal(decision.retryAllowed, true);
    assert.ok(logger.logs.some(line => line.includes('[FAILURE_CLASSIFIED]')));
    assert.ok(logger.logs.some(line => line.includes('[RETRY_ALLOWED]')));
    assert.ok(logger.logs.some(line => line.includes('[EXECUTION_DECISION]')));
  } finally {
    logger.restore();
  }
});

test('Phase 4.24 B: wrong imports choose RetryModel', () => {
  const decision = evaluateExecutionStrategy({
    failedTask: { id: 'task-b', kind: 'CODING', tool: 'WRITE_FILE' },
    validationResult: { stderr: 'The requested module does not provide an export named "foo"' },
    workspaceMetadata: { terminalAvailable: true, packageManagerAvailable: true, packageEditable: true },
    projectScan: {}
  });

  assert.equal(decision.decision, 'RetryModel');
  assert.equal(decision.owner, 'MODEL');
  assert.equal(decision.retryAllowed, true);
});

test('Phase 4.24 C: missing dependency uses package strategy with no model retry', () => {
  const decision = evaluateExecutionStrategy({
    failedTask: { id: 'task-c', kind: 'CODING', tool: 'WRITE_FILE' },
    validationResult: { stderr: 'Cannot find module lucide-react' },
    workspaceMetadata: {
      terminalAvailable: true,
      packageManagerAvailable: true,
      packageEditable: true
    },
    projectScan: {}
  });

  assert.equal(decision.decision, 'InstallDependency');
  assert.equal(decision.owner, 'PLANNER');
  assert.equal(decision.retryAllowed, false);
  assert.equal(decision.packageRequired, true);
});

test('Phase 4.24 D: framework unavailable chooses setup or block, not retry', () => {
  const decision = evaluateExecutionStrategy({
    failedTask: { id: 'task-d', kind: 'CODING', tool: 'WRITE_FILE' },
    validationResult: { stderr: 'No runnable test framework available' },
    workspaceMetadata: {
      terminalAvailable: true,
      packageManagerAvailable: true,
      packageEditable: true,
      frameworkSetupAllowed: true
    },
    projectScan: {}
  });

  assert.equal(decision.decision, 'SetupFramework');
  assert.equal(decision.owner, 'PLANNER');
  assert.equal(decision.retryAllowed, false);
  assert.equal(decision.setupRequired, true);
});

test('Phase 4.24 E: missing validation command does not trigger model retry', () => {
  const decision = evaluateExecutionStrategy({
    failedTask: { id: 'task-e', kind: 'CODING', tool: 'RUN_TERMINAL' },
    validationResult: { stderr: 'Validation command missing' },
    workspaceMetadata: {
      terminalAvailable: true,
      packageManagerAvailable: true,
      packageEditable: true
    },
    projectScan: {}
  });

  assert.equal(decision.decision, 'DeriveCommand');
  assert.equal(decision.owner, 'PLANNER');
  assert.equal(decision.retryAllowed, false);
  assert.equal(decision.commandRequired, true);
});

test('Phase 4.24 F: coordinator corruption chooses planner recovery', () => {
  const decision = evaluateExecutionStrategy({
    failedTask: { id: 'task-f', kind: 'CODING', tool: 'WRITE_FILE' },
    validationResult: { stderr: 'coordinator corruption detected' },
    workspaceMetadata: {
      terminalAvailable: true,
      packageManagerAvailable: true,
      packageEditable: true
    },
    projectScan: {}
  });

  assert.equal(decision.decision, 'PlannerRecovery');
  assert.equal(decision.owner, 'PLANNER');
  assert.equal(decision.recoveryRequired, true);
  assert.equal(decision.retryAllowed, false);
});

test('Phase 4.24 G: planner corruption chooses planner recovery', () => {
  const decision = evaluateExecutionStrategy({
    failedTask: { id: 'task-g', kind: 'CODING', tool: 'WRITE_FILE' },
    validationResult: { stderr: 'planner graph corruption detected' },
    workspaceMetadata: {
      terminalAvailable: true,
      packageManagerAvailable: true,
      packageEditable: true
    },
    projectScan: {}
  });

  assert.equal(decision.decision, 'PlannerRecovery');
  assert.equal(decision.owner, 'PLANNER');
  assert.equal(decision.recoveryRequired, true);
  assert.equal(decision.retryAllowed, false);
});

test('Phase 4.24 H: workspace readonly blocks writes', () => {
  const decision = evaluateExecutionStrategy({
    failedTask: { id: 'task-h', kind: 'CODING', tool: 'WRITE_FILE' },
    validationResult: { stderr: 'SyntaxError: Unexpected token }' },
    workspaceMetadata: {
      readOnly: true,
      terminalAvailable: true,
      packageManagerAvailable: true,
      packageEditable: false
    },
    projectScan: {}
  });

  assert.equal(decision.decision, 'Block');
  assert.equal(decision.retryAllowed, false);
  assert.equal(decision.reason, 'Workspace is read-only');
});

test('Phase 4.24 I: missing package manager blocks dependency installs', () => {
  const decision = evaluateExecutionStrategy({
    failedTask: { id: 'task-i', kind: 'CODING', tool: 'WRITE_FILE' },
    validationResult: { stderr: 'Cannot find module lucide-react' },
    workspaceMetadata: {
      terminalAvailable: true,
      packageManagerAvailable: false,
      packageEditable: true
    },
    projectScan: {}
  });

  assert.equal(decision.decision, 'Block');
  assert.equal(decision.packageRequired, true);
  assert.equal(decision.retryAllowed, false);
});

test('Phase 4.24 planner-facing recovery consumes execution strategy decisions', () => {
  const logger = captureLogs();
  try {
    const planner = {
      parallelMode: true,
      requiredCommands: [],
      changedFiles: [],
      graph: { allNodes: () => [] }
    };
    const failedTask = {
      id: 'task-syntax',
      kind: 'CODING',
      tool: 'WRITE_FILE',
      goal: 'Write src/app.js',
      toolArgs: { path: 'src/app.js' }
    };

    const result = tryRecovery(planner, failedTask, {
      validationContext: { stderr: 'SyntaxError: Unexpected token }' },
      workspaceRoot: process.cwd(),
      projectScan: {},
      requiredCommands: []
    });

    assert.equal(result.recoveryStarted, false);
    assert.equal(result.shouldRetryModel, true);
    assert.equal(result.strategyDecision.decision, 'RetryModel');
    assert.ok(logger.logs.some(line => line.includes('[EXECUTION_STRATEGY_DECISION_APPLIED]')));
  } finally {
    logger.restore();
  }
});
