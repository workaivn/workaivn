import crypto from 'node:crypto';
import fs from 'node:fs';
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

function parseScriptName(command) {
  if (!command) return null;
  const match = String(command).match(/(?:npm|pnpm|yarn)\s+run\s+([^\s]+)/i);
  if (match) return match[1];
  const directMatch = String(command).match(/npm\s+(test|start|stop|restart)\b/i);
  if (directMatch) return directMatch[1];
  return null;
}

function analyzeTerminalRecovery(failedCommand) {
  const scriptName = parseScriptName(failedCommand);
  if (!scriptName) {
    // Not a script command — check if it's a direct executable
    return { recoverable: true, reason: 'non-script command — may be a direct executable', strategy: 'retry' };
  }

  // Read package.json eagerly to check if the script exists
  let pkg;
  try {
    const pkgRaw = fs.readFileSync('package.json', 'utf-8');
    pkg = JSON.parse(pkgRaw);
  } catch {
    // Can't read package.json — proceed with recovery (it will read it later)
    return { recoverable: true, reason: 'cannot read package.json — will attempt recovery read', strategy: 're_read' };
  }

  const scripts = pkg.scripts || {};
  if (scripts[scriptName]) {
    return { recoverable: true, reason: `script "${scriptName}" found`, strategy: 'retry' };
  }

  // Script not found — unrecoverable
  console.log('[PLANNER_RECOVERY_ANALYSIS]', {
    failedCommand,
    scriptName,
    reason: `Script "${scriptName}" not found in package.json`,
    availableScripts: Object.keys(scripts),
    recoverable: false
  });

  console.log('[PLANNER_RECOVERY_STOP]', {
    reason: 'no_build_script',
    failedCommand,
    scriptName,
    availableScripts: Object.keys(scripts).length ? Object.keys(scripts).join(', ') : '(none)'
  });

  return { recoverable: false, reason: `Script "${scriptName}" not found`, strategy: 'none' };
}

function buildTerminalRecovery(failedTask) {
  const command = failedTask.toolArgs?.command || '';

  // HOTFIX 1: Run recovery analysis BEFORE creating recovery tasks
  const analysis = analyzeTerminalRecovery(command);

  if (!analysis.recoverable) {
    console.log('[PLANNER_RECOVERY_SKIPPED]', {
      id: failedTask.id,
      tool: 'RUN_TERMINAL',
      reason: analysis.reason,
      strategy: analysis.strategy
    });
    return [];
  }

  const tasks = [];

  // Step 1: Read package.json to discover available scripts (if we couldn't read it already)
  if (analysis.strategy === 're_read') {
    tasks.push(new Task({
      id: generateId(),
      kind: RECOVERY_KIND,
      goal: 'Recovery: read package.json to discover scripts',
      tool: 'READ_FILE',
      toolArgs: { path: 'package.json' },
      dependencies: []
    }));
  }

  // Step 2: Re-run the command
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

  // HOTFIX 1: If no tasks were generated (e.g., unrecoverable terminal failure), return null type
  if (tasks.length === 0) {
    console.log('[PLANNER_RECOVERY_SKIPPED]', {
      id: failedTask.id,
      tool: failedTask.tool,
      reason: 'Recovery analysis determined this failure is not recoverable'
    });
    return { recoveryType: null, tasks: [] };
  }

  console.log('[PLANNER_RECOVERY_PLAN]', {
    failedTaskId: failedTask.id,
    recoveryType,
    taskCount: tasks.length,
    tasks: tasks.map(t => ({ id: t.id, tool: t.tool, goal: (t.goal || '').substring(0, 60) }))
  });

  return { recoveryType, tasks };
}
