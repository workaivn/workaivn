import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { REQUESTED_FILE_KIND } from '../acceptanceCriteria.js';
import { createProjectScanSnapshot } from '../context/ProjectScanSnapshot.js';
import { createExecutionPlanner } from '../executionPlanner/executionPlanner.js';
import { applyPatchTool } from '../tools/applyPatch.js';

function createWorkspace(existingFiles = []) {
  return {
    workspaceRoot: 'G:/langtuvn/ai_local',
    existingFiles: [...existingFiles]
  };
}

function getWriteLikeTasks(plan) {
  return (Array.isArray(plan?.tasks) ? plan.tasks : []).filter(task => ['WRITE_FILE', 'APPLY_PATCH'].includes(String(task?.tool || '').toUpperCase()));
}

function makeVerifiedPlanningContext({
  workspaceFiles = [],
  requestedFileDetails = [],
  explicitRequestedNewFiles = [],
  verifiedFiles = [],
  projectType = 'vite',
  objective = ''
} = {}) {
  const workspace = createWorkspace(workspaceFiles);
  const projectScan = createProjectScanSnapshot({
    workspaceRoot: workspace.workspaceRoot,
    projectType,
    packageJsonFound: false,
    discoveredFiles: [...workspaceFiles]
  });
  const filePaths = requestedFileDetails.map(entry => entry.path);
  const contextFacts = {
    workspaceRoot: workspace.workspaceRoot,
    projectType,
    packageJsonFound: false,
    discoveredFiles: [...workspaceFiles],
    explicitRequestedFiles: [...explicitRequestedNewFiles],
    plannerApprovedFiles: [...filePaths],
    generatedFiles: [],
    dependencyReleasedFiles: [],
    requestedFileDetails: requestedFileDetails.map(entry => ({ ...entry })),
    requestedFiles: [...filePaths],
    plannedNewFiles: requestedFileDetails.filter(entry => entry.plannedNewFile === true).map(entry => entry.path)
  };

  return {
    workspace,
    workspaceRoot: workspace.workspaceRoot,
    projectScan,
    projectType,
    verifiedFiles: [...verifiedFiles],
    verifiedCommands: [],
    explicitRequestedNewFiles: [...explicitRequestedNewFiles],
    requestedFileDetails: requestedFileDetails.map(entry => ({ ...entry })),
    requestedFiles: [...filePaths],
    plannerApprovedFiles: [...filePaths],
    plannedNewFiles: requestedFileDetails.filter(entry => entry.plannedNewFile === true).map(entry => entry.path),
    facts: {
      ...contextFacts,
      objective
    }
  };
}

test('Phase 5.03-HF5: explicit creates map to WRITE_FILE, never APPLY_PATCH', () => {
  const verifiedPlanningContext = makeVerifiedPlanningContext({
    workspaceFiles: ['README.md'],
    requestedFileDetails: [
      {
        path: 'src/math.js',
        requestedKind: REQUESTED_FILE_KIND.EXPLICIT_CREATE,
        authoritySource: 'explicit_user_request',
        explicit: true,
        verified: false,
        plannedNewFile: true
      },
      {
        path: 'src/math.test.js',
        requestedKind: REQUESTED_FILE_KIND.EXPLICIT_CREATE,
        authoritySource: 'explicit_user_request',
        explicit: true,
        verified: false,
        plannedNewFile: true
      }
    ],
    explicitRequestedNewFiles: ['src/math.js', 'src/math.test.js'],
    objective: 'Create src/math.js and src/math.test.js'
  });

  const plan = createExecutionPlanner({
    objective: 'Create src/math.js and src/math.test.js',
    verifiedPlanningContext,
    canonicalFileUniverse: verifiedPlanningContext.facts.discoveredFiles,
    plannerPolicies: {},
    projectIntent: {
      prompt: 'Create src/math.js and src/math.test.js',
      objective: 'Create src/math.js and src/math.test.js'
    },
    projectScan: verifiedPlanningContext.projectScan
  });

  const writeTasks = getWriteLikeTasks(plan);
  assert.ok(writeTasks.length >= 2, 'expected write tasks for both created files');
  assert.ok(writeTasks.some(task => task.tool === 'WRITE_FILE' && task.targetFiles?.includes('src/math.js')));
  assert.ok(writeTasks.some(task => task.tool === 'WRITE_FILE' && task.targetFiles?.includes('src/math.test.js')));
  assert.equal(writeTasks.some(task => task.tool === 'APPLY_PATCH'), false);
});

test('Phase 5.03-HF5: existing file modifications use APPLY_PATCH', () => {
  const verifiedPlanningContext = makeVerifiedPlanningContext({
    workspaceFiles: ['src/math.js'],
    requestedFileDetails: [
      {
        path: 'src/math.js',
        requestedKind: REQUESTED_FILE_KIND.EXPLICIT_MODIFICATION,
        authoritySource: 'workspace_authority',
        explicit: true,
        verified: true,
        plannedNewFile: false
      }
    ],
    explicitRequestedNewFiles: [],
    verifiedFiles: ['src/math.js'],
    objective: 'Modify add() in src/math.js'
  });

  const plan = createExecutionPlanner({
    objective: 'Modify add() in src/math.js',
    verifiedPlanningContext,
    canonicalFileUniverse: verifiedPlanningContext.facts.discoveredFiles,
    plannerPolicies: {},
    projectIntent: {
      prompt: 'Modify add() in src/math.js',
      objective: 'Modify add() in src/math.js'
    },
    projectScan: verifiedPlanningContext.projectScan
  });

  const patchTask = getWriteLikeTasks(plan).find(task => task.tool === 'APPLY_PATCH' && task.targetFiles?.includes('src/math.js'));
  assert.ok(patchTask, 'expected APPLY_PATCH for existing file modification');
});

test('Phase 5.03-HF5: missing test file creation uses WRITE_FILE', () => {
  const verifiedPlanningContext = makeVerifiedPlanningContext({
    workspaceFiles: ['README.md'],
    requestedFileDetails: [
      {
        path: 'src/math.test.js',
        requestedKind: REQUESTED_FILE_KIND.EXPLICIT_CREATE,
        authoritySource: 'explicit_user_request',
        explicit: true,
        verified: false,
        plannedNewFile: true
      }
    ],
    explicitRequestedNewFiles: ['src/math.test.js'],
    objective: 'Create tests.'
  });

  const plan = createExecutionPlanner({
    objective: 'Create tests.',
    verifiedPlanningContext,
    canonicalFileUniverse: verifiedPlanningContext.facts.discoveredFiles,
    plannerPolicies: {},
    projectIntent: {
      prompt: 'Create tests.',
      objective: 'Create tests.'
    },
    projectScan: verifiedPlanningContext.projectScan
  });

  const writeTask = getWriteLikeTasks(plan).find(task => task.tool === 'WRITE_FILE' && task.targetFiles?.includes('src/math.test.js'));
  assert.ok(writeTask, 'expected WRITE_FILE for missing test file');
  assert.equal(getWriteLikeTasks(plan).some(task => task.tool === 'APPLY_PATCH' && task.targetFiles?.includes('src/math.test.js')), false);
});

test('Phase 5.03-HF5: APPLY_PATCH converts to WRITE_FILE when target file is missing', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'workai-patch-'));
  const result = await applyPatchTool({
    file: 'src/new-file.js',
    find: 'old',
    replace: 'export const answer = 42;\n',
    workspaceRoot,
    executionUnit: {
      id: 'unit-patch',
      type: 'PATCH',
      metadata: { source: 'test' },
      targetFiles: ['src/new-file.js'],
      authoritySource: 'verified_planning_context',
      authorityState: 'approved',
      approvedByFirewall: true,
      approvalId: 'approval:unit-patch',
      executionContract: {
        requiredContext: {
          canonicalFileUniverse: ['src/new-file.js']
        }
      }
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.convertedToWrite, true);
  assert.equal(result.created, true);
  assert.match(await fs.readFile(path.join(workspaceRoot, 'src', 'new-file.js'), 'utf8'), /answer = 42/);
});
