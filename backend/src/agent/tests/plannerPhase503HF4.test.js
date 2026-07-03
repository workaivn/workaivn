import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPlanningContext } from '../planner/context/PlanningContextBuilder.js';
import { createProjectScanSnapshot, getCanonicalWorkspaceFiles } from '../context/ProjectScanSnapshot.js';
import { assertExecutableUnit } from '../execution/ExecutionInputGuard.js';
import { createPlannerRuntimeState, resetPlannerRuntimeState } from '../planner/runtimeState.js';

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

test('Phase 5.03-HF4: recommendation-only files stay out of the canonical universe', () => {
  const { logs, restore } = captureLogs();
  try {
    const snapshot = createProjectScanSnapshot({
      workspaceRoot: 'C:/workspace',
      projectType: 'vite',
      packageJsonFound: true,
      packageJsonPath: 'package.json',
      discoveredFiles: ['package.json', 'src/main.jsx', 'src/App.jsx'],
      recommendationCandidates: ['src/faq.jsx', 'src/cta.jsx'],
      blockedRecommendations: ['src/features.jsx', 'src/footer.jsx']
    });

    const canonical = getCanonicalWorkspaceFiles(snapshot);

    assert.equal(canonical.has('src/faq.jsx'), false);
    assert.equal(canonical.has('src/cta.jsx'), false);
    assert.equal(canonical.has('src/features.jsx'), false);
    assert.equal(canonical.has('src/footer.jsx'), false);
    assert.ok(logs.some(line => line.includes('[CANONICAL_FILE_UNIVERSE_CREATED]')));
    assert.ok(logs.some(line => line.includes('"totalFiles"')));
  } finally {
    restore();
  }
});

test('Phase 5.03-HF4: explicit requested files are promoted into the canonical universe', () => {
  const planning = buildPlanningContext({
    workspaceState: {
      workspaceRoot: 'C:/workspace',
      existingFiles: ['src/math.js'],
      packageJsonFound: true
    },
    projectScan: createProjectScanSnapshot({
      workspaceRoot: 'C:/workspace',
      projectType: 'vite',
      packageJsonFound: true,
      packageJsonPath: 'package.json',
      discoveredFiles: ['package.json', 'src/math.js']
    }),
    validatedAssumptions: [],
    classifierRequestedFiles: [],
    explicitRequestedNewFiles: ['src/math.test.js']
  });

  assert.equal(planning.validation.valid, true);
  assert.ok(planning.context.discoveredFiles.includes('src/math.test.js'));
  assert.ok(planning.context.explicitRequestedNewFiles.includes('src/math.test.js'));
  assert.ok(planning.context.plannedFiles.includes('src/math.test.js'));
  assert.equal(planning.context.fileIsExplicitNew('src/math.test.js'), true);
});

test('Phase 5.03-HF4: non-canonical read access is blocked before filesystem resolution', () => {
  const unit = {
    id: 'unit-1',
    type: 'READ',
    targetFiles: ['src/math.js'],
    requiredReads: ['src/math.js'],
    authoritySource: 'verified_planning_context',
    authorityState: 'approved',
    approvedByFirewall: true,
    approvalId: 'approval:unit-1',
    metadata: { source: 'test' },
    executionContract: {
      requiredContext: {
        canonicalFileUniverse: ['src/math.js']
      }
    }
  };

  assert.throws(() => assertExecutableUnit(unit, {
    path: 'src/cta.jsx',
    toolName: 'READ_FILE'
  }), error => error?.code === 'NON_CANONICAL_FILE_BLOCKED');
});

test('Phase 5.03-HF4: runtime recommendation collections are reset at run start', () => {
  const { logs, restore } = captureLogs();
  try {
    const stale = createPlannerRuntimeState();
    stale.recommendationCandidates.push('src/cta.jsx');
    stale.blockedRecommendations.push('src/footer.jsx');
    stale.verifiedRecommendations.push('src/features.jsx');
    stale.generatedFiles.push('src/generated.jsx');
    stale.dependencyReleasedFiles.push('src/dependency.jsx');
    stale.plannerApprovedFiles.push('src/App.jsx');

    const reset = resetPlannerRuntimeState(stale);

    assert.equal(reset.recommendationCandidates.length, 0);
    assert.equal(reset.blockedRecommendations.length, 0);
    assert.equal(reset.verifiedRecommendations.length, 0);
    assert.equal(reset.generatedFiles.length, 0);
    assert.equal(reset.dependencyReleasedFiles.length, 0);
    assert.equal(reset.plannerApprovedFiles.length, 0);
    assert.ok(logs.some(line => line.includes('[PLANNER_RUNTIME_STATE_RESET]')));
  } finally {
    restore();
  }
});
