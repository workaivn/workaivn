import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectScanSnapshot } from '../context/ProjectScanSnapshot.js';
import { buildPlanningContext } from '../planner/context/PlanningContextBuilder.js';
import { resolveWorkspaceCapabilities } from '../../planner/workspaceCapability/capabilityResolver.js';

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

function makeScan({
  projectType = 'generic',
  files = []
} = {}) {
  return createProjectScanSnapshot({
    workspaceRoot: 'G:/langtuvn/ai_local',
    projectType,
    packageJsonFound: files.includes('package.json'),
    packageJsonPath: files.includes('package.json') ? 'package.json' : null,
    entryFiles: files.filter(file => /(^|\/)(src\/main|src\/app|app\/page)\.(tsx|jsx|ts|js)|index\.html$/i.test(file)),
    styleFiles: files.filter(file => /\.(css|scss|sass|less)$/i.test(file)),
    discoveredFiles: files
  });
}

test('Phase 5.15: empty workspace marks APPLICATION_ENTRY as missing and initialization eligible', () => {
  const { logs, restore } = captureLogs();
  try {
    const scan = makeScan({ projectType: 'generic', files: [] });
    const planningContext = buildPlanningContext({
      workspaceState: {
        workspaceRoot: 'G:/langtuvn/ai_local',
        existingFiles: []
      },
      projectScan: scan,
      projectIntent: {
        prompt: 'Create a new application entry',
        objective: 'Create a new application entry',
        goalType: 'LANDING_PAGE'
      },
      validatedAssumptions: []
    }).context;

    const result = resolveWorkspaceCapabilities({
      requirements: [
        {
          id: 'req-entry',
          capability: 'APPLICATION_ENTRY',
          artifactType: 'source',
          required: true,
          confidence: 0.95,
          source: 'objective_semantic'
        }
      ],
      projectScanSnapshot: scan,
      planningContext,
      objective: 'Create a new application entry'
    });

    assert.equal(result.capabilitySatisfaction.statuses[0].status, 'MISSING');
    assert.equal(result.capabilitySatisfaction.statuses[0].initializationEligible, true);
    assert.equal(result.capabilityCoverage.coverage, 0);
    assert.ok(result.capabilityGapGraph.nodes.length === 1);
    assert.ok(result.missingCapabilityGraph.nodes.length === 1);
    assert.ok(logs.some(line => line.includes('[CAPABILITY_SATISFACTION_START]')));
    assert.ok(logs.some(line => line.includes('[CAPABILITY_MISSING]')));
    assert.ok(logs.some(line => line.includes('[MISSING_CAPABILITY_GRAPH_CREATED]')));
    assert.ok(logs.some(line => line.includes('[CAPABILITY_SATISFACTION_COMPLETE]')));
  } finally {
    restore();
  }
});

test('Phase 5.15: existing application entry is satisfied and reused', () => {
  const scan = makeScan({
    projectType: 'vite',
    files: ['src/main.tsx', 'src/App.tsx', 'src/styles.css']
  });
  const planningContext = buildPlanningContext({
    workspaceState: {
      workspaceRoot: 'G:/langtuvn/ai_local',
      existingFiles: scan.discoveredFiles
    },
    projectScan: scan,
    projectIntent: {
      prompt: 'Build a React landing page',
      objective: 'Build a React landing page',
      goalType: 'LANDING_PAGE'
    },
    validatedAssumptions: []
  }).context;

  const result = resolveWorkspaceCapabilities({
    requirements: [
      {
        id: 'req-entry',
        capability: 'APPLICATION_ENTRY',
        artifactType: 'source',
        required: true,
        confidence: 0.95,
        source: 'objective_semantic'
      }
    ],
    projectScanSnapshot: scan,
    planningContext,
    objective: 'Build a React landing page'
  });

  assert.equal(result.capabilitySatisfaction.statuses[0].status, 'SATISFIED');
  assert.equal(result.capabilitySatisfaction.statuses[0].plannerAction, 'REUSE');
  assert.ok(result.satisfiedCapabilityGraph.nodes.length === 1);
  assert.ok(result.plannerApprovedArtifacts.some(artifact => artifact.operation === 'REUSE'));
});

test('Phase 5.15: routing over App.tsx is partially satisfied and patched', () => {
  const scan = makeScan({
    projectType: 'vite',
    files: ['src/App.tsx']
  });
  const planningContext = buildPlanningContext({
    workspaceState: {
      workspaceRoot: 'G:/langtuvn/ai_local',
      existingFiles: scan.discoveredFiles
    },
    projectScan: scan,
    projectIntent: {
      prompt: 'Add routing',
      objective: 'Add routing',
      goalType: 'LANDING_PAGE'
    },
    validatedAssumptions: []
  }).context;

  const result = resolveWorkspaceCapabilities({
    requirements: [
      {
        id: 'req-routing',
        capability: 'ROUTING',
        artifactType: 'source',
        required: true,
        confidence: 0.9,
        source: 'objective_semantic'
      }
    ],
    projectScanSnapshot: scan,
    planningContext,
    objective: 'Add routing'
  });

  assert.equal(result.capabilitySatisfaction.statuses[0].status, 'PARTIALLY_SATISFIED');
  assert.equal(result.capabilitySatisfaction.statuses[0].plannerAction, 'PATCH');
  assert.ok(result.missingCapabilityGraph.nodes.length === 1);
});

test('Phase 5.15: empty workspace with many requirements still computes zero coverage and continues', () => {
  const scan = makeScan({ projectType: 'generic', files: [] });
  const planningContext = buildPlanningContext({
    workspaceState: {
      workspaceRoot: 'G:/langtuvn/ai_local',
      existingFiles: []
    },
    projectScan: scan,
    projectIntent: {
      prompt: 'Add capabilities',
      objective: 'Add capabilities',
      goalType: 'LANDING_PAGE'
    },
    validatedAssumptions: []
  }).context;

  const requirements = Array.from({ length: 30 }, (_, index) => ({
    id: `req-${index + 1}`,
    capability: `CAPABILITY_${index + 1}`,
    artifactType: 'source',
    required: true,
    confidence: 0.5,
    source: 'objective_semantic'
  }));

  const result = resolveWorkspaceCapabilities({
    requirements,
    projectScanSnapshot: scan,
    planningContext,
    objective: 'Add capabilities'
  });

  assert.equal(result.capabilitySatisfaction.statuses.length, 30);
  assert.equal(result.capabilitySatisfaction.missingCapabilities.length, 30);
  assert.equal(result.capabilityCoverage.coverage, 0);
  assert.ok(result.capabilityGapGraph.nodes.length === 30);
});

test('Phase 5.15: initialization allowed empty workspace produces initialization candidates from missing capabilities', () => {
  const scan = makeScan({ projectType: 'generic', files: [] });
  const planningContext = buildPlanningContext({
    workspaceState: {
      workspaceRoot: 'G:/langtuvn/ai_local',
      existingFiles: []
    },
    projectScan: scan,
    projectIntent: {
      prompt: 'Create a new React landing page',
      objective: 'Create a new React landing page',
      goalType: 'LANDING_PAGE'
    },
    validatedAssumptions: []
  }).context;

  const result = resolveWorkspaceCapabilities({
    requirements: [
      {
        id: 'req-entry',
        capability: 'APPLICATION_ENTRY',
        artifactType: 'source',
        required: true,
        confidence: 0.95,
        source: 'objective_semantic'
      },
      {
        id: 'req-style',
        capability: 'GLOBAL_STYLE',
        artifactType: 'style',
        required: true,
        confidence: 0.9,
        source: 'objective_semantic'
      }
    ],
    projectScanSnapshot: scan,
    planningContext,
    objective: 'Create a new React landing page'
  });

  assert.equal(result.capabilitySatisfaction.initializationCapabilities.length >= 1, true);
  assert.ok(result.artifactCandidates.length >= 1);
  assert.ok(result.executionCandidates.length >= 1);
});
