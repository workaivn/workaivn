import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectScanSnapshot } from '../context/ProjectScanSnapshot.js';
import { createExecutionPlanner } from '../executionPlanner/executionPlanner.js';
import { generateArtifactCandidates, parseArtifactCandidateResponse } from '../planner/artifactCandidateGenerator.js';
import { verifyArtifactCandidates } from '../planner/artifactCandidateVerifier.js';

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

function makePlanningContext({
  workspaceFiles = [],
  projectType = 'vite',
  objective = ''
} = {}) {
  const workspace = {
    workspaceRoot: 'G:/langtuvn/ai_local',
    existingFiles: [...workspaceFiles]
  };
  const projectScan = createProjectScanSnapshot({
    workspaceRoot: workspace.workspaceRoot,
    projectType,
    packageJsonFound: workspaceFiles.some(file => file === 'package.json'),
    discoveredFiles: [...workspaceFiles]
  });

  return {
    workspace,
    workspaceRoot: workspace.workspaceRoot,
    projectScan,
    projectType,
    verifiedFiles: [],
    verifiedCommands: [],
    explicitRequestedNewFiles: [],
    requestedFileDetails: [],
    requestedFiles: [],
    plannedNewFiles: [],
    facts: {
      ...projectScan,
      objective,
      requestedFileDetails: [],
      requestedFiles: [],
      plannedNewFiles: []
    }
  };
}

test('Phase 5.05: parser tolerates fenced JSON, arrays, and single objects', () => {
  const fenced = parseArtifactCandidateResponse([
    'Here is the proposal:',
    '```json',
    '{',
    '  "artifacts": [',
    '    {',
    '      "name": "Primary application artifact",',
    '      "purpose": "Root UI composition",',
    '      "artifactKind": "source",',
    '      "suggestedPath": "src/App.tsx",',
    '      "origin": "model_candidate",',
    '      "authoritySource": "OBJECTIVE_AUTHORITY"',
    '    }',
    '  ]',
    '}',
    '```'
  ].join('\n'));
  assert.equal(fenced.success, true);
  assert.equal(fenced.candidates.length, 1);
  assert.equal(fenced.candidates[0].suggestedPath, 'src/App.tsx');

  const arrayParsed = parseArtifactCandidateResponse([
    {
      name: 'Style artifact',
      purpose: 'Shared styling surface',
      artifactKind: 'style',
      suggestedPath: 'src/styles.css',
      origin: 'objective',
      authoritySource: 'OBJECTIVE_AUTHORITY'
    }
  ]);
  assert.equal(arrayParsed.success, true);
  assert.equal(arrayParsed.candidates.length, 1);
  assert.equal(arrayParsed.candidates[0].artifactKind, 'style');

  const objectParsed = parseArtifactCandidateResponse({
    name: 'Validation artifact',
    purpose: 'Executable test surface',
    artifactKind: 'test',
    suggestedPath: 'src/main.test.tsx',
    origin: 'verified_context',
    authoritySource: 'VERIFIED_PLANNING_CONTEXT'
  });
  assert.equal(objectParsed.success, true);
  assert.equal(objectParsed.candidates.length, 1);
  assert.equal(objectParsed.candidates[0].suggestedPath, 'src/main.test.tsx');
});

test('Phase 5.05: bootstrap profile remains recommendation-only and does not become an artifact candidate', () => {
  const result = generateArtifactCandidates({
    objective: 'Create a React TypeScript landing page.',
    projectScanSnapshot: makePlanningContext({ workspaceFiles: [] }).projectScan,
    planningContext: makePlanningContext({ workspaceFiles: [] }),
    bootstrapRecommendations: [
      {
        id: 'react-vite-ts',
        origin: 'bootstrap_profile',
        authoritySource: 'RECOMMENDATION_ONLY',
        executable: false
      }
    ],
    policies: {
      ALLOW_PROJECT_INITIALIZATION: true,
      ALLOW_NEW_PROJECT_INITIALIZATION: true
    }
  });

  assert.ok(result.candidates.length > 0, 'expected artifact candidates from the objective');
  assert.equal(result.candidates.some(candidate => candidate.origin === 'bootstrap_profile'), false);
  assert.equal(result.candidates.some(candidate => candidate.authoritySource === 'RECOMMENDATION_ONLY'), false);
});

test('Phase 5.05: pathless candidates are blocked until path resolution succeeds', () => {
  const verification = verifyArtifactCandidates([
    {
      id: 'artifact-1',
      name: 'Primary application artifact',
      purpose: 'Root UI composition',
      artifactKind: 'source',
      suggestedPath: null,
      suggestedOperation: 'create',
      origin: 'objective',
      authoritySource: 'OBJECTIVE_AUTHORITY',
      dependencies: [],
      validationHints: [],
      evidence: ['objective: create a landing page']
    }
  ], {
    projectScanSnapshot: makePlanningContext({ workspaceFiles: [] }).projectScan,
    planningContext: makePlanningContext({ workspaceFiles: [] }),
    policies: {
      ALLOW_PROJECT_INITIALIZATION: true,
      ALLOW_NEW_PROJECT_INITIALIZATION: true
    }
  });

  assert.equal(verification.verifiedCandidates.length, 0);
  assert.equal(verification.pathResolutionRequired.length, 1);
  assert.equal(verification.rejectedCandidates.length, 0);
});

test('Phase 5.05: malformed model output logs MODEL_FORMAT_ERROR and produces no artifacts', () => {
  const { logs, restore } = captureLogs();
  try {
    const result = generateArtifactCandidates({
      objective: 'Create a React TypeScript landing page.',
      projectScanSnapshot: makePlanningContext({ workspaceFiles: [] }).projectScan,
      planningContext: makePlanningContext({ workspaceFiles: [] }),
      modelRequest: {
        messages: [{ role: 'user', content: 'Return JSON only.' }]
      },
      modelResponse: 'definitely not json',
      policies: {
        ALLOW_PROJECT_INITIALIZATION: true,
        ALLOW_NEW_PROJECT_INITIALIZATION: true
      }
    });

    assert.equal(result.usedModel, false);
    assert.equal(result.modelError?.code, 'MODEL_FORMAT_ERROR');
    assert.ok(logs.some(line => line.includes('[MODEL_FORMAT_ERROR]')));
    assert.ok(logs.some(line => line.includes('[ARTIFACT_CANDIDATE_PARSE_FAILED]')));
  } finally {
    restore();
  }
});

test('Phase 5.05: valid model candidate promotes to WRITE_FILE', () => {
  const { logs, restore } = captureLogs();
  try {
    const planningContext = makePlanningContext({ workspaceFiles: [] , objective: 'Create a React TypeScript landing page.' });
    const plan = createExecutionPlanner({
      objective: 'Create a React TypeScript landing page.',
      verifiedPlanningContext: planningContext,
      canonicalFileUniverse: [],
      plannerPolicies: {
        ALLOW_PROJECT_INITIALIZATION: true,
        ALLOW_NEW_PROJECT_INITIALIZATION: true
      },
      projectIntent: {
        prompt: 'Create a React TypeScript landing page.',
        objective: 'Create a React TypeScript landing page.'
      },
      projectScan: planningContext.projectScan,
      artifactCandidateModelRequest: {
        messages: [{ role: 'user', content: 'Return JSON only.' }]
      },
      artifactCandidateModelResponse: `{
        "artifacts": [
          {
            "name": "Main application shell",
            "purpose": "Root UI composition",
            "artifactKind": "source",
            "suggestedPath": "src/App.tsx",
            "origin": "model_candidate",
            "authoritySource": "OBJECTIVE_AUTHORITY",
            "suggestedOperation": "create",
            "dependencies": [],
            "validationHints": []
          }
        ]
      }`
    });

    assert.ok(Array.isArray(plan.tasks));
    assert.ok(plan.tasks.some(task => task.tool === 'WRITE_FILE' && task.targetFiles?.includes('src/App.tsx')));
    assert.ok(logs.some(line => line.includes('[ARTIFACT_CANDIDATE_GENERATION_START]')));
    assert.ok(logs.some(line => line.includes('[ARTIFACT_CANDIDATE_MODEL_REQUEST]')));
    assert.ok(logs.some(line => line.includes('[ARTIFACT_CANDIDATE_MODEL_RESPONSE]')));
    assert.ok(logs.some(line => line.includes('[ARTIFACT_CANDIDATE_CREATED]')));
    assert.ok(logs.some(line => line.includes('[ARTIFACT_CANDIDATE_VERIFIED]')));
    assert.ok(logs.some(line => line.includes('[ARTIFACT_CANDIDATE_PROMOTED]')));
    assert.ok(logs.some(line => line.includes('[WRITE_CANDIDATE_FROM_ARTIFACT]')));
    const writeCandidateCountLine = logs.find(line => line.includes('[WRITE_CANDIDATE_COUNT]'));
    assert.ok(writeCandidateCountLine);
    assert.ok(/"artifactTargets":[1-9]\d*/.test(writeCandidateCountLine));
  } finally {
    restore();
  }
});
