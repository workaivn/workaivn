import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPlanningContext } from '../planner/context/PlanningContextBuilder.js';
import { createExecutionPlanner } from '../executionPlanner/executionPlanner.js';
import { promoteExecutionUnitToTask, promoteExecutionUnitsToTasks } from '../executionPlanner/plannerPromoter.js';
import { EXECUTION_UNIT_TYPES } from '../executionPlanner/executionUnit.js';
import { TaskKind } from '../planner/plannerTypes.js';
import { scanProject } from '../projectScanner.js';

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

function createAuthorityContext() {
  return {
    executionContract: {
      requiredContext: {
        verifiedPlanningContext: {
          verifiedFiles: ['src/app.js'],
          verifiedCommands: ['npm test']
        },
        canonicalFileUniverse: ['src/app.js'],
        plannerPolicies: {
          ALLOW_NEW_FILE_CREATION: true,
          ALLOW_EXISTING_PROJECT_MODIFICATION: true
        }
      }
    }
  };
}

test('Phase 4.30-HF7: requestedFileDetails is the only source for planned new files', () => {
  const context = buildPlanningContext({
    workspaceState: {
      workspaceRoot: 'G:/langtuvn/ai_local',
      existingFiles: ['src/app.js']
    },
    projectScan: {
      projectType: 'node',
      packageJsonFound: true,
      packageJsonPath: 'package.json',
      discoveredFiles: ['src/app.js']
    },
    validatedAssumptions: [],
    classifierRequestedFiles: [
      {
        path: 'src/math.js',
        kind: 'EXPLICIT_CREATE',
        authoritySource: 'explicit_user_request',
        explicit: true,
        conditional: false,
        verified: false
      },
      {
        path: 'package.json',
        kind: 'DISCOVER_IF_EXISTS',
        authoritySource: 'explicit_user_request',
        explicit: true,
        conditional: false,
        verified: false
      }
    ],
    plannedWriteTargets: ['src/math.js', 'package.json']
  }).context;

  assert.deepEqual(context.requestedFileDetails.map(entry => entry.path), ['src/math.js', 'package.json']);
  assert.deepEqual(context.plannedNewFiles, ['src/math.js']);
  assert.deepEqual(context.explicitRequestedNewFiles, ['src/math.js']);

  const packageEntry = context.requestedFileDetails.find(entry => entry.path === 'package.json');
  assert.ok(packageEntry);
  assert.equal(packageEntry.plannedNewFile, false);
});

test('Phase 4.30-HF7: ANALYZE stays internal and does not promote to a task', () => {
  const plan = createExecutionPlanner({
    objective: 'Inspect the workspace for the requested files.',
    verifiedPlanningContext: {
      verifiedFiles: ['src/app.js'],
      verifiedCommands: ['npm test'],
      requestedFileDetails: []
    },
    canonicalFileUniverse: ['src/app.js'],
    plannerPolicies: { ALLOW_PROJECT_BOOTSTRAP: false },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' }
  });

  assert.equal(plan.tasks.some(task => task.tool === 'LIST_FILES'), false);
  assert.equal(plan.tasks.some(task => !task.tool), false);
});

test('Phase 4.30-HF7: planner promoter maps WRITE-like units away from REASONING', () => {
  const writeTask = promoteExecutionUnitToTask({
    id: 'write:src/math.js',
    type: EXECUTION_UNIT_TYPES.WRITE,
    description: 'Write src/math.js',
    targetFiles: ['src/math.js'],
    requiredWrites: ['src/math.js'],
    authoritySource: 'explicit_user_request',
    authorityState: 'candidate',
    approvalId: 'approval:write-1',
    approvedByFirewall: true,
    metadata: {
      explicitUserRequest: true,
      requestedFile: true
    }
  }, createAuthorityContext());

  assert.ok(writeTask);
  assert.equal(writeTask.kind, TaskKind.GENERATE_CONTENT);
  assert.equal(writeTask.tool, 'WRITE_FILE');
  assert.equal(writeTask.approvedByFirewall, true);

  const validateTask = promoteExecutionUnitToTask({
    id: 'validate:run-tests',
    type: EXECUTION_UNIT_TYPES.VALIDATE,
    description: 'Validate with npm test',
    targetFiles: [],
    requiredWrites: [],
    inputs: { command: 'npm test' },
    outputs: { command: 'npm test' },
    authoritySource: 'verified_planning_context',
    authorityState: 'candidate',
    approvalId: 'approval:validate-1',
    approvedByFirewall: true
  }, createAuthorityContext());

  assert.ok(validateTask);
  assert.equal(validateTask.tool, 'RUN_TERMINAL');
  assert.equal(validateTask.kind, TaskKind.REASONING);

  const analyzeTask = promoteExecutionUnitToTask({
    id: 'analyze:workspace',
    type: EXECUTION_UNIT_TYPES.ANALYZE,
    description: 'Analyze workspace evidence',
    targetFiles: ['src/app.js'],
    authoritySource: 'verified_planning_context',
    authorityState: 'candidate'
  }, createAuthorityContext());

  assert.equal(analyzeTask, null);
});

test('Phase 4.30-HF7: task graph finalization logs stay ordered', () => {
  const { logs, restore } = captureLogs();
  try {
    const result = promoteExecutionUnitsToTasks([
      {
        id: 'write:src/app.js',
        type: EXECUTION_UNIT_TYPES.WRITE,
        description: 'Write src/app.js',
        targetFiles: ['src/app.js'],
        requiredWrites: ['src/app.js'],
        authoritySource: 'explicit_user_request',
        authorityState: 'candidate',
        approvalId: 'approval:write-ordered',
        approvedByFirewall: true,
        metadata: {
          explicitUserRequest: true,
          requestedFile: true
        }
      }
    ], createAuthorityContext());

    assert.equal(result.tasks.length, 1);
    const finalizingIndex = logs.findIndex(line => line.includes('[TASK_GRAPH_FINALIZING]'));
    const finalizedIndex = logs.findIndex(line => line.includes('[TASK_GRAPH_FINALIZED]'));
    assert.ok(finalizingIndex >= 0);
    assert.ok(finalizedIndex >= 0);
    assert.ok(finalizedIndex > finalizingIndex);
  } finally {
    restore();
  }
});

test('Phase 4.30-HF7: scanner does not emit a null test command', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'workai-scanner-'));
  try {
    await fs.writeFile(path.join(workspaceRoot, 'package.json'), JSON.stringify({
      name: 'scanner-test',
      scripts: {
        test: 'node --test'
      }
    }, null, 2), 'utf8');

    const scan = await scanProject(workspaceRoot);
    assert.deepEqual(scan.testCommands, ['npm test']);
    assert.equal(scan.testCommands.some(command => /^(null|undefined|false)\s+test$/i.test(command)), false);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
