import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectScanSnapshot } from '../context/ProjectScanSnapshot.js';
import { createExecutionPlanner } from '../executionPlanner/executionPlanner.js';
import { buildExecutionIntentGraph, validateIntentGraph } from '../planning/executionIntentGraph.js';
import { calculateExecutionLevels, detectCycles, resolveExecutionDependencies, verifyDependencyIntegrity } from '../planning/dependencyResolver.js';
import { scheduleExecutionUnits } from '../executionPlanner/executionScheduler.js';

function makePlanningContext({
  workspaceFiles = [],
  projectType = 'vite',
  packageJsonFound = false,
  packageJsonPath = 'package.json',
  entryFiles = [],
  testCommands = [],
  buildCommands = [],
  runCommands = [],
  verifiedCommands = []
} = {}) {
  const projectScan = createProjectScanSnapshot({
    workspaceRoot: 'G:/langtuvn/ai_local',
    projectType,
    packageJsonFound,
    packageJsonPath,
    discoveredFiles: [...workspaceFiles],
    entryFiles: [...entryFiles],
    testCommands: [...testCommands],
    buildCommands: [...buildCommands],
    runCommands: [...runCommands]
  });

  return {
    workspaceRoot: 'G:/langtuvn/ai_local',
    workspace: {
      workspaceRoot: 'G:/langtuvn/ai_local',
      existingFiles: [...workspaceFiles]
    },
    projectScan,
    verifiedFiles: [],
    verifiedCommands: [...verifiedCommands],
    explicitRequestedNewFiles: [],
    requestedFileDetails: [],
    requestedFiles: [],
    plannedNewFiles: [],
    facts: {
      ...projectScan,
      requestedFiles: [],
      requestedFileDetails: [],
      plannedNewFiles: []
    }
  };
}

test('Phase 5.07: intent graph contains semantic nodes only', () => {
  const context = makePlanningContext({
    workspaceFiles: ['package.json'],
    packageJsonFound: true,
    projectType: 'node',
    testCommands: ['npm test'],
    verifiedCommands: ['npm test']
  });

  const graph = buildExecutionIntentGraph({
    objective: 'Create src/math.js and src/math.test.js then run tests.',
    projectIntent: { prompt: 'Create src/math.js and src/math.test.js then run tests.' },
    projectScanSnapshot: context.projectScan,
    planningContext: context,
    requestedFileDetails: [
      { path: 'src/math.js', requestedKind: 'EXPLICIT_CREATE', required: true, confidence: 0.9 },
      { path: 'src/math.test.js', requestedKind: 'EXPLICIT_CREATE', required: true, confidence: 0.9 }
    ],
    artifactCandidates: [
      { path: 'src/math.js', confidence: 0.9 },
      { path: 'src/math.test.js', confidence: 0.9 }
    ],
    verifiedCommands: ['npm test']
  });

  assert.ok(validateIntentGraph(graph).valid);
  assert.ok(graph.nodes.some(node => node.intent === 'READ_CONTEXT'));
  assert.ok(graph.nodes.some(node => node.intent === 'FRAMEWORK_DISCOVERY'));
  assert.ok(graph.nodes.some(node => node.intent === 'VALIDATION_DISCOVERY'));
  assert.ok(graph.nodes.some(node => node.intent === 'GENERATE_SOURCE'));
  assert.ok(graph.nodes.some(node => node.intent === 'GENERATE_TEST'));
  assert.ok(graph.nodes.some(node => node.intent === 'RUN_TEST'));
  assert.ok(graph.nodes.some(node => node.intent === 'VERIFY_RESULT'));
  assert.equal(graph.nodes.some(node => ['WRITE_FILE', 'READ_FILE', 'RUN_TERMINAL', 'PATCH_FILE'].includes(node.intent)), false);
});

test('Phase 5.07: React entry discovery precedes component generation', () => {
  const context = makePlanningContext({
    workspaceFiles: ['package.json', 'src/main.tsx', 'src/App.tsx', 'src/styles.css'],
    packageJsonFound: true,
    projectType: 'vite',
    entryFiles: ['src/main.tsx']
  });

  const graph = buildExecutionIntentGraph({
    objective: 'Create a React landing page.',
    projectIntent: { prompt: 'Create a React landing page.' },
    projectScanSnapshot: context.projectScan,
    planningContext: context,
    requestedFileDetails: [
      { path: 'src/App.tsx', requestedKind: 'EXPLICIT_CREATE', required: true, confidence: 0.9 },
      { path: 'src/styles.css', requestedKind: 'EXPLICIT_CREATE', required: true, confidence: 0.9 }
    ],
    artifactCandidates: [
      { path: 'src/App.tsx', confidence: 0.9 },
      { path: 'src/styles.css', confidence: 0.9 }
    ]
  });
  const levels = resolveExecutionDependencies(graph, {
    executionCandidates: [],
    planningContext: context,
    projectScanSnapshot: context.projectScan,
    objective: 'Create a React landing page.'
  }).levels;
  const entryLevel = levels.findIndex(level => level.some(node => node.intent === 'ENTRY_DISCOVERY'));
  const componentLevel = levels.findIndex(level => level.some(node => node.intent === 'GENERATE_COMPONENTS'));
  assert.ok(entryLevel >= 0);
  assert.ok(componentLevel >= 0);
  assert.ok(entryLevel < componentLevel);
});

test('Phase 5.07: unknown framework stops at framework discovery', () => {
  const context = makePlanningContext({
    workspaceFiles: ['README.md'],
    projectType: 'generic',
    packageJsonFound: false
  });

  const graph = buildExecutionIntentGraph({
    objective: 'Create something new.',
    projectIntent: { prompt: 'Create something new.' },
    projectScanSnapshot: context.projectScan,
    planningContext: context,
    requestedFileDetails: [],
    artifactCandidates: []
  });

  assert.ok(graph.nodes.some(node => node.intent === 'FRAMEWORK_DISCOVERY'));
  assert.equal(graph.nodes.some(node => node.intent.startsWith('GENERATE_')), false);
  assert.equal(graph.nodes.some(node => node.intent.startsWith('RUN_')), false);
});

test('Phase 5.07: selected React + Custom variant suppresses package.json fallback', () => {
  const context = makePlanningContext({
    workspaceFiles: [],
    projectType: 'generic',
    packageJsonFound: false
  });
  context.selectedImplementation = {
    selectedVariant: {
      frameworkKey: 'react-custom'
    }
  };

  const graph = buildExecutionIntentGraph({
    objective: 'Create a React landing page.',
    projectIntent: { prompt: 'Create a React landing page.' },
    projectScanSnapshot: context.projectScan,
    planningContext: context,
    requestedFileDetails: [],
    artifactCandidates: []
  });

  assert.equal(graph.frameworkKey, 'react-custom');
  assert.equal(graph.nodes.some(node => node.intent === 'ENTRY_DISCOVERY'), false);

  const resolution = resolveExecutionDependencies(graph, {
    executionCandidates: [],
    planningContext: context,
    projectScanSnapshot: context.projectScan,
    objective: 'Create a React landing page.'
  });

  assert.equal(
    resolution.executionUnits.some(unit => Array.isArray(unit.targetFiles) && unit.targetFiles.some(file => String(file || '').toLowerCase() === 'package.json')),
    false
  );
});

test('Phase 5.07: independent assets share the same dependency level', () => {
  const context = makePlanningContext({
    workspaceFiles: ['package.json'],
    packageJsonFound: true,
    projectType: 'vite'
  });

  const graph = buildExecutionIntentGraph({
    objective: 'Create icon, styles, and image assets.',
    projectIntent: { prompt: 'Create icon, styles, and image assets.' },
    projectScanSnapshot: context.projectScan,
    planningContext: context,
    requestedFileDetails: [
      { path: 'src/icon.svg', requestedKind: 'EXPLICIT_CREATE', required: true, confidence: 0.9 },
      { path: 'src/styles.css', requestedKind: 'EXPLICIT_CREATE', required: true, confidence: 0.9 },
      { path: 'src/hero.png', requestedKind: 'EXPLICIT_CREATE', required: true, confidence: 0.9 }
    ],
    artifactCandidates: [
      { path: 'src/icon.svg', confidence: 0.9 },
      { path: 'src/styles.css', confidence: 0.9 },
      { path: 'src/hero.png', confidence: 0.9 }
    ]
  });

  const resolution = resolveExecutionDependencies(graph, {
    executionCandidates: [],
    planningContext: context,
    projectScanSnapshot: context.projectScan,
    objective: 'Create icon, styles, and image assets.'
  });

  const levels = resolution.levels.filter(level => level.some(node => node.intent.startsWith('GENERATE_')));
  assert.ok(levels.length >= 1);
  const assetLevel = levels.find(level => level.some(node => ['GENERATE_ICON', 'GENERATE_STYLE', 'GENERATE_IMAGE'].includes(node.intent)));
  assert.ok(assetLevel);
  assert.ok(assetLevel.some(node => node.intent === 'GENERATE_ICON'));
  assert.ok(assetLevel.some(node => node.intent === 'GENERATE_STYLE'));
  assert.ok(assetLevel.some(node => node.intent === 'GENERATE_IMAGE'));
});

test('Phase 5.07: RUN_TEST never resolves before GENERATE_TEST', () => {
  const context = makePlanningContext({
    workspaceFiles: ['package.json'],
    packageJsonFound: true,
    projectType: 'node',
    testCommands: ['npm test'],
    verifiedCommands: ['npm test']
  });

  const graph = buildExecutionIntentGraph({
    objective: 'Create src/math.js and src/math.test.js then run tests.',
    projectIntent: { prompt: 'Create src/math.js and src/math.test.js then run tests.' },
    projectScanSnapshot: context.projectScan,
    planningContext: context,
    requestedFileDetails: [
      { path: 'src/math.js', requestedKind: 'EXPLICIT_CREATE', required: true, confidence: 0.9 },
      { path: 'src/math.test.js', requestedKind: 'EXPLICIT_CREATE', required: true, confidence: 0.9 }
    ],
    artifactCandidates: [
      { path: 'src/math.js', confidence: 0.9 },
      { path: 'src/math.test.js', confidence: 0.9 }
    ],
    verifiedCommands: ['npm test']
  });
  const resolution = resolveExecutionDependencies(graph, {
    executionCandidates: [],
    planningContext: context,
    projectScanSnapshot: context.projectScan,
    verifiedCommands: ['npm test'],
    objective: 'Create src/math.js and src/math.test.js then run tests.'
  });

  const testUnit = resolution.executionUnits.find(unit => unit.inputs?.intent === 'GENERATE_TEST' || unit.description.includes('math.test.js'));
  const runUnit = resolution.executionUnits.find(unit => String(unit.type || '').toUpperCase() === 'RUN_TERMINAL');
  assert.ok(testUnit);
  assert.ok(runUnit);
  assert.ok(runUnit.dependencies.includes(testUnit.id));

  const scheduler = scheduleExecutionUnits(resolution.executionGraph);
  assert.ok(Array.isArray(scheduler.levels));
  assert.ok(scheduler.levels.length >= 2);
});

test('Phase 5.07: dependency cycles are detected safely', () => {
  const cycles = detectCycles([
    { id: 'a', dependencies: ['b'] },
    { id: 'b', dependencies: ['c'] },
    { id: 'c', dependencies: ['a'] }
  ]);
  assert.ok(cycles.length > 0);

  const integrity = verifyDependencyIntegrity([
    { id: 'a', dependencies: ['b'] },
    { id: 'b', dependencies: ['c'] },
    { id: 'c', dependencies: ['a'] }
  ]);
  assert.equal(integrity.valid, false);
});

test('Phase 5.07: resolved execution graph only contains executable tool units', () => {
  const context = makePlanningContext({
    workspaceFiles: ['package.json'],
    packageJsonFound: true,
    projectType: 'node',
    testCommands: ['npm test'],
    verifiedCommands: ['npm test']
  });

  const plan = createExecutionPlanner({
    objective: 'Create src/math.js and src/math.test.js then run tests.',
    verifiedPlanningContext: {
      ...context,
      requestedFileDetails: [
        { path: 'src/math.js', requestedKind: 'EXPLICIT_CREATE', authoritySource: 'explicit_user_request', explicit: true, verified: false, plannedNewFile: true },
        { path: 'src/math.test.js', requestedKind: 'EXPLICIT_CREATE', authoritySource: 'explicit_user_request', explicit: true, verified: false, plannedNewFile: true }
      ],
      explicitRequestedNewFiles: ['src/math.js', 'src/math.test.js'],
      requestedFiles: ['src/math.js', 'src/math.test.js'],
      plannedNewFiles: ['src/math.js', 'src/math.test.js']
    },
    canonicalFileUniverse: context.projectScan.discoveredFiles,
    plannerPolicies: {},
    projectIntent: {
      prompt: 'Create src/math.js and src/math.test.js then run tests.',
      objective: 'Create src/math.js and src/math.test.js then run tests.'
    },
    projectScan: context.projectScan
  });

  assert.ok(plan.graph.allUnits().length > 0);
  assert.equal(plan.graph.allUnits().some(unit => ['READ', 'WRITE', 'PATCH', 'RUN_TERMINAL', 'VERIFY'].includes(String(unit.type || '').toUpperCase())), true);
  assert.equal(plan.graph.allUnits().some(unit => ['READ_CONTEXT', 'FRAMEWORK_DISCOVERY', 'VALIDATION_DISCOVERY'].includes(String(unit.type || '').toUpperCase())), false);
  const writeUnits = plan.graph.allUnits().filter(unit => String(unit.type || '').toUpperCase() === 'WRITE');
  const runUnits = plan.graph.allUnits().filter(unit => String(unit.type || '').toUpperCase() === 'RUN_TERMINAL');
  assert.ok(writeUnits.length >= 2);
  assert.ok(runUnits.length >= 1);
});
