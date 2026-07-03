import assert from 'node:assert/strict';
import test from 'node:test';

import { assertExecutableUnit, assertExecutionGraphClean, filterExecutableUnits } from '../execution/ExecutionInputGuard.js';
import { createExecutionGraph } from '../executionPlanner/executionGraph.js';
import { buildRunFileMetadata } from '../runAgentLoop.js';

test('Phase 5.02: rejected recommendation units are blocked by the execution guard', () => {
  assert.throws(() => assertExecutableUnit({
    id: 'rec-1',
    type: 'WRITE',
    targetFiles: ['src/cta.jsx'],
    recommendationOnly: true,
    approvedByFirewall: false
  }, {
    path: 'src/cta.jsx',
    toolName: 'WRITE_FILE'
  }), error => error?.code === 'EXECUTION_INPUT_REJECTED');
});

test('Phase 5.02: approved units survive the guard and graph clean check', () => {
  const approvedUnit = {
    id: 'unit-1',
    type: 'WRITE',
    targetFiles: ['src/app.js'],
    authoritySource: 'verified_planning_context',
    authorityState: 'approved',
    approvedByFirewall: true,
    approvalId: 'approval:unit-1',
    metadata: { source: 'test' }
  };

  const filtered = filterExecutableUnits([approvedUnit]);
  assert.equal(filtered.executableUnits.length, 1);
  assert.equal(filtered.rejectedUnits.length, 0);

  const graph = createExecutionGraph(filtered.executableUnits);
  const clean = assertExecutionGraphClean(graph);
  assert.equal(clean.clean, true);
  assert.equal(clean.executableUnits.length, 1);
});

test('Phase 5.02: path mismatches are blocked before path resolution', () => {
  assert.throws(() => assertExecutableUnit({
    id: 'unit-2',
    type: 'WRITE',
    targetFiles: ['src/hero.jsx'],
    authoritySource: 'verified_planning_context',
    authorityState: 'approved',
    approvedByFirewall: true,
    approvalId: 'approval:unit-2',
    metadata: { source: 'test' }
  }, {
    path: 'src/cta.jsx',
    toolName: 'WRITE_FILE'
  }), error => error?.code === 'NON_EXECUTABLE_PATH_REJECTED');
});

test('Phase 5.02: blocked write attempts are excluded from summary accounting', () => {
  const metadata = buildRunFileMetadata({
    toolCalls: [
      {
        tool: 'WRITE_FILE',
        success: false,
        args: { path: 'src/cta.jsx' },
        error: 'WRITE_WITHOUT_EXECUTION_UNIT'
      }
    ]
  });

  assert.deepEqual(metadata.requestedWriteFiles, []);
  assert.deepEqual(metadata.plannedFiles, []);
  assert.deepEqual(metadata.generatedFiles, []);
  assert.deepEqual(metadata.validationRejectedFiles, []);
});
