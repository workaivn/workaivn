import crypto from 'node:crypto';
import { Task } from './task.js';

const RECOVERY_KIND = 'RECOVERY';

const READ_FILE_RECOVERY = 'READ_FILE_RECOVERY';
const PATCH_RECOVERY = 'PATCH_RECOVERY';
const TERMINAL_RECOVERY = 'TERMINAL_RECOVERY';

function generateId() {
  return crypto.randomUUID();
}

function buildReadFileRecovery(failedTask) {
  const goal = failedTask.goal || 'Read file';
  const filePath = failedTask.toolArgs?.path || '';
  const tasks = [];

  // Step 1: List files to locate the target file
  tasks.push(new Task({
    id: generateId(),
    kind: RECOVERY_KIND,
    goal: `Recovery: list files to find${filePath ? ` ${filePath}` : ''}`,
    tool: 'LIST_FILES',
    toolArgs: { limit: 500 },
    dependencies: []
  }));

  // Step 2: Retry reading the file
  tasks.push(new Task({
    id: generateId(),
    kind: RECOVERY_KIND,
    goal: `Recovery: read file${filePath ? ` ${filePath}` : ''}`,
    tool: 'READ_FILE',
    toolArgs: { path: filePath },
    dependencies: []
  }));

  return tasks;
}

function buildPatchRecovery(failedTask) {
  const filePath = failedTask.toolArgs?.file || '';
  const tasks = [];

  // Step 1: Read the latest file content
  tasks.push(new Task({
    id: generateId(),
    kind: RECOVERY_KIND,
    goal: `Recovery: read latest content of ${filePath || 'file'}`,
    tool: 'READ_FILE',
    toolArgs: { path: filePath },
    dependencies: []
  }));

  // Step 2: Re-apply the patch with corrected content
  tasks.push(new Task({
    id: generateId(),
    kind: RECOVERY_KIND,
    goal: `Recovery: re-apply patch to ${filePath || 'file'}`,
    tool: 'APPLY_PATCH',
    toolArgs: {
      file: filePath,
      find: failedTask.toolArgs?.find || '',
      replace: failedTask.toolArgs?.replace || ''
    },
    dependencies: []
  }));

  return tasks;
}

function buildTerminalRecovery(failedTask) {
  const command = failedTask.toolArgs?.command || '';
  const tasks = [];

  // Step 1: Read package.json to discover available scripts
  tasks.push(new Task({
    id: generateId(),
    kind: RECOVERY_KIND,
    goal: 'Recovery: read package.json to discover scripts',
    tool: 'READ_FILE',
    toolArgs: { path: 'package.json' },
    dependencies: []
  }));

  // Step 2: Re-run the command (after scripts have been read)
  tasks.push(new Task({
    id: generateId(),
    kind: RECOVERY_KIND,
    goal: `Recovery: run command${command ? ` ${command}` : ''}`,
    tool: 'RUN_TERMINAL',
    toolArgs: { command },
    dependencies: []
  }));

  return tasks;
}

export function determineRecoveryType(failedTask) {
  const tool = failedTask.tool || '';
  switch (tool) {
    case 'READ_FILE':
      return READ_FILE_RECOVERY;
    case 'APPLY_PATCH':
      return PATCH_RECOVERY;
    case 'RUN_TERMINAL':
      return TERMINAL_RECOVERY;
    default:
      return null;
  }
}

export function generateRecoveryPlan(failedTask) {
  if (!failedTask) return { recoveryType: null, tasks: [] };

  const recoveryType = determineRecoveryType(failedTask);
  if (!recoveryType) {
    console.log('[PLANNER_RECOVERY_SKIPPED]', { id: failedTask.id, tool: failedTask.tool, reason: 'No recovery strategy available' });
    return { recoveryType: null, tasks: [] };
  }

  let tasks = [];
  switch (recoveryType) {
    case READ_FILE_RECOVERY:
      tasks = buildReadFileRecovery(failedTask);
      break;
    case PATCH_RECOVERY:
      tasks = buildPatchRecovery(failedTask);
      break;
    case TERMINAL_RECOVERY:
      tasks = buildTerminalRecovery(failedTask);
      break;
  }

  console.log('[PLANNER_RECOVERY_PLAN]', {
    failedTaskId: failedTask.id,
    recoveryType,
    taskCount: tasks.length,
    tasks: tasks.map(t => ({ id: t.id, tool: t.tool, goal: (t.goal || '').substring(0, 60) }))
  });

  return { recoveryType, tasks };
}
