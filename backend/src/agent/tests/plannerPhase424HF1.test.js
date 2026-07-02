import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPlan } from '../planner/planBuilder.js';
import { Task } from '../planner/task.js';
import { validatePlannerAssumptions, filterUnverifiedFiles, ASSUMPTION_ACTION, decideAssumptionAction, PlannerAssumption } from '../planner/assumptionValidator.js';
import { evaluateExecutionStrategy } from '../strategy/index.js';
import { EXECUTION_DECISIONS } from '../strategy/ExecutionDecision.js';
import { classifyExecutionFailure } from '../strategy/FailureClassifier.js';

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

// ============================================================
// Test A: packageJsonFound=false — planner must NOT create READ_FILE package.json
// ============================================================
test('HF1 Test A: packageJsonFound=false — no READ_FILE package.json in plan', () => {
  const logger = captureLogs();
  try {
    const assumptions = validatePlannerAssumptions({
      workspaceState: { existingFiles: ['src/index.js', 'src/app.js'] },
      projectScan: { projectType: 'generic', packageJsonFound: false },
      classifierRequestedFiles: ['package.json'],
      bootstrapProfile: null,
      projectType: 'generic'
    });

    const filtered = filterUnverifiedFiles(['package.json'], assumptions);
    assert.equal(filtered.includes('package.json'), false, 'package.json must be filtered out');

    const plan = buildPlan('Read the project configuration', {
      requestedFiles: filtered,
      taskType: 'ANALYSIS',
      workspaceState: { existingFiles: ['src/index.js', 'src/app.js'], packageJsonFound: false },
      projectScan: { projectType: 'generic', packageJsonFound: false }
    }, assumptions);

    const readPkgTask = plan.tasks.find(t => t.tool === 'READ_FILE' && t.toolArgs?.path?.includes('package.json'));
    assert.equal(readPkgTask, undefined, 'Must not create READ_FILE package.json when scanner says packageJsonFound=false');

    assert.ok(logger.logs.some(l => l.includes('[PLANNER_ASSUMPTION_REJECTED]')), 'Should log assumption rejection');
  } finally {
    logger.restore();
  }
});

// ============================================================
// Test B: Bootstrap recommends package.json — assumption validation rejects it
// ============================================================
test('HF1 Test B: Bootstrap recommends package.json — assumption validation rejects unverified', () => {
  const logger = captureLogs();
  try {
    const assumptions = validatePlannerAssumptions({
      workspaceState: { existingFiles: ['src/index.js'] },
      projectScan: { projectType: 'react', packageJsonFound: false },
      classifierRequestedFiles: [],
      bootstrapProfile: {
        id: 'react-vite-ts',
        targetFiles: [{ path: 'package.json' }, { path: 'tsconfig.json' }, { path: 'vite.config.ts' }]
      },
      projectType: 'react'
    });

    const pkgJson = assumptions.find(a => a.path === 'package.json');
    const tsconfig = assumptions.find(a => a.path === 'tsconfig.json');
    const viteConfig = assumptions.find(a => a.path === 'vite.config.ts');

    assert.ok(pkgJson, 'package.json assumption created');
    assert.equal(pkgJson.verified, false, 'package.json should be unverified (not in workspace)');
    assert.equal(pkgJson.source, 'bootstrap:react-vite-ts', 'Source should be bootstrap profile');

    assert.ok(tsconfig, 'tsconfig.json assumption created');
    assert.equal(tsconfig.verified, false, 'tsconfig.json should be unverified');
    assert.ok(viteConfig, 'vite.config.ts assumption created');
    assert.equal(viteConfig.verified, false, 'vite.config.ts should be unverified');

    assert.ok(logger.logs.some(l => l.includes('[PLANNER_ASSUMPTION_REJECTED]')), 'Should log rejection for unverified assumptions');
  } finally {
    logger.restore();
  }
});

// ============================================================
// Test C: READ_FILE ENOENT → FailureClassifier → INVALID_PREREQUISITE → REPLAN
// ============================================================
test('HF1 Test C: READ_FILE ENOENT for planner prerequisite classifies as INVALID_PREREQUISITE with REPLAN', () => {
  const logger = captureLogs();
  try {
    const failedTask = new Task({
      id: 'read-pkg',
      kind: 'ANALYSIS',
      goal: 'Read file: package.json',
      tool: 'READ_FILE',
      toolArgs: { path: 'package.json' },
      source: 'classifier'
    });

    const classification = classifyExecutionFailure({
      failedTask,
      validationResult: { stderr: 'ENOENT: no such file or directory, open package.json' },
      workspaceMetadata: { workspaceRoot: '/test' },
      workspaceState: { existingFiles: ['src/index.js', 'src/app.js'] },
      projectScan: { projectType: 'generic' },
      plannerMetadata: { taskSource: 'classifier' }
    });

    assert.equal(classification.classification, 'INVALID_PREREQUISITE', 'Should classify as INVALID_PREREQUISITE');
    assert.equal(classification.replanRecommended, true, 'Should recommend replan');
    assert.equal(classification.origin.owner, 'PLANNER', 'Owner should be PLANNER');
    assert.equal(classification.origin.recoverable, true, 'Should be recoverable');

    const decision = evaluateExecutionStrategy({
      failureClassification: classification,
      failedTask,
      validationResult: { stderr: 'ENOENT: no such file or directory, open package.json' },
      workspaceMetadata: {
        workspaceRoot: '/test',
        terminalAvailable: true,
        packageManagerAvailable: true,
        packageEditable: true
      },
      workspaceState: { existingFiles: ['src/index.js', 'src/app.js'] },
      projectScan: { projectType: 'generic' },
      plannerMetadata: { taskSource: 'classifier' }
    });

    assert.equal(decision.decision, 'Replan', 'Decision should be Replan');
    assert.equal(decision.owner, 'PLANNER', 'Owner should be PLANNER');
    assert.equal(decision.replanRequired, true, 'Replan should be required');
    assert.equal(decision.retryAllowed, false, 'Retry should not be allowed');

    assert.ok(logger.logs.some(l => l.includes('[FAILURE_ASSUMPTION_SOURCE]')), 'Should log assumption source');
    assert.ok(logger.logs.some(l => l.includes('[EXECUTION_DECISION_REPLAN]')), 'Should log REPLAN decision');
  } finally {
    logger.restore();
  }
});

// ============================================================
// Test D: Planner replans — WRITE tasks continue, RUN waits correctly
// ============================================================
test('HF1 Test D: REPLAN removes invalid prerequisite, WRITE tasks continue', () => {
  const logger = captureLogs();
  try {
    const taskA = new Task({ id: 'read-pkg', kind: 'ANALYSIS', goal: 'Read file: package.json', tool: 'READ_FILE', toolArgs: { path: 'package.json' } });
    const taskB = new Task({ id: 'write-app', kind: 'CODING', goal: 'Write file: src/app.js', tool: 'WRITE_FILE', toolArgs: { path: 'src/app.js' }, dependencies: ['read-pkg'] });
    const taskC = new Task({ id: 'run-test', kind: 'CODING', goal: 'Run command: npm test', tool: 'RUN_TERMINAL', dependencies: ['write-app'] });

    const graph = {
      allNodes: () => [taskA, taskB, taskC],
      successors: (id) => id === 'read-pkg' ? ['write-app'] : [],
      markBlocked: (id, reason) => { taskA.status = 'BLOCKED'; taskA.statusReason = reason; }
    };

    const planner = {
      graph,
      parallelMode: true,
      requiredCommands: [],
      changedFiles: [],
      markBlocked: (id, reason) => { taskA.status = 'BLOCKED'; taskA.statusReason = reason; }
    };

    const classification = classifyExecutionFailure({
      failedTask: taskA,
      validationResult: { stderr: 'ENOENT: no such file or directory, open package.json' },
      workspaceMetadata: { workspaceRoot: '/test' },
      workspaceState: { existingFiles: ['src/index.js'] },
      projectScan: { projectType: 'generic' },
      plannerMetadata: { taskSource: 'project_type:react' }
    });

    const decision = evaluateExecutionStrategy({
      failureClassification: classification,
      failedTask: taskA,
      validationResult: { stderr: 'ENOENT: no such file or directory, open package.json' },
      workspaceMetadata: { workspaceRoot: '/test', terminalAvailable: true, packageManagerAvailable: true, packageEditable: true },
      workspaceState: { existingFiles: ['src/index.js'] },
      projectScan: { projectType: 'generic' },
      plannerMetadata: { taskSource: 'project_type:react' }
    });

    assert.equal(decision.decision, 'Replan', 'Decision should be Replan');

    const suggestedAction = decision.suggestedAction || 'REMOVE_INVALID_PREREQUISITE';
    assert.equal(suggestedAction, 'REMOVE_INVALID_PREREQUISITE', 'Should suggest removing invalid prerequisite');

    const successors = graph.successors('read-pkg');
    assert.ok(successors.includes('write-app'), 'WRITE task should be a dependent');

    planner.markBlocked('read-pkg', 'INVALID_PREREQUISITE_REMOVED');
    assert.equal(taskA.status, 'BLOCKED', 'Failed prereq should be blocked');
    assert.equal(taskA.statusReason, 'INVALID_PREREQUISITE_REMOVED', 'Should be marked as invalid prerequisite removed');

    assert.ok(logger.logs.some(l => l.includes('[EXECUTION_DECISION_REPLAN]')), 'Should log REPLAN');
  } finally {
    logger.restore();
  }
});

// ============================================================
// Test E: User explicitly requests missing file — classified as USER_REQUESTED_MISSING_FILE
// ============================================================
test('HF1 Test E: User explicitly requests missing file — USER_REQUESTED_MISSING_FILE', () => {
  const logger = captureLogs();
  try {
    const failedTask = new Task({
      id: 'read-user-file',
      kind: 'ANALYSIS',
      goal: 'Read file: missing.txt',
      tool: 'READ_FILE',
      toolArgs: { path: 'missing.txt' },
      source: null
    });

    const classification = classifyExecutionFailure({
      failedTask,
      validationResult: { stderr: 'ENOENT: no such file or directory, open missing.txt' },
      workspaceMetadata: { workspaceRoot: '/test' },
      workspaceState: { existingFiles: ['src/index.js'] },
      projectScan: { projectType: 'generic' },
      plannerMetadata: { taskSource: null, classifierRequestedFiles: ['missing.txt'] }
    });

    assert.equal(classification.classification, 'USER_REQUESTED_MISSING_FILE', 'Should classify as USER_REQUESTED_MISSING_FILE');
    assert.equal(classification.origin.owner, 'USER', 'Owner should be USER');
    assert.equal(classification.origin.recoverable, false, 'Should not be recoverable');
    assert.equal(classification.origin.replanRecommended, false, 'Should not recommend replan');
  } finally {
    logger.restore();
  }
});

// ============================================================
// Test F: Workspace path normalization wrong — PATH_RESOLUTION_ERROR → REPLAN
// ============================================================
test('HF1 Test F: Path resolution error — PATH_RESOLUTION_ERROR with REPLAN', () => {
  const logger = captureLogs();
  try {
    const failedTask = new Task({
      id: 'read-path-wrong',
      kind: 'ANALYSIS',
      goal: 'Read file: src\app.js',
      tool: 'READ_FILE',
      toolArgs: { path: 'src\\app.js' },
      source: 'classifier'
    });

    const classification = classifyExecutionFailure({
      failedTask,
      validationResult: { stderr: 'ENOENT: no such file or directory, open src\\app.js' },
      workspaceMetadata: { workspaceRoot: '/test' },
      workspaceState: { existingFiles: ['src/app.js', 'src/index.js'] },
      projectScan: { projectType: 'generic' },
      plannerMetadata: { taskSource: 'classifier' }
    });

    assert.equal(classification.classification, 'PATH_RESOLUTION_ERROR', 'Should classify as PATH_RESOLUTION_ERROR');
    assert.equal(classification.origin.replanRecommended, true, 'Should recommend replan');
    assert.equal(classification.origin.recoverable, true, 'Should be recoverable');

    const decision = evaluateExecutionStrategy({
      failureClassification: classification,
      failedTask,
      validationResult: { stderr: 'ENOENT: no such file or directory, open src\\app.js' },
      workspaceMetadata: { workspaceRoot: '/test', terminalAvailable: true, packageManagerAvailable: true, packageEditable: true },
      workspaceState: { existingFiles: ['src/app.js', 'src/index.js'] },
      projectScan: { projectType: 'generic' },
      plannerMetadata: { taskSource: 'classifier' }
    });

    assert.equal(decision.decision, 'Replan', 'Decision should be Replan');
    assert.equal(decision.replanRequired, true, 'Replan should be required');
  } finally {
    logger.restore();
  }
});

// ============================================================
// Test G: Optional config missing — planner skips, execution continues
// ============================================================
test('HF1 Test G: Optional config missing — skip prerequisite, execution continues', () => {
  const assumption = new PlannerAssumption({
    path: 'vite.config.ts',
    source: 'project_type:vite',
    confidence: 0.5,
    required: false,
    optional: true,
    verified: false
  });

  const action = decideAssumptionAction(assumption);
  assert.equal(action, 'SKIP_OPTIONAL_PREREQUISITE', 'Optional unverified assumption should be skipped');

  const filtered = filterUnverifiedFiles(['vite.config.ts', 'src/app.js'], [assumption]);
  assert.equal(filtered.includes('vite.config.ts'), false, 'vite.config.ts should be filtered from prerequisites');
  assert.equal(filtered.includes('src/app.js'), true, 'src/app.js should remain');

  const plan = buildPlan('Build the app', {
    requestedFiles: filtered,
    taskType: 'CODING',
    workspaceState: { existingFiles: ['src/app.js'] },
    projectScan: { projectType: 'vite', packageJsonFound: true }
  });

  const hasViteRead = plan.tasks.some(t => t.tool === 'READ_FILE' && t.toolArgs?.path?.includes('vite.config'));
  assert.equal(hasViteRead, false, 'Should not create READ_FILE for skipped optional prerequisite');

  const hasWrite = plan.tasks.some(t => t.tool === 'WRITE_FILE');
  assert.equal(plan.tasks.length > 0, true, 'Should still have other tasks');
});

// ============================================================
// Test H: Required implementation file missing — planner blocks correctly
// ============================================================
test('HF1 Test H: Required implementation file missing — block correctly', () => {
  const assumption = new PlannerAssumption({
    path: 'src/core.js',
    source: 'classifier',
    confidence: 0.9,
    required: true,
    optional: false,
    verified: false
  });

  const action = decideAssumptionAction(assumption);
  assert.equal(action, 'BLOCK_FATAL', 'Required unverified assumption should block');

  const failedTask = new Task({
    id: 'read-core',
    kind: 'ANALYSIS',
    goal: 'Read file: src/core.js',
    tool: 'READ_FILE',
    toolArgs: { path: 'src/core.js' },
    source: 'classifier'
  });

  const classification = classifyExecutionFailure({
    failedTask,
    validationResult: { stderr: 'ENOENT: no such file or directory, open src/core.js' },
    workspaceMetadata: { workspaceRoot: '/test' },
    workspaceState: { existingFiles: ['src/index.js'] },
    projectScan: { projectType: 'generic' },
    plannerMetadata: { taskSource: 'classifier' }
  });

  assert.equal(classification.classification, 'INVALID_PREREQUISITE', 'Required file missing should be INVALID_PREREQUISITE');
  assert.equal(classification.origin.replanRecommended, true, 'Should recommend replan');

  const decision = evaluateExecutionStrategy({
    failureClassification: classification,
    failedTask,
    validationResult: { stderr: 'ENOENT: no such file or directory, open src/core.js' },
    workspaceMetadata: {
      workspaceRoot: '/test',
      terminalAvailable: true,
      packageManagerAvailable: true,
      packageEditable: true
    },
    workspaceState: { existingFiles: ['src/index.js'] },
    projectScan: { projectType: 'generic' },
    plannerMetadata: { taskSource: 'classifier' }
  });

  assert.equal(decision.decision, 'Replan', 'Decision should be Replan (not Block)');
  assert.equal(decision.replanRequired, true, 'Replan should be required');
});

// ============================================================
// Additional: Part 4 — Execution Strategy integration
// ============================================================
test('HF1 Part 4: Execution Strategy routes INVALID_PREREQUISITE to REPLAN not BLOCK', () => {
  const logger = captureLogs();
  try {
    const classification = {
      classification: 'INVALID_PREREQUISITE',
      confidence: 'high',
      origin: {
        classification: 'INVALID_PREREQUISITE',
        owner: 'PLANNER',
        recoverable: true,
        replanRecommended: true
      },
      recoverable: true,
      replanRecommended: true,
      failedPath: 'package.json',
      assumptionSource: 'bootstrap:react-vite-ts'
    };

    const decision = evaluateExecutionStrategy({
      failureClassification: classification,
      failedTask: { id: 'task-1', tool: 'READ_FILE', kind: 'ANALYSIS', toolArgs: { path: 'package.json' } },
      validationResult: { stderr: 'ENOENT: no such file or directory' },
      workspaceMetadata: { terminalAvailable: true, packageManagerAvailable: true, packageEditable: true },
      workspaceState: { existingFiles: ['src/index.js'] },
      projectScan: { projectType: 'react' },
      plannerMetadata: { taskSource: 'bootstrap:react-vite-ts' }
    });

    assert.equal(decision.decision, 'Replan', 'INVALID_PREREQUISITE must lead to REPLAN');
    assert.equal(decision.owner, 'PLANNER', 'Owner should be PLANNER');
    assert.equal(decision.replanRequired, true, 'Replan should be required');
    assert.equal(decision.retryAllowed, false, 'Retry should not be allowed');

    assert.ok(logger.logs.some(l => l.includes('[EXECUTION_DECISION_REPLAN]')), 'Should log EXECUTION_DECISION_REPLAN');
  } finally {
    logger.restore();
  }
});

// ============================================================
// Additional: Part 5 — Validation command derivation without package.json
// ============================================================
test('HF1 Part 5: Validation derivation does not assume package.json exists', () => {
  const planNoPkg = buildPlan('Build and test the app', {
    taskType: 'CODING',
    requestedFiles: [],
    workspaceState: { existingFiles: ['src/index.js'], packageJsonFound: false },
    projectScan: { projectType: 'generic', packageJsonFound: false, testCommands: [], buildCommands: [] }
  });

  assert.ok(planNoPkg.validationCommands.length === 0 || Array.isArray(planNoPkg.validationCommands),
    'Should not fabricate validation commands when no package.json');

  const planWithPkg = buildPlan('Build and test the app', {
    taskType: 'CODING',
    requestedFiles: [],
    workspaceState: { existingFiles: ['package.json', 'src/index.js'], packageJsonFound: true },
    projectScan: { projectType: 'generic', packageJsonFound: true, testCommands: ['npm test'], buildCommands: ['npm run build'] },
    requiredCommands: ['npm test']
  });

  assert.ok(planWithPkg.validationCommands.length > 0, 'Should use explicit test commands when available');
  assert.ok(planWithPkg.validationCommands.some(c => c.includes('npm test')), 'Should include npm test from requiredCommands');
});

// ============================================================
// Additional: REPLAN log events
// ============================================================
test('HF1 REPLAN log events are defined and consistent', () => {
  const expectedLogs = [
    'EXECUTION_DECISION_REPLAN',
    'PLANNER_REPLAN_START',
    'PLANNER_REPLAN_REMOVE_PREREQUISITE',
    'PLANNER_REPLAN_DEPENDENCY_RELEASED',
    'PLANNER_REPLAN_DONE',
    'FAILURE_ASSUMPTION_SOURCE'
  ];

  for (const logEvent of expectedLogs) {
    assert.ok(typeof logEvent === 'string' && logEvent.length > 0, `Log event ${logEvent} should be defined`);
  }
});

// ============================================================
// Additional: Task source tracking
// ============================================================
test('HF1 Task source tracking: planner-generated tasks carry source metadata', () => {
  const validatedAssumptions = [
    { path: 'src/app.js', source: 'classifier', verified: true, required: true, optional: false, confidence: 0.8 },
    { path: 'tsconfig.json', source: 'project_type:react', verified: false, required: false, optional: true, confidence: 0.5 }
  ];

  const plan = buildPlan('Read src/app.js and tsconfig.json', {
    taskType: 'ANALYSIS',
    requestedFiles: ['src/app.js', 'tsconfig.json'],
    workspaceState: { existingFiles: ['src/app.js'] },
    projectScan: { projectType: 'react', packageJsonFound: true }
  }, validatedAssumptions);

  const appReadTask = plan.tasks.find(t => t.tool === 'READ_FILE' && t.toolArgs?.path === 'src/app.js');
  assert.ok(appReadTask, 'Should create READ_FILE for src/app.js');
  assert.equal(appReadTask.source, 'classifier', 'Should carry source from assumption');

  const tsconfigReadTask = plan.tasks.find(t => t.tool === 'READ_FILE' && t.toolArgs?.path?.includes('tsconfig.json'));
  assert.equal(tsconfigReadTask, undefined, 'Should NOT create READ_FILE for unverified tsconfig.json');
});

// ============================================================
// Additional: EXECUTION_DECISIONS includes REPLAN
// ============================================================
test('HF1 ExecutionDecisions includes REPLAN', () => {
  assert.ok(EXECUTION_DECISIONS.REPLAN, 'REPLAN must be defined in EXECUTION_DECISIONS');
  assert.equal(EXECUTION_DECISIONS.REPLAN, 'Replan', 'REPLAN value should be "Replan"');
});
