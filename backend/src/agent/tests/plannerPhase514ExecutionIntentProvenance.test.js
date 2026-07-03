import assert from 'node:assert/strict';
import test from 'node:test';

import { buildExecutionIntentGraph } from '../planning/executionIntentGraph.js';
import { projectExecutionGraph } from '../planning/executionProjection.js';
import { validateExecutionIntentProvenance } from '../planning/executionIntentProvenance.js';

function makeApprovedArtifact(overrides = {}) {
  return {
    artifact: 'src/math.js',
    capability: 'APPLICATION_ENTRY',
    role: 'COMPONENT',
    operation: 'CREATE',
    confidence: 0.95,
    evidence: ['requirement:req-1'],
    ownership: { owner: 'planner' },
    lifecycle: { stage: 'approved' },
    plannerDecision: 'MISSING',
    plannerApproved: true,
    artifactId: 'artifact:approved-1',
    artifactHash: 'hash-approved-1',
    workspaceCapabilityId: 'workspace-capability:app-entry',
    semanticGoalId: 'goal:semantic-1',
    requirementId: 'requirement:req-1',
    planningStrategyId: 'strategy:1',
    constraintId: 'constraint:1',
    authoritySource: 'VERIFIED_ARTIFACT_MAPPING',
    requestedOperation: 'CREATE',
    requestedKind: 'EXPLICIT_CREATE',
    executionCapability: 'APPLICATION_ENTRY',
    executionParameters: { artifact: 'src/math.js', operation: 'CREATE' },
    dependencies: [],
    ...overrides
  };
}

test('Phase 5.14: execution intent builder projects approved artifact provenance without inference', () => {
  const graph = buildExecutionIntentGraph({
    objective: 'Build a landing page.',
    projectIntent: { prompt: 'Build a landing page.', objective: 'Build a landing page.' },
    plannerApprovedArtifacts: [
      makeApprovedArtifact({
        capability: 'TEST',
        role: 'TEST',
        artifact: 'src/math.test.js',
        artifactId: 'artifact:approved-test',
        artifactHash: 'hash-approved-test',
        workspaceCapabilityId: 'workspace-capability:test',
        semanticGoalId: 'goal:test-1',
        requirementId: 'requirement:test-1',
        planningStrategyId: 'strategy:test',
        constraintId: 'constraint:test',
        executionCapability: 'TEST',
        executionParameters: { artifact: 'src/math.test.js', operation: 'CREATE' },
        dependencies: []
      })
    ],
    projectScanSnapshot: { projectType: 'generic', packageJsonFound: false },
    planningContext: {
      plannerApprovedArtifacts: [makeApprovedArtifact({
        artifactId: 'artifact:approved-test',
        artifactHash: 'hash-approved-test'
      })]
    }
  });

  assert.equal(graph.blockedReason, null);
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.nodes[0].intent, 'GENERATE_TEST');
  assert.equal(graph.nodes[0].plannerArtifactId, 'artifact:approved-test');
  assert.equal(graph.nodes[0].provenance.artifactHash, 'hash-approved-test');
  assert.equal(graph.nodes[0].provenance.requirementId, 'requirement:test-1');
  assert.equal(graph.nodes[0].provenance.workspaceCapabilityId, 'workspace-capability:test');
});

test('Phase 5.14: provenance validation fails on hash mismatch', () => {
  const intent = {
    id: 'intent:approved-test',
    provenance: {
      plannerArtifactId: 'artifact:approved-test',
      artifactHash: 'hash-actual',
      requirementId: 'requirement:test-1',
      workspaceCapabilityId: 'workspace-capability:test',
      authoritySource: 'verified_artifact_mapping',
      dependencies: ['intent:dependency-test']
    },
    dependencies: ['intent:dependency-test']
  };

  const validation = validateExecutionIntentProvenance(intent, {
    plannerApprovedArtifacts: [
      makeApprovedArtifact({
        artifactId: 'artifact:approved-test',
        artifactHash: 'hash-different'
      })
    ]
  });

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('Planner hash mismatch'));
});

test('Phase 5.14: projected execution units preserve provenance', () => {
  const intentGraph = buildExecutionIntentGraph({
    objective: 'Build a landing page.',
    projectIntent: { prompt: 'Build a landing page.', objective: 'Build a landing page.' },
    plannerApprovedArtifacts: [
      makeApprovedArtifact()
    ],
    projectScanSnapshot: { projectType: 'generic', packageJsonFound: false },
    planningContext: {
      plannerApprovedArtifacts: [makeApprovedArtifact()]
    }
  });

  const projection = projectExecutionGraph(intentGraph, {
    plannerApprovedArtifacts: [makeApprovedArtifact()]
  });

  assert.equal(projection.validation.valid, true);
  assert.equal(projection.executionUnits.length, 1);
  assert.equal(projection.executionUnits[0].plannerArtifactId, 'artifact:approved-1');
  assert.equal(projection.executionUnits[0].provenance.artifactHash, 'hash-approved-1');
  assert.equal(projection.executionUnits[0].metadata.provenance.plannerArtifactId, 'artifact:approved-1');
});
