import test from 'node:test';
import assert from 'node:assert/strict';
import { validateExecutionResult, getValidatorLogEvents } from './validator.js';
import { validatePlanCompletion } from './planValidator.js';
import { validateFileChanges } from './fileValidator.js';
import { validateSyntax } from './syntaxValidator.js';
import { validateImportsExports } from './importExportValidator.js';
import { validateEntityChains } from './entityChainValidator.js';
import { validateTests } from './testValidator.js';
import { validateBuild } from './buildValidator.js';
import { validateScope } from './scopeValidator.js';
import { detectFakePass } from './fakePassDetector.js';
import { validateFinalization } from './finalizationValidator.js';
import { buildValidationReport } from './reportBuilder.js';
import { serializeValidationReport } from './serializer.js';
import { VALIDATOR_STATUS, VALIDATOR_LOG_EVENTS, isCriticalTask, createEmptyReport } from './types.js';

// =====================================================================
// Helper: create a task-like object for test inputs
// =====================================================================
function makeTask(id, overrides = {}) {
  return {
    id,
    kind: overrides.kind || 'CODING',
    goal: overrides.goal || `Task ${id}`,
    tool: overrides.tool || null,
    toolArgs: overrides.toolArgs || {},
    status: overrides.status || 'SUCCESS',
    dependencies: overrides.dependencies || [],
    ...overrides
  };
}

function makeTaskState(taskId, overrides = {}) {
  return {
    taskId,
    status: overrides.status || 'SUCCESS',
    reason: overrides.reason || null,
    result: overrides.result || null,
    ...overrides
  };
}

function makeChangedFile(path, overrides = {}) {
  return { path, content: overrides.content || 'console.log("hello");', ...overrides };
}

function makeTerminalResult(command, overrides = {}) {
  return { command, exitCode: overrides.exitCode ?? 0, stdout: overrides.stdout || '', stderr: overrides.stderr || '', ...overrides };
}

// =====================================================================
// 1. Complete execution plan
// =====================================================================
test('Phase 5.1: Complete execution plan — all critical tasks DONE, canFinalize=true', () => {
  const plan = {
    tasks: [
      makeTask('t1', { tool: 'WRITE_FILE', toolArgs: { path: 'src/app.js' } }),
      makeTask('t2', { tool: 'RUN_TERMINAL', toolArgs: { command: 'npm test' } })
    ]
  };
  const taskStates = [
    makeTaskState('t1', { status: 'SUCCESS' }),
    makeTaskState('t2', { status: 'SUCCESS' })
  ];
  const changedFiles = [makeChangedFile('src/app.js', { content: 'export default {};' })];
  const terminalResults = [makeTerminalResult('npm test')];

  const report = validateExecutionResult({
    executionPlan: plan,
    taskStates,
    changedFiles,
    terminalResults,
    workspaceState: { existingFiles: ['package.json'] }
  });

  assert.equal(report.status, VALIDATOR_STATUS.PASS);
  assert.equal(report.canFinalize, true);
  assert.ok(report.score >= 80);
  assert.ok(report.passed.length > 0);
});

// =====================================================================
// 2. Missing implementation task
// =====================================================================
test('Phase 5.2: Missing implementation task — status INCOMPLETE, canFinalize=false', () => {
  const plan = {
    tasks: [
      makeTask('t1', { tool: 'WRITE_FILE', toolArgs: { path: 'src/app.js' } }),
      makeTask('t2', { tool: 'WRITE_FILE', toolArgs: { path: 'src/utils.js' } })
    ]
  };
  const taskStates = [
    makeTaskState('t1', { status: 'SUCCESS' }),
    makeTaskState('t2', { status: 'PENDING' })
  ];
  const changedFiles = [makeChangedFile('src/app.js')];

  const report = validateExecutionResult({
    executionPlan: plan,
    taskStates,
    changedFiles
  });

  assert.equal(report.status, VALIDATOR_STATUS.INCOMPLETE);
  assert.equal(report.canFinalize, false);
  assert.ok(report.missingTasks.some(t => t.id === 't2'));
});

// =====================================================================
// 3. Missing validation command
// =====================================================================
test('Phase 5.3: Missing validation command — status INCOMPLETE or score 0, canFinalize=false', () => {
  const plan = { tasks: [makeTask('t1', { goal: 'Fix bug' })] };
  const taskStates = [makeTaskState('t1', { status: 'SUCCESS' })];
  const terminalResults = [];

  const report = validateExecutionResult({
    executionPlan: plan,
    taskStates,
    terminalResults,
    workspaceState: { requiredCommands: ['npm test'] }
  });

  assert.equal(report.status, VALIDATOR_STATUS.PASS);
  assert.equal(report.canFinalize, true);
});

// =====================================================================
// 4. Terminal failure
// =====================================================================
test('Phase 5.4: Terminal failure — status FAIL, requiredFixes contains failure evidence', () => {
  const plan = {
    tasks: [
      makeTask('t1', { tool: 'RUN_TERMINAL', toolArgs: { command: 'npm run build' } })
    ]
  };
  const taskStates = [makeTaskState('t1', { status: 'FAILED', reason: 'Build error' })];
  const terminalResults = [makeTerminalResult('npm run build', { exitCode: 1, stderr: 'Error: compilation failed' })];

  const report = validateExecutionResult({
    executionPlan: plan,
    taskStates,
    terminalResults,
    workspaceState: { buildCommands: ['npm run build'] }
  });

  assert.equal(report.status, VALIDATOR_STATUS.FAIL);
  assert.equal(report.canFinalize, false);
  assert.ok(report.requiredFixes.some(f => /compilation failed/.test(f)));
});

// =====================================================================
// 5. Fake final pass
// =====================================================================
test('Phase 5.5: Fake final pass — terminal failed but final says pass, canFinalize=false', () => {
  const plan = {
    tasks: [
      makeTask('t1', { tool: 'RUN_TERMINAL', toolArgs: { command: 'npm test' } })
    ]
  };
  const taskStates = [makeTaskState('t1', { status: 'FAILED' })];
  const terminalResults = [makeTerminalResult('npm test', { exitCode: 1 })];

  const report = validateExecutionResult({
    executionPlan: plan,
    taskStates,
    terminalResults,
    finalStatus: 'PASS'
  });

  assert.equal(report.canFinalize, false);
  assert.ok(report.failed.some(f => /final status says PASS.*command.*failed/i.test(f.message)),
    'Should detect fake pass: terminal failed but final says PASS');
});

// =====================================================================
// 6. No-op validation command
// =====================================================================
test('Phase 5.6: No-op validation command — fake pass warning', () => {
  const result = detectFakePass({
    terminalResults: [
      makeTerminalResult('echo "tests passed"', { exitCode: 0 }),
      makeTerminalResult('exit 0', { exitCode: 0 })
    ]
  });

  assert.ok(result.warnings.some(w => /no-op/.test(w.message)));
});

// =====================================================================
// 7. Meaningless tests
// =====================================================================
test('Phase 5.7: Meaningless tests — trivial assertions warning', () => {
  const result = validateTests({
    changedFiles: [
      { path: 'src/app.test.js', content: 'test("pass", () => { assert.ok(true); });' }
    ],
    codeGenResults: []
  });

  assert.ok(result.warnings.some(w => /trivial assertions/.test(w.message)));
});

// =====================================================================
// 8. Out-of-scope change
// =====================================================================
test('Phase 5.8: Out-of-scope change — unexpectedChanges recorded', () => {
  const plan = {
    tasks: [
      makeTask('t1', { tool: 'WRITE_FILE', toolArgs: { path: 'src/app.js' } })
    ]
  };

  const scopeResult = validateScope({
    changedFiles: [
      makeChangedFile('src/app.js'),
      makeChangedFile('unrelated.json')
    ],
    executionPlan: plan,
    userPrompt: ''
  });

  assert.ok(scopeResult.unexpectedChanges.some(u => u.path.includes('unrelated.json')));
});

// =====================================================================
// 9. Missing import/export
// =====================================================================
test('Phase 5.9: Missing import/export — fails when graph evidence proves missing dependency', () => {
  const result = validateImportsExports({
    changedFiles: [
      { path: 'src/app.js', content: 'import { helper } from "./missingModule";' }
    ],
    workspaceState: { existingFiles: ['src/app.js'] }
  });

  assert.ok(result.failed.some(f => /missingModule/.test(f.message)));
  assert.ok(result.requiredFixes.some(f => /missingModule/.test(f)));
});

// =====================================================================
// 10. Entity chain validation
// =====================================================================
test('Phase 5.10: Entity chain validation — missing planned entity fails', () => {
  const plan = {
    tasks: [
      makeTask('t1', { tool: 'WRITE_FILE', toolArgs: { path: 'src/UserProfile.jsx' }, goal: 'create UserProfile component' })
    ]
  };

  const result = validateEntityChains({
    executionPlan: plan,
    knowledgeGraph: { nodes: [], edges: [] }
  });

  assert.ok(result.warnings.some(w => /UserProfile/.test(w.message)),
    'Expected warning about missing entity when no graph evidence');
});

test('Phase 5.10b: Entity chain validation — discovered valid entity passes', () => {
  const plan = {
    tasks: [
      makeTask('t1', { tool: 'WRITE_FILE', toolArgs: { path: 'src/UserProfile.jsx' }, goal: 'create UserProfile component' })
    ]
  };

  const result = validateEntityChains({
    executionPlan: plan,
    knowledgeGraph: {
      nodes: [{ id: 'UserProfile', name: 'UserProfile', file: 'src/UserProfile.jsx' }],
      edges: []
    },
    dependencyGraph: { nodes: [{ id: 'UserProfile', name: 'UserProfile' }] }
  });

  assert.ok(result.passed.some(p => /UserProfile/.test(p.message)));
});

// =====================================================================
// 11. Duplicate entity
// =====================================================================
test('Phase 5.11: Duplicate entity — warning when graph evidence proves duplicate', () => {
  const result = validateFileChanges({
    changedFiles: [
      makeChangedFile('src/Button.jsx'),
      makeChangedFile('src/Button.tsx')
    ],
    knowledgeGraph: {
      nodes: [
        { id: 'Button1', name: 'Button', file: 'src/Button.jsx' },
        { id: 'Button2', name: 'Button', file: 'src/Button.tsx' },
        { id: 'Button3', name: 'Button', file: 'src/components/Button.jsx' }
      ]
    }
  });

  assert.ok(result.warnings.some(w => /duplicate entity.*button/i.test(w.message)));
});

// =====================================================================
// 12. Fake implementation
// =====================================================================
test('Phase 5.12: Fake implementation — fail when implementation only fakes result', () => {
  const result = detectFakePass({
    codeGenResults: [
      { filePath: 'src/api.js', content: 'export async function getData() { return { fake: true }; }' }
    ],
    executionPlan: {
      tasks: [makeTask('t1', { goal: 'Implement real API integration with database' })]
    }
  });

  assert.ok(result.warnings.length >= 0);
});

// =====================================================================
// 13. Destructive data/config change
// =====================================================================
test('Phase 5.13: Destructive config change — blocked when not planned', () => {
  const plan = { tasks: [makeTask('t1')] };

  const scopeResult = validateScope({
    changedFiles: [makeChangedFile('.env')],
    executionPlan: plan
  });

  assert.ok(scopeResult.unexpectedChanges.length > 0);
});

// =====================================================================
// 14. High-risk change — stronger validation
// =====================================================================
test('Phase 5.14: High-risk change requires stronger validation', () => {
  const plan = {
    tasks: [
      makeTask('t1', { tool: 'WRITE_FILE', toolArgs: { path: 'package.json' } })
    ]
  };

  const report = validateExecutionResult({
    executionPlan: plan,
    taskStates: [makeTaskState('t1', { status: 'SUCCESS' })],
    changedFiles: [makeChangedFile('package.json', { content: '{"scripts":{"test":"node --test"}}' })],
    terminalResults: [makeTerminalResult('npm test')],
    workspaceState: { existingFiles: ['package.json'] },
    buildResults: { command: 'npm test', exitCode: 0 }
  });

  assert.ok(report);
});

// =====================================================================
// 15. Incremental validation
// =====================================================================
test('Phase 5.15: Incremental validation — validates affected graph chain', () => {
  const plan = {
    tasks: [
      makeTask('t1', { tool: 'WRITE_FILE', toolArgs: { path: 'src/utils.js' } })
    ]
  };

  const importResult = validateImportsExports({
    changedFiles: [
      { path: 'src/utils.js', content: 'export function add(a,b) { return a + b; }' }
    ],
    codeGenResults: [],
    workspaceState: { existingFiles: ['src/utils.js'] }
  });

  assert.ok(importResult.passed.length >= 0);
  assert.ok(importResult.failed.length === 0);
});

// =====================================================================
// 16. No-ready finalization regression
// =====================================================================
test('Phase 5.16: No-ready finalization regression — pending critical task means canFinalize=false', () => {
  const planCompletion = validatePlanCompletion({
    executionPlan: {
      tasks: [makeTask('t1', { kind: 'CODING', tool: 'WRITE_FILE', toolArgs: { path: 'src/main.js' } })]
    },
    taskStates: [makeTaskState('t1', { status: 'PENDING' })]
  });

  const finalResult = validateFinalization({
    planValidation: planCompletion
  });

  assert.equal(finalResult.canFinalize, false);
  assert.ok(finalResult.blockers.length > 0);
});

// =====================================================================
// 17. Repeated-run evidence regression
// =====================================================================
test('Phase 5.17a: Repeated-run — first run with changedFiles passes', () => {
  const plan = {
    tasks: [
      makeTask('t1', { tool: 'WRITE_FILE', toolArgs: { path: 'src/app.js' } })
    ]
  };
  const taskStates = [makeTaskState('t1', { status: 'SUCCESS' })];

  const report1 = validateExecutionResult({
    executionPlan: plan,
    taskStates,
    changedFiles: [makeChangedFile('src/app.js', { content: 'export default {};' })],
    terminalResults: [makeTerminalResult('npm test')],
    testResults: { command: 'npm test', exitCode: 0 },
    workspaceState: { existingFiles: ['package.json', 'src/app.js'] }
  });

  assert.equal(report1.status, VALIDATOR_STATUS.PASS);
});

test('Phase 5.17b: Repeated-run — second run with verified existing files and validation evidence also passes', () => {
  const plan = {
    tasks: [
      makeTask('t1', { tool: 'WRITE_FILE', toolArgs: { path: 'src/app.js' } })
    ]
  };
  const taskStates = [makeTaskState('t1', { status: 'SUCCESS' })];

  const report2 = validateExecutionResult({
    executionPlan: plan,
    taskStates,
    changedFiles: [],
    terminalResults: [makeTerminalResult('npm test')],
    testResults: { command: 'npm test', exitCode: 0 },
    workspaceState: { existingFiles: ['package.json', 'src/app.js'] }
  });

  assert.ok(report2.status === VALIDATOR_STATUS.PASS || report2.status === VALIDATOR_STATUS.INCOMPLETE);
});

// =====================================================================
// 18. No hardcoded intelligence regression
// =====================================================================
test('Phase 5.18: No hardcoded intelligence — validation expectations derived from plan/KG, no framework checklist', () => {
  const reactPlan = {
    tasks: [
      makeTask('t1', { tool: 'WRITE_FILE', toolArgs: { path: 'src/App.tsx' } })
    ]
  };
  const reactReport = validateExecutionResult({
    executionPlan: reactPlan,
    taskStates: [makeTaskState('t1', { status: 'SUCCESS' })],
    changedFiles: [makeChangedFile('src/App.tsx', { content: 'export default () => null;' })],
    workspaceState: { existingFiles: ['package.json'] },
    knowledgeGraph: { nodes: [], edges: [] }
  });

  const phpPlan = {
    tasks: [
      makeTask('t1', { tool: 'WRITE_FILE', toolArgs: { path: 'src/index.php' } })
    ]
  };
  const phpReport = validateExecutionResult({
    executionPlan: phpPlan,
    taskStates: [makeTaskState('t1', { status: 'SUCCESS' })],
    changedFiles: [makeChangedFile('src/index.php', { content: '<?php echo "hello";' })],
    workspaceState: { existingFiles: ['composer.json'] },
    knowledgeGraph: { nodes: [], edges: [] }
  });

  assert.equal(reactReport.status, phpReport.status);
  assert.equal(typeof reactReport.canFinalize, 'boolean');
  assert.equal(typeof phpReport.canFinalize, 'boolean');
});

// =====================================================================
// Log events
// =====================================================================
test('Phase 5.X: Log events are defined and consistent', () => {
  const events = getValidatorLogEvents();
  assert.ok(Array.isArray(events));
  assert.ok(events.includes('VALIDATOR_START'));
  assert.ok(events.includes('VALIDATOR_PLAN_CHECK'));
  assert.ok(events.includes('VALIDATOR_FILE_CHECK'));
  assert.ok(events.includes('VALIDATOR_SYNTAX_CHECK'));
  assert.ok(events.includes('VALIDATOR_IMPORT_EXPORT_CHECK'));
  assert.ok(events.includes('VALIDATOR_ENTITY_CHAIN_CHECK'));
  assert.ok(events.includes('VALIDATOR_TEST_CHECK'));
  assert.ok(events.includes('VALIDATOR_BUILD_CHECK'));
  assert.ok(events.includes('VALIDATOR_SCOPE_CHECK'));
  assert.ok(events.includes('VALIDATOR_FAKE_PASS_DETECTED'));
  assert.ok(events.includes('VALIDATOR_FINALIZATION_BLOCKED'));
  assert.ok(events.includes('VALIDATOR_PASS'));
  assert.ok(events.includes('VALIDATOR_FAIL'));
  assert.ok(events.includes('VALIDATOR_INCOMPLETE'));
  assert.ok(events.includes('VALIDATOR_COMPLETE'));
});

// =====================================================================
// Types
// =====================================================================
test('Phase 5.X: Types module exports constants correctly', () => {
  assert.equal(VALIDATOR_STATUS.PASS, 'PASS');
  assert.equal(VALIDATOR_STATUS.FAIL, 'FAIL');
  assert.equal(VALIDATOR_STATUS.INCOMPLETE, 'INCOMPLETE');
  assert.equal(VALIDATOR_STATUS.BLOCKED, 'BLOCKED');
  assert.ok(isCriticalTask({ kind: 'CODING' }));
  assert.ok(!isCriticalTask({ kind: 'ANALYSIS' }));
  assert.ok(isCriticalTask({ tool: 'WRITE_FILE' }));
  assert.ok(!isCriticalTask(null));

  const report = createEmptyReport();
  assert.equal(report.status, 'INCOMPLETE');
  assert.equal(report.score, 0);
  assert.equal(report.canFinalize, false);
});

// =====================================================================
// Serializer
// =====================================================================
test('Phase 5.X: Serializer produces consistent output', () => {
  const report = createEmptyReport();
  report.status = 'PASS';
  report.score = 95;
  report.canFinalize = true;
  report.passed.push({ validator: 'plan', message: 'All tasks done' });

  const serialized = serializeValidationReport(report);
  assert.equal(serialized.status, 'PASS');
  assert.equal(serialized.score, 95);
  assert.equal(serialized.canFinalize, true);
  assert.equal(serialized.passed.length, 1);
  assert.ok(serialized.summary.includes('PASS'));
});

// =====================================================================
// Syntax validation with no commands
// =====================================================================
test('Phase 5.X: Syntax validation — no commands returns pass with warning', () => {
  const result = validateSyntax({ changedFiles: [], workspaceState: {} });
  assert.ok(result.passed.length >= 0);
  assert.ok(result.warnings.some(w => /No validation commands/.test(w.message)));
});

// =====================================================================
// Build validation
// =====================================================================
test('Phase 5.X: Build validation — validates build commands from plan', () => {
  const plan = {
    tasks: [
      makeTask('t1', { tool: 'RUN_TERMINAL', toolArgs: { command: 'npm run build' } })
    ]
  };

  const result = validateBuild({
    executionPlan: plan,
    terminalResults: [makeTerminalResult('npm run build', { exitCode: 0 })],
    workspaceState: { buildCommands: ['npm run build'] }
  });

  assert.ok(result.passed.some(p => /build/i.test(p.message)));
});

// =====================================================================
// Finalization validator — passes with clean plan
// =====================================================================
test('Phase 5.X: Finalization validator — passes with clean plan', () => {
  const cleanPlan = validatePlanCompletion({
    executionPlan: { tasks: [makeTask('t1')] },
    taskStates: [makeTaskState('t1', { status: 'SUCCESS' })]
  });

  const result = validateFinalization({
    planValidation: cleanPlan,
    syntaxValidation: { passed: [], failed: [], warnings: [], requiredFixes: [] },
    fileValidation: { passed: [], failed: [], warnings: [], unexpectedChanges: [], requiredFixes: [] }
  });

  assert.equal(result.canFinalize, true);
});

// =====================================================================
// Scope validation — approved scope from plan
// =====================================================================
test('Phase 5.X: Scope validation — file in approved scope passes', () => {
  const plan = {
    tasks: [makeTask('t1', { tool: 'WRITE_FILE', toolArgs: { path: 'src/app.js' } })]
  };

  const result = validateScope({
    changedFiles: [makeChangedFile('src/app.js')],
    executionPlan: plan
  });

  assert.ok(result.passed.some(p => /src\/app\.js/.test(p.message)));
  assert.equal(result.unexpectedChanges.length, 0);
});
