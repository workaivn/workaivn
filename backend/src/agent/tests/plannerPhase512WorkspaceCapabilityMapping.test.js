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

function makeProjectScan({
  projectType = 'vite',
  files = []
} = {}) {
  return createProjectScanSnapshot({
    workspaceRoot: 'G:/langtuvn/ai_local',
    projectType,
    packageJsonFound: files.some(file => file === 'package.json'),
    packageJsonPath: files.some(file => file === 'package.json') ? 'package.json' : null,
    entryFiles: files.filter(file => /(^|\/)(src\/main|src\/app|app\/page)\.(tsx|jsx|ts|js)|index\.html$/i.test(file)),
    styleFiles: files.filter(file => /\.(css|scss|sass|less)$/i.test(file)),
    discoveredFiles: files
  });
}

test('Phase 5.12: workspace scan discovers capability evidence from verified files', () => {
  const { logs, restore } = captureLogs();
  try {
    const scan = makeProjectScan({
      projectType: 'vite',
      files: [
        'src/main.tsx',
        'src/App.tsx',
        'src/components/Navbar.tsx',
        'src/styles.css',
        'src/App.test.tsx',
        'package.json',
        'index.html'
      ]
    });

    const context = buildPlanningContext({
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

    assert.ok(context.workspaceCapabilities.some(capability => capability.capability === 'APPLICATION_ENTRY'));
    assert.ok(context.workspaceCapabilities.some(capability => capability.capability === 'NAVIGATION'));
    assert.ok(context.workspaceCapabilities.some(capability => capability.capability === 'GLOBAL_STYLE'));
    assert.ok(context.workspaceCapabilities.some(capability => capability.capability === 'PROJECT_MANIFEST'));
    assert.ok(context.capabilityEvidence.length > 0);
    assert.ok(logs.some(line => line.includes('[WORKSPACE_CAPABILITY_SCAN]')));
    assert.ok(logs.some(line => line.includes('[CAPABILITY_DISCOVERED]')));
    assert.ok(logs.some(line => line.includes('[CAPABILITY_EVIDENCE]')));
  } finally {
    restore();
  }
});

test('Phase 5.12: planner reuses verified workspace artifacts and creates missing capability candidates with evidence', () => {
  const scan = makeProjectScan({
    projectType: 'vite',
    files: [
      'src/main.tsx',
      'src/App.tsx',
      'src/components/Navbar.tsx',
      'src/styles.css',
      'package.json'
    ]
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

  const { logs, restore } = captureLogs();
  try {
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
          id: 'req-cta',
          capability: 'CTA',
          artifactType: 'source',
          required: true,
          confidence: 0.9,
          source: 'objective_semantic'
        }
      ],
      projectScanSnapshot: scan,
      planningContext,
      objective: 'Build a React landing page'
    });

    const reused = result.plannerApprovedArtifacts.find(artifact => artifact.capability === 'APPLICATION_ENTRY');
    assert.ok(reused);
    assert.equal(reused.operation, 'REUSE');
    assert.equal(reused.file.toLowerCase(), 'src/app.tsx');
    assert.ok(reused.plannerVerified);
    assert.equal(result.executionCandidates.some(candidate => candidate.suggestedPath === 'src/App.tsx'), false);

    const created = result.plannerApprovedArtifacts.find(artifact => artifact.capability === 'CTA');
    assert.ok(created);
    assert.equal(created.operation, 'CREATE');
    assert.ok(created.file);
    assert.ok(created.evidence.length > 0);
    assert.ok(result.executionCandidates.some(candidate => candidate.suggestedPath === created.file));
    assert.ok(logs.some(line => line.includes('[CAPABILITY_MAPPING]')));
    assert.ok(logs.some(line => line.includes('[PLANNER_APPROVED_ARTIFACT]')));
    assert.ok(logs.some(line => line.includes('[ARTIFACT_REUSED]')));
    assert.ok(logs.some(line => line.includes('[ARTIFACT_CREATE]')));
    assert.ok(logs.some(line => line.includes('[CAPABILITY_MAPPING_COMPLETE]')));
  } finally {
    restore();
  }
});

test('Phase 5.12: prompt text alone does not invent workspace artifacts when no evidence exists', () => {
  const scan = makeProjectScan({
    projectType: 'generic',
    files: []
  });
  const planningContext = buildPlanningContext({
    workspaceState: {
      workspaceRoot: 'G:/langtuvn/ai_local',
      existingFiles: []
    },
    projectScan: scan,
    projectIntent: {
      prompt: 'Add a CTA',
      objective: 'Add a CTA',
      goalType: 'LANDING_PAGE'
    },
    validatedAssumptions: []
  }).context;

  const result = resolveWorkspaceCapabilities({
    requirements: [
      {
        id: 'req-cta',
        capability: 'CTA',
        artifactType: 'source',
        required: true,
        confidence: 0.9,
        source: 'objective_semantic'
      }
    ],
    projectScanSnapshot: scan,
    planningContext,
    objective: 'Add a CTA'
  });

  assert.equal(result.plannerApprovedArtifacts.length, 0);
  assert.equal(result.executionCandidates.length, 0);
  assert.equal(result.artifactCandidates.length, 0);
  assert.equal(result.workspaceCapabilities.length, 0);
});
