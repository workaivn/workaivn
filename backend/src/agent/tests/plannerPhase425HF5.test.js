import test from 'node:test';
import assert from 'node:assert/strict';
import { Planner } from '../planner/planner.js';
import { Task } from '../planner/task.js';
import { buildPlannerContext } from '../planner/contextBuilder.js';
import { buildPlanningContext } from '../planner/context/PlanningContextBuilder.js';
import { validateContextConsistency } from '../context/ContextConsistencyValidator.js';
import { expandPlannerTasks } from '../planner/taskExpander.js';
import { createProjectScanSnapshot, getCanonicalWorkspaceFiles } from '../context/ProjectScanSnapshot.js';

function captureLogs() {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.map(item => {
      if (typeof item === 'string') return item;
      try { return JSON.stringify(item); } catch { return String(item); }
    }).join(' '));
  };
  return {
    logs,
    restore() {
      console.log = originalLog;
    }
  };
}

test('Phase 4.25-HF5: canonical workspace files exclude template guesses', () => {
  const snapshot = createProjectScanSnapshot({
    workspaceRoot: 'C:/workspace',
    projectType: 'vite',
    packageJsonFound: true,
    packageJsonPath: 'package.json',
    discoveredFiles: ['package.json', 'src/App.tsx', 'src/main.tsx'],
    entryFiles: ['src/App.tsx', 'src/main.tsx'],
    styleFiles: ['src/styles.css']
  });

  const canonical = [...getCanonicalWorkspaceFiles(snapshot)].sort();
  assert.deepEqual(canonical, ['package.json', 'src/App.tsx', 'src/main.tsx', 'src/styles.css']);
});

test('Phase 4.25-HF5: PlannerContextBuilder only selects canonical discovered files', () => {
  const { logs, restore } = captureLogs();

  try {
    const result = buildPlannerContext({
      workspaceRoot: 'C:/workspace',
      projectScan: {
        projectType: 'vite',
        packageJsonFound: true,
        packageJsonPath: 'package.json',
        discoveredFiles: ['package.json', 'src/App.tsx', 'src/main.tsx'],
        entryFiles: ['src/App.tsx', 'src/main.tsx']
      },
      plannerTasks: [],
      classifierResult: {}
    });

    assert.deepEqual(result.requiredReads.sort(), ['package.json', 'src/App.tsx', 'src/main.tsx']);
    assert.ok(logs.some(line => line.includes('[PLANNER_CONTEXT_SELECTED_CANONICAL]')));
    assert.ok(logs.some(line => line.includes('[PLANNER_CONTEXT_CANDIDATE_REJECTED_NOT_DISCOVERED]')));
    assert.ok(!result.requiredReads.some(file => /src\/App\.(?:js|jsx)$/.test(file)));
    assert.ok(!result.requiredReads.some(file => /src\/main\.(?:js|jsx)$/.test(file)));
  } finally {
    restore();
  }
});

test('Phase 4.25-HF5: reasoning target selection prefers canonical entry files over template guesses', () => {
  const { logs, restore } = captureLogs();

  try {
    const planner = new Planner([
      new Task({
        id: 'root',
        kind: 'REASONING',
        goal: 'Create a landing page',
        tool: null,
        dependencies: []
      })
    ]);

    const expanded = expandPlannerTasks(planner, {
      goal: 'Create a landing page',
      projectType: 'vite',
      entryFiles: ['src/App.tsx'],
      scan: {
        discoveredFiles: ['package.json', 'src/App.tsx', 'src/main.tsx'],
        entryFiles: ['src/App.tsx'],
        buildCommands: [],
        runCommands: []
      },
      contextFiles: ['package.json', 'src/App.tsx', 'src/main.tsx'],
      fileContents: new Map()
    });

    assert.ok(expanded.length > 0);
    assert.ok(expanded[0].goal.includes('src/App.tsx'));
    assert.ok(logs.some(line => line.includes('[REASONING_TARGET_CANONICAL_SELECTED]')));
    assert.ok(!expanded.some(task => /src\/App\.(?:js|jsx)$/.test(task.goal || '')));
  } finally {
    restore();
  }
});

test('Phase 4.25-HF5: context consistency rejects non-canonical files', () => {
  const report = validateContextConsistency({
    facts: createProjectScanSnapshot({
      workspaceRoot: 'C:/workspace',
      projectType: 'vite',
      packageJsonFound: true,
      discoveredFiles: ['package.json', 'src/App.tsx']
    }),
    context: {
      packageJsonFound: true,
      discoveredFiles: ['package.json', 'src/index.jsx'],
      verifiedFiles: ['package.json'],
      blockedRecommendations: [],
      plannerPolicies: {}
    }
  });

  assert.equal(report.valid, false);
  assert.ok(report.violations.some(v => String(v.code || '') === 'CONTEXT_NON_CANONICAL_FILE_VIOLATION'));
});

test('Phase 4.25-HF5: PlanningContext preserves canonical discovered files', () => {
  const { context, validation } = buildPlanningContext({
    workspaceState: {
      existingFiles: ['package.json', 'src/App.tsx', 'src/main.tsx'],
      packageJsonFound: true
    },
    projectScan: createProjectScanSnapshot({
      workspaceRoot: 'C:/workspace',
      projectType: 'vite',
      packageJsonFound: true,
      packageJsonPath: 'package.json',
      discoveredFiles: ['package.json', 'src/App.tsx', 'src/main.tsx'],
      entryFiles: ['src/App.tsx', 'src/main.tsx']
    }),
    validatedAssumptions: [
      { path: 'package.json', source: 'classifier', confidence: 1, required: true, optional: false, verified: true },
      { path: 'src/App.tsx', source: 'classifier', confidence: 1, required: true, optional: false, verified: true },
      { path: 'src/main.tsx', source: 'classifier', confidence: 1, required: true, optional: false, verified: true }
    ]
  });

  assert.equal(validation.valid, true);
  assert.deepEqual([...context.discoveredFiles].sort(), ['package.json', 'src/App.tsx', 'src/main.tsx']);
  assert.ok(context.fileIsVerified('src/App.tsx'));
});
