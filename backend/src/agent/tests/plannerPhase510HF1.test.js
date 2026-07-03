import assert from 'node:assert/strict';
import test from 'node:test';

import { validatePlannerAssumptions } from '../planner/assumptionValidator.js';
import { buildPlanningContext } from '../planner/context/PlanningContextBuilder.js';
import { resolveWorkspaceCapabilities } from '../../planner/workspaceCapability/capabilityResolver.js';
import { buildExecutionIntentGraph } from '../planning/executionIntentGraph.js';

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

function makeEmptyWorkspaceContext({
  requestedFileDetails = [],
  explicitRequestedNewFiles = []
} = {}) {
  return buildPlanningContext({
    workspaceState: {
      workspaceRoot: 'G:/langtuvn/ai_local',
      existingFiles: []
    },
    projectScan: {
      workspaceRoot: 'G:/langtuvn/ai_local',
      projectType: 'generic',
      packageJsonFound: false,
      discoveredFiles: []
    },
    projectIntent: {
      prompt: 'Create files in an empty workspace.',
      objective: 'Create files in an empty workspace.',
      goalType: 'LIBRARY'
    },
    validatedAssumptions: [],
    classifierRequestedFiles: requestedFileDetails,
    plannedWriteTargets: explicitRequestedNewFiles,
    explicitRequestedNewFiles
  }).context;
}

test('Phase 5.10-HF1: empty workspace explicit create is accepted without rejection', () => {
  const { logs, restore } = captureLogs();
  try {
    const assumptions = validatePlannerAssumptions({
      workspaceState: {
        workspaceRoot: 'G:/langtuvn/ai_local',
        existingFiles: []
      },
      projectScan: {
        workspaceRoot: 'G:/langtuvn/ai_local',
        discoveredFiles: [],
        packageJsonFound: false
      },
      classifierRequestedFiles: [
        {
          path: 'src/math.js',
          kind: 'EXPLICIT_CREATE',
          authoritySource: 'explicit_user_request',
          explicit: true,
          verified: false
        }
      ],
      projectType: 'generic'
    });

    assert.equal(assumptions.length, 1);
    assert.equal(assumptions[0].verified, false);
    assert.ok(logs.some(line => line.includes('[PLANNER_ASSUMPTION_ACCEPTED_CREATE_MISSING]')));
    assert.equal(logs.some(line => line.includes('[PLANNER_ASSUMPTION_REJECTED]')), false);
  } finally {
    restore();
  }
});

test('Phase 5.10-HF1: missing discover-if-exists targets are skipped cleanly', () => {
  const { logs, restore } = captureLogs();
  try {
    const assumptions = validatePlannerAssumptions({
      workspaceState: {
        workspaceRoot: 'G:/langtuvn/ai_local',
        existingFiles: []
      },
      projectScan: {
        workspaceRoot: 'G:/langtuvn/ai_local',
        discoveredFiles: [],
        packageJsonFound: false
      },
      classifierRequestedFiles: [
        {
          path: 'package.json',
          kind: 'DISCOVER_IF_EXISTS',
          authoritySource: 'explicit_user_request',
          explicit: true,
          verified: false
        }
      ],
      projectType: 'generic'
    });

    assert.equal(assumptions.length, 1);
    assert.equal(assumptions[0].verified, false);
    assert.ok(logs.some(line => line.includes('[DISCOVER_IF_EXISTS_ABSENT]')));
    assert.equal(logs.some(line => line.includes('[PLANNER_ASSUMPTION_REJECTED]')), false);
  } finally {
    restore();
  }
});

test('Phase 5.10-HF1: package.json requested on empty workspace is tracked as requested artifact, not existing artifact', () => {
  const { logs, restore } = captureLogs();
  try {
    const context = makeEmptyWorkspaceContext({
      requestedFileDetails: [
        {
          path: 'package.json',
          kind: 'DISCOVER_IF_EXISTS',
          authoritySource: 'explicit_user_request',
          explicit: true,
          verified: false,
          plannedNewFile: false
        }
      ],
      explicitRequestedNewFiles: ['src/math.js', 'src/math.test.js']
    });

    const capabilityResolution = resolveWorkspaceCapabilities({
      requirements: [
        {
          id: 'req-package',
          capability: 'PROJECT_MANIFEST',
          artifactType: 'config',
          required: true,
          confidence: 0.9,
          source: 'objective_semantic'
        }
      ],
      projectScanSnapshot: context.facts,
      planningContext: context,
      objective: 'Create files in an empty workspace.'
    });

    const manifestCapability = capabilityResolution.workspaceCapabilities.find(entry => entry.capability === 'PROJECT_MANIFEST');
    assert.ok(manifestCapability);
    assert.equal(manifestCapability.existingArtifacts.length, 0);
    assert.ok(manifestCapability.requestedArtifacts.length > 0);
    assert.ok(logs.some(line => line.includes('[CAPABILITY_REQUESTED_ARTIFACT]')));
    assert.equal(context.plannedNewFiles.includes('package.json'), false);
  } finally {
    restore();
  }
});

test('Phase 5.10-HF1: package.json discover-only intent never becomes GENERATE_CONFIG', () => {
  const context = makeEmptyWorkspaceContext({
    requestedFileDetails: [
      {
        path: 'package.json',
        kind: 'DISCOVER_IF_EXISTS',
        authoritySource: 'explicit_user_request',
        explicit: true,
        verified: false,
        plannedNewFile: false
      }
    ]
  });

  const graph = buildExecutionIntentGraph({
    objective: 'Detect the framework if package.json exists.',
    projectIntent: {
      prompt: 'Detect the framework if package.json exists.',
      objective: 'Detect the framework if package.json exists.'
    },
    projectScanSnapshot: context.facts,
    planningContext: context,
    requestedFileDetails: context.requestedFileDetails,
    artifactCandidates: [],
    verifiedCommands: []
  });

  assert.ok(graph.nodes.some(node => node.intent === 'PACKAGE_DISCOVERY'));
  assert.equal(graph.nodes.some(node => node.intent === 'GENERATE_CONFIG'), false);
  const packageNode = graph.nodes.find(node => node.intent === 'PACKAGE_DISCOVERY');
  assert.ok(packageNode);
  assert.equal(packageNode.executionEligible, false);
});
