import assert from 'node:assert/strict';
import test from 'node:test';

import { createIntentNode, createIntentEdge, buildExecutionIntentGraph } from '../planning/executionIntentGraph.js';
import { projectExecutionGraph, validateProjection } from '../planning/executionProjection.js';

test('Phase 5.07-HF1: DISCOVER_IF_EXISTS projects to READ and never WRITE', () => {
  const graph = {
    objective: 'Inspect whether src/config.json exists.',
    nodes: [
      createIntentNode({
        id: 'intent:discover-file',
        intent: 'READ_CONTEXT',
        requestedKind: 'DISCOVER_IF_EXISTS',
        authoritySource: 'verified_planning_context',
        authority: { source: 'verified_planning_context' },
        outputs: { path: 'src/config.json' }
      })
    ],
    edges: []
  };

  const projection = projectExecutionGraph(graph, { projectScanSnapshot: { projectType: 'node' } });
  assert.equal(projection.validation.valid, true);
  assert.equal(projection.executionUnits.length, 1);
  assert.equal(projection.executionUnits[0].type, 'READ');
  assert.notEqual(projection.executionUnits[0].type, 'WRITE');
});

test('Phase 5.07-HF1: explicit create projects to WRITE', () => {
  const graph = {
    objective: 'Create src/math.js.',
    nodes: [
      createIntentNode({
        id: 'intent:create-file',
        intent: 'GENERATE_SOURCE',
        requestedKind: 'EXPLICIT_CREATE',
        authoritySource: 'explicit_user_request',
        authority: { source: 'explicit_user_request' },
        outputs: { path: 'src/math.js' }
      })
    ],
    edges: []
  };

  const projection = projectExecutionGraph(graph, { projectScanSnapshot: { projectType: 'node' } });
  assert.equal(projection.validation.valid, true);
  assert.equal(projection.executionUnits.length, 1);
  assert.equal(projection.executionUnits[0].type, 'WRITE');
  assert.equal(projection.executionUnits[0].authority?.source, 'explicit_user_request');
});

test('Phase 5.07-HF1: projection preserves intent dependencies exactly', () => {
  const graph = buildExecutionIntentGraph({
    objective: 'Create src/math.js and src/math.test.js then run tests.',
    projectIntent: { prompt: 'Create src/math.js and src/math.test.js then run tests.' },
    projectScanSnapshot: { projectType: 'node', packageJsonFound: true, testCommands: ['npm test'], entryFiles: [] },
    requestedFileDetails: [
      { path: 'src/math.js', requestedKind: 'EXPLICIT_CREATE', authoritySource: 'explicit_user_request' },
      { path: 'src/math.test.js', requestedKind: 'EXPLICIT_CREATE', authoritySource: 'explicit_user_request' }
    ],
    artifactCandidates: [
      { path: 'src/math.js', authoritySource: 'explicit_user_request' },
      { path: 'src/math.test.js', authoritySource: 'explicit_user_request' }
    ],
    verifiedCommands: ['npm test']
  });

  const projection = projectExecutionGraph(graph, {
    projectScanSnapshot: { projectType: 'node', packageJsonFound: true, testCommands: ['npm test'], entryFiles: [] },
    verifiedCommands: ['npm test']
  });

  assert.equal(projection.validation.valid, true);
  assert.equal(projection.executionUnits.length, graph.nodes.length);

  for (const node of graph.nodes) {
    const unit = projection.executionUnits.find(entry => entry.intentId === node.id || entry.id === node.id);
    assert.ok(unit, `Missing projected unit for ${node.id}`);
    assert.deepEqual(unit.dependencies, node.dependencies);
  }
});

test('Phase 5.07-HF1: removing a dependency causes fidelity failure', () => {
  const graph = buildExecutionIntentGraph({
    objective: 'Create src/math.js and src/math.test.js then run tests.',
    projectIntent: { prompt: 'Create src/math.js and src/math.test.js then run tests.' },
    projectScanSnapshot: { projectType: 'node', packageJsonFound: true, testCommands: ['npm test'], entryFiles: [] },
    requestedFileDetails: [
      { path: 'src/math.js', requestedKind: 'EXPLICIT_CREATE', authoritySource: 'explicit_user_request' },
      { path: 'src/math.test.js', requestedKind: 'EXPLICIT_CREATE', authoritySource: 'explicit_user_request' }
    ],
    artifactCandidates: [
      { path: 'src/math.js', authoritySource: 'explicit_user_request' },
      { path: 'src/math.test.js', authoritySource: 'explicit_user_request' }
    ],
    verifiedCommands: ['npm test']
  });

  const projection = projectExecutionGraph(graph, {
    projectScanSnapshot: { projectType: 'node', packageJsonFound: true, testCommands: ['npm test'], entryFiles: [] },
    verifiedCommands: ['npm test']
  });
  const tampered = projection.executionUnits.map(unit => ({ ...unit, dependencies: [...unit.dependencies] }));
  const target = tampered.find(unit => unit.dependencies.length > 0);
  assert.ok(target);
  target.dependencies = target.dependencies.slice(1);

  const validation = validateProjection(graph, tampered);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some(error => /Dependency mismatch/.test(error)));
});

test('Phase 5.07-HF1: projected execution graph keeps node count equal to intent node count', () => {
  const graph = buildExecutionIntentGraph({
    objective: 'Create src/math.js and src/math.test.js then run tests.',
    projectIntent: { prompt: 'Create src/math.js and src/math.test.js then run tests.' },
    projectScanSnapshot: { projectType: 'node', packageJsonFound: true, testCommands: ['npm test'], entryFiles: [] },
    requestedFileDetails: [
      { path: 'src/math.js', requestedKind: 'EXPLICIT_CREATE', authoritySource: 'explicit_user_request' },
      { path: 'src/math.test.js', requestedKind: 'EXPLICIT_CREATE', authoritySource: 'explicit_user_request' }
    ],
    artifactCandidates: [
      { path: 'src/math.js', authoritySource: 'explicit_user_request' },
      { path: 'src/math.test.js', authoritySource: 'explicit_user_request' }
    ],
    verifiedCommands: ['npm test']
  });

  const projection = projectExecutionGraph(graph, {
    projectScanSnapshot: { projectType: 'node', packageJsonFound: true, testCommands: ['npm test'], entryFiles: [] },
    verifiedCommands: ['npm test']
  });

  assert.equal(projection.executionUnits.length, graph.nodes.length);
  assert.equal(projection.validation.valid, true);
});
