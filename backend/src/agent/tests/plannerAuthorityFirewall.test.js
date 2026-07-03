import assert from 'node:assert/strict';
import test from 'node:test';

import { createExecutionPlanner } from '../executionPlanner/executionPlanner.js';
import { approvePlannerAuthority } from '../executionPlanner/plannerAuthorityFirewall.js';
import { ExecutionUnit } from '../executionPlanner/executionUnit.js';
import { Planner } from '../planner/planner.js';
import { Task } from '../planner/task.js';

test('Phase 4.28: execution planner approves candidate write units through the firewall', () => {
  const plan = createExecutionPlanner({
    objective: 'Update src/app.js',
    verifiedPlanningContext: {
      verifiedFiles: ['src/app.js'],
      verifiedCommands: ['npm test']
    },
    canonicalFileUniverse: ['src/app.js'],
    plannerPolicies: {
      ALLOW_EXISTING_PROJECT_MODIFICATION: true
    },
    projectIntent: {
      requestedFiles: ['src/app.js']
    },
    projectScan: {
      testCommands: ['npm test']
    }
  });

  const executableTasks = plan.tasks.filter(task => ['READ_FILE', 'WRITE_FILE', 'APPLY_PATCH', 'RUN_TERMINAL', 'VALIDATE'].includes(task.tool));
  assert.ok(executableTasks.length > 0, 'expected at least one executable task');
  for (const task of executableTasks) {
    assert.equal(task.approvedByFirewall, true);
    assert.ok(task.approvalId, 'approved tasks must have an approval id');
    assert.ok(task.authoritySource, 'approved tasks must carry authority source');
  }
});

test('Phase 4.28: model output authority is rejected by the firewall', () => {
  const result = approvePlannerAuthority({
    id: 'unit:model-output',
    type: 'WRITE',
    targetFiles: ['src/app.js'],
    authoritySource: 'model_output'
  }, {
    verifiedPlanningContext: {
      verifiedFiles: ['src/app.js']
    },
    canonicalFileUniverse: ['src/app.js'],
    plannerPolicies: {
      ALLOW_EXISTING_PROJECT_MODIFICATION: true
    }
  });

  assert.equal(result.valid, false);
  assert.match(result.validation.reason, /authority source is not executable|forbidden authority source|unknown authority source|authority missing/i);
});

test('Phase 4.28: execution units include firewall metadata', () => {
  const unit = new ExecutionUnit({
    id: 'unit-1',
    type: 'WRITE',
    description: 'Write file',
    targetFiles: ['src/app.js'],
    authoritySource: 'workspace_authority'
  });

  assert.equal(unit.authoritySource, 'workspace_authority');
  assert.equal(unit.authorityState, 'candidate');
  assert.equal(unit.approvedByFirewall, false);
  assert.equal(unit.approvalId, null);
});

test('Phase 4.28: recovery tasks are approved before insertion', () => {
  const planner = new Planner([
    new Task({
      id: 'base-task',
      kind: 'CODING',
      goal: 'Read source',
      tool: 'READ_FILE',
      toolArgs: { path: 'src/app.js' },
      authoritySource: 'workspace_authority',
      authorityState: 'approved',
      approvalId: 'approval:base',
      approvedByFirewall: true
    })
  ]);

  planner.authorityContext = {
    verifiedPlanningContext: {
      verifiedFiles: ['src/app.js'],
      verifiedCommands: ['npm test']
    },
    canonicalFileUniverse: ['src/app.js'],
    plannerPolicies: {
      ALLOW_EXISTING_PROJECT_MODIFICATION: true
    },
    workspaceState: {
      existingFiles: ['src/app.js']
    },
    projectScan: {
      testCommands: ['npm test']
    }
  };

  const added = planner.addRecoveryTasks('base-task', [
    new Task({
      id: 'rec-write',
      kind: 'RECOVERY',
      goal: 'Recovery write',
      tool: 'WRITE_FILE',
      toolArgs: { path: 'src/app.js' },
      authoritySource: 'validated_recovery',
      approvedByFirewall: true,
      approvalId: 'approval:recovery-write',
      canonicalTargets: ['src/app.js']
    }),
    new Task({
      id: 'rec-run',
      kind: 'RECOVERY',
      goal: 'Recovery run',
      tool: 'RUN_TERMINAL',
      toolArgs: { command: 'npm test' },
      authoritySource: 'validated_recovery',
      approvedByFirewall: true,
      approvalId: 'approval:recovery-run',
      canonicalTargets: ['src/app.js']
    })
  ]);

  assert.deepEqual(added, ['rec-write', 'rec-run']);
  assert.equal(planner.taskMap.get('rec-write').approvedByFirewall, true);
  assert.equal(planner.taskMap.get('rec-run').approvedByFirewall, true);
});
