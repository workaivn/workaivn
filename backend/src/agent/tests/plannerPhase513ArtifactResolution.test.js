import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectScanSnapshot } from '../context/ProjectScanSnapshot.js';
import { buildPlanningContext } from '../planner/context/PlanningContextBuilder.js';
import { resolveWorkspaceCapabilities } from '../../planner/workspaceCapability/capabilityResolver.js';
import { resolveArtifacts } from '../planning/artifactResolution/artifactResolver.js';
import { generateArtifactCandidates } from '../planner/artifactCandidateGenerator.js';

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
  projectType = 'vite',
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

test('Phase 5.13: workspace entry capability resolves to ENTRY patch without execution noise', () => {
  const { logs, restore } = captureLogs();
  try {
    const scan = makeScan({
      projectType: 'vite',
      files: ['package.json', 'index.html', 'src/main.js', 'src/App.jsx', 'src/styles.css']
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

    const capabilityResolution = resolveWorkspaceCapabilities({
      requirements: [
        {
          id: 'req-entry',
          capability: 'APPLICATION_ENTRY',
          artifactType: 'source',
          required: true,
          confidence: 0.96,
          source: 'objective_semantic'
        }
      ],
      projectScanSnapshot: scan,
      planningContext,
      objective: 'Build a React landing page'
    });
    const result = resolveArtifacts({
      mappedCapabilities: capabilityResolution.mappedCapabilities,
      requirements: [],
      workspaceCapabilities: capabilityResolution.workspaceCapabilities,
      planningContext,
      projectScanSnapshot: scan,
      objective: 'Build a React landing page'
    });

    assert.ok(result.artifactGraph);
    assert.equal(result.artifactGraph.nodes.length > 0, true);
    assert.equal(result.artifactGraph.nodes[0].role, 'ENTRY');
    assert.equal(result.operationPlan[0].operation, 'PATCH');
    assert.equal(result.plannerApprovedArtifacts[0].operation, 'PATCH');
    assert.equal(result.executionCandidates.length, 1);
    assert.ok(logs.some(line => line.includes('[ARTIFACT_RESOLUTION_START]')));
    assert.ok(logs.some(line => line.includes('[ARTIFACT_DISCOVERED]')));
    assert.ok(logs.some(line => line.includes('[ARTIFACT_ROLE_ASSIGNED]')));
    assert.ok(logs.some(line => line.includes('[PLANNER_ARTIFACT_APPROVED]')));
    assert.ok(logs.some(line => line.includes('[ARTIFACT_RESOLUTION_COMPLETE]')));
  } finally {
    restore();
  }
});

test('Phase 5.13: conflicting navigation artifacts collapse to one approved artifact', () => {
  const { logs, restore } = captureLogs();
  try {
    const result = resolveArtifacts({
      mappedCapabilities: [
        {
          id: 'cap-nav-a',
          capability: 'NAVIGATION',
          confidence: 0.91,
          evidence: ['nav evidence A'],
          existingArtifacts: [
            {
              file: 'src/components/Navbar.jsx',
              kind: 'navigation',
              confidence: 0.91,
              evidence: ['nav evidence A']
            }
          ],
          candidateArtifacts: [],
          plannerDecision: 'REUSE'
        },
        {
          id: 'cap-nav-b',
          capability: 'NAVIGATION',
          confidence: 0.74,
          evidence: ['nav evidence B'],
          existingArtifacts: [
            {
              file: 'src/components/Header.jsx',
              kind: 'navigation',
              confidence: 0.74,
              evidence: ['nav evidence B']
            }
          ],
          candidateArtifacts: [],
          plannerDecision: 'REUSE'
        }
      ],
      requirements: [],
      planningContext: {
        verifiedFiles: ['src/components/Navbar.jsx', 'src/components/Header.jsx']
      },
      projectScanSnapshot: makeScan({
        projectType: 'vite',
        files: ['src/components/Navbar.jsx', 'src/components/Header.jsx']
      }),
      objective: 'Resolve navigation surface'
    });

    assert.equal(result.plannerApprovedArtifacts.length, 1);
    assert.equal(result.operationPlan.length, 1);
    assert.ok(logs.some(line => line.includes('[ARTIFACT_CONFLICT_RESOLVED]')));
  } finally {
    restore();
  }
});

test('Phase 5.13: missing artifact becomes CREATE and is approved before execution', () => {
  const result = resolveArtifacts({
    mappedCapabilities: [
      {
        id: 'cap-hero',
        capability: 'HERO',
        confidence: 0.88,
        evidence: ['objective: hero section'],
        existingArtifacts: [],
        candidateArtifacts: [
          {
            file: 'src/components/HeroSection.jsx',
            kind: 'create',
            confidence: 0.88,
            evidence: ['objective: hero section']
          }
        ],
        plannerDecision: 'CREATE'
      }
    ],
    requirements: [],
    planningContext: {
      verifiedFiles: []
    },
    projectScanSnapshot: makeScan({ projectType: 'generic', files: [] }),
    objective: 'Add a hero section'
  });

  assert.equal(result.artifactGraph.nodes[0].role, 'SECTION');
  assert.equal(result.operationPlan[0].operation, 'CREATE');
  assert.equal(result.plannerApprovedArtifacts[0].operation, 'CREATE');
  assert.equal(result.executionCandidates.length, 1);
  assert.equal(result.executionCandidates[0].suggestedOperation, 'create');
});

test('Phase 5.13: generator returns only planner-approved execution candidates and keeps graph reasoning-only', () => {
  const scan = makeScan({
    projectType: 'vite',
    files: [
      'package.json',
      'index.html',
      'src/main.jsx',
      'src/App.jsx',
      'src/components/Navbar.jsx',
      'src/styles.css'
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
    const result = generateArtifactCandidates({
      objective: 'Build a React landing page',
      taskIntent: {
        prompt: 'Build a React landing page',
        objective: 'Build a React landing page',
        goalType: 'LANDING_PAGE'
      },
      planningContext,
      projectScanSnapshot: scan,
      policies: {
        ALLOW_PROJECT_INITIALIZATION: true,
        ALLOW_NEW_PROJECT_INITIALIZATION: true
      }
    });

    assert.ok(Array.isArray(result.candidates));
    assert.ok(result.candidates.every(candidate => candidate.plannerApproved === true));
    assert.ok(Array.isArray(result.artifactGraph?.nodes));
    assert.ok(result.artifactGraph.nodes.every(node => !('tool' in node) && !('execution' in node)));
    assert.equal(result.executionCandidates.length, result.candidates.length);
    assert.ok(logs.some(line => line.includes('[ARTIFACT_GRAPH_CREATED]')));
    assert.ok(logs.some(line => line.includes('[ARTIFACT_GRAPH_VALID]')));
    assert.ok(logs.some(line => line.includes('[ARTIFACT_RESOLUTION_COMPLETE]')));
  } finally {
    restore();
  }
});
