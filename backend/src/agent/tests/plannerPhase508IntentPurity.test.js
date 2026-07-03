import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectScanSnapshot } from '../context/ProjectScanSnapshot.js';
import { buildExecutionIntentGraph, validateIntentGraph } from '../planning/executionIntentGraph.js';

function makeContext({
  workspaceFiles = [],
  projectType = 'generic',
  packageJsonFound = false,
  testCommands = [],
  buildCommands = [],
  runCommands = [],
  verifiedCommands = [],
  verifiedFramework = null,
  verifiedValidation = null,
  bootstrapProfile = null
} = {}) {
  const projectScan = createProjectScanSnapshot({
    workspaceRoot: 'G:/langtuvn/ai_local',
    projectType,
    packageJsonFound,
    discoveredFiles: [...workspaceFiles],
    entryFiles: workspaceFiles.filter(file => /index\.(?:html|php)|app\/page\.(?:ts|tsx|js|jsx)|src\/main\.(?:ts|tsx|js|jsx)/i.test(file)),
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
    verifiedFiles: [...workspaceFiles],
    verifiedCommands: [...verifiedCommands],
    verifiedFramework,
    verifiedValidation,
    bootstrapProfile,
    derived: {
      verifiedFramework,
      verifiedValidation,
      verifiedCommands: [...verifiedCommands]
    },
    facts: {
      ...projectScan,
      verifiedFramework,
      verifiedValidation,
      verifiedCommands: [...verifiedCommands]
    }
  };
}

test('Phase 5.08: bootstrap cannot create intent capability', () => {
  const context = makeContext({
    projectType: 'generic',
    packageJsonFound: false,
    bootstrapProfile: { id: 'react-vite-ts', framework: 'react-vite-ts' }
  });

  const graph = buildExecutionIntentGraph({
    objective: 'Build a landing page.',
    projectIntent: {
      prompt: 'Build a landing page.',
      objective: 'Build a landing page.',
      requestedFramework: 'react-vite-ts',
      bootstrapProfile: { id: 'react-vite-ts' }
    },
    projectScanSnapshot: context.projectScan,
    planningContext: context,
    requestedFileDetails: [],
    artifactCandidates: [],
    verifiedCommands: []
  });

  const frameworkNode = graph.nodes.find(node => node.intent === 'FRAMEWORK_DISCOVERY');
  assert.ok(frameworkNode);
  assert.equal(frameworkNode.capability, null);
  assert.equal(graph.nodes.some(node => String(node.capability || '').toUpperCase() === 'REACT/VITE-TS'), false);
});

test('Phase 5.08: no verified command means no RUN_TEST or RUN_BUILD', () => {
  const context = makeContext({
    workspaceFiles: ['package.json'],
    projectType: 'generic',
    packageJsonFound: true,
    testCommands: [],
    buildCommands: [],
    runCommands: [],
    verifiedCommands: []
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
    artifactCandidates: [],
    verifiedCommands: []
  });

  assert.ok(validateIntentGraph(graph).valid);
  assert.equal(graph.nodes.some(node => String(node.intent || '').startsWith('RUN_')), false);
});

test('Phase 5.08: explicit files still generate intents', () => {
  const context = makeContext({
    workspaceFiles: ['package.json'],
    projectType: 'generic',
    packageJsonFound: true,
    verifiedCommands: []
  });

  const graph = buildExecutionIntentGraph({
    objective: 'Create src/math.js and src/math.test.js.',
    projectIntent: { prompt: 'Create src/math.js and src/math.test.js.' },
    projectScanSnapshot: context.projectScan,
    planningContext: context,
    requestedFileDetails: [
      { path: 'src/math.js', requestedKind: 'EXPLICIT_CREATE', required: true, confidence: 0.9, source: 'EXPLICIT_USER_REQUEST' },
      { path: 'src/math.test.js', requestedKind: 'EXPLICIT_CREATE', required: true, confidence: 0.9, source: 'EXPLICIT_USER_REQUEST' }
    ],
    artifactCandidates: []
  });

  assert.ok(graph.nodes.some(node => node.intent === 'GENERATE_SOURCE'));
  assert.ok(graph.nodes.some(node => node.intent === 'GENERATE_TEST'));
  assert.equal(graph.nodes.find(node => node.id.includes('generate_source:src/math.js'))?.source, 'EXPLICIT_USER_REQUEST');
  assert.equal(graph.nodes.find(node => node.id.includes('generate_test:src/math.test.js'))?.source, 'EXPLICIT_USER_REQUEST');
});

test('Phase 5.08: landing prompt without mapped artifacts is blocked', () => {
  const context = makeContext({
    projectType: 'generic',
    packageJsonFound: false,
    verifiedCommands: []
  });

  const graph = buildExecutionIntentGraph({
    objective: 'Build SaaS landing page.',
    projectIntent: { prompt: 'Build SaaS landing page.' },
    projectScanSnapshot: context.projectScan,
    planningContext: context,
    requestedFileDetails: [],
    artifactCandidates: [],
    verifiedCommands: []
  });

  assert.equal(graph.blockedReason, 'PLANNER_BLOCKED_NO_APPROVED_INTENTS');
  assert.equal(graph.nodes.some(node => String(node.intent || '').startsWith('GENERATE_')), false);
  assert.equal(graph.nodes.some(node => String(node.intent || '').startsWith('RUN_')), false);
  assert.equal(graph.nodes.some(node => node.intent === 'FINALIZE'), false);
});

test('Phase 5.08: verified React workspace allows RUN_BUILD', () => {
  const context = makeContext({
    workspaceFiles: ['package.json', 'src/main.tsx', 'src/App.tsx', 'src/styles.css'],
    projectType: 'vite-react',
    packageJsonFound: true,
    verifiedFramework: 'vite-react',
    verifiedCommands: ['npm run build']
  });

  const graph = buildExecutionIntentGraph({
    objective: 'Create a React landing page.',
    projectIntent: { prompt: 'Create a React landing page.' },
    projectScanSnapshot: context.projectScan,
    planningContext: context,
    requestedFileDetails: [
      { path: 'src/App.tsx', requestedKind: 'EXPLICIT_CREATE', required: true, confidence: 0.9, source: 'EXPLICIT_USER_REQUEST' }
    ],
    artifactCandidates: [
      { path: 'src/App.tsx', source: 'VERIFIED_ARTIFACT_MAPPING', authoritySource: 'VERIFIED_ARTIFACT_MAPPING', confidence: 0.9 }
    ],
    verifiedCommands: ['npm run build']
  });

  const frameworkNode = graph.nodes.find(node => node.intent === 'FRAMEWORK_DISCOVERY');
  assert.ok(frameworkNode);
  assert.equal(frameworkNode.capability, 'REACT/VITE');
  assert.ok(graph.nodes.some(node => node.intent === 'RUN_BUILD'));
  assert.equal(graph.nodes.some(node => node.intent === 'RUN_TEST'), false);
});

