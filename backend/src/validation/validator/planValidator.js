import { isCriticalTask, TASK_STATUSES } from './types.js';

function log(event, data) {
  console.log(`[${event}]`, data);
}

export function validatePlanCompletion({
  executionPlan = null,
  taskStates = [],
  terminalResults = [],
  changedFiles = [],
  codeGenResults = [],
  workspaceState = {}
} = {}) {
  log('VALIDATOR_PLAN_CHECK', { totalTasks: taskStates.length });

  const passed = [];
  const failed = [];
  const warnings = [];
  const missingTasks = [];
  const requiredFixes = [];

  if (!executionPlan && taskStates.length === 0) {
    log('VALIDATOR_PLAN_CHECK', { warning: 'No execution plan or task states provided' });
    return {
      passed,
      failed,
      warnings: ['No execution plan or task states to validate'],
      missingTasks: [],
      requiredFixes: []
    };
  }

  const planTasks = executionPlan?.tasks || [];
  const criticalTasks = planTasks.filter(t => isCriticalTask(t));
  const writeTasks = planTasks.filter(t => t.tool === 'WRITE_FILE' || t.kind === 'WRITE_FILE');
  const terminalTasks = planTasks.filter(t => t.tool === 'RUN_TERMINAL');

  const taskStatusMap = new Map();
  for (const state of taskStates) {
    const taskId = state.taskId || state.id;
    if (taskId) taskStatusMap.set(taskId, state);
  }

  const terminalResultMap = new Map();
  for (const r of terminalResults) {
    const cmd = r.command || r.args?.command || '';
    if (cmd) terminalResultMap.set(cmd.trim(), r);
  }

  for (const task of criticalTasks) {
    const state = taskStatusMap.get(task.id);
    const status = state?.status || state?.taskStatus || task.status || TASK_STATUSES.PENDING;

    if (status === TASK_STATUSES.SUCCESS || status === TASK_STATUSES.RECOVERED) {
      passed.push({ id: task.id, kind: task.kind, status, message: 'Critical task completed' });
    } else if (status === TASK_STATUSES.SKIPPED) {
      const reason = state?.reason || state?.skipReason || task.reason || '';
      if (reason) {
        warnings.push({ id: task.id, kind: task.kind, message: `Critical task skipped with reason: ${reason}` });
      } else {
        failed.push({ id: task.id, kind: task.kind, status, message: 'Critical task skipped without evidence-backed reason' });
        requiredFixes.push(`Critical task ${task.id} (${task.goal?.substring(0, 80)}) was skipped without an evidence-backed reason`);
      }
    } else if (status === TASK_STATUSES.FAILED || status === TASK_STATUSES.RECOVERY_FAILED) {
      failed.push({ id: task.id, kind: task.kind, status, message: `Critical task failed: ${state?.reason || task.reason || 'Unknown reason'}` });
      requiredFixes.push(`Critical task ${task.id} (${task.goal?.substring(0, 80)}) failed: ${state?.reason || task.reason || 'Unknown reason'}`);
    } else if (status === TASK_STATUSES.PENDING || status === TASK_STATUSES.READY || status === TASK_STATUSES.RUNNING) {
      missingTasks.push({ id: task.id, kind: task.kind, status, message: `Critical task not completed: ${status}` });
      requiredFixes.push(`Critical task ${task.id} (${task.goal?.substring(0, 80)}) is still ${status}`);
    } else if (status === TASK_STATUSES.BLOCKED || status === TASK_STATUSES.RECOVERING) {
      missingTasks.push({ id: task.id, kind: task.kind, status, message: `Critical task in blocked/recovering state: ${status}` });
      requiredFixes.push(`Critical task ${task.id} (${task.goal?.substring(0, 80)}) is ${status}`);
    }
  }

  for (const task of writeTasks) {
    if (!criticalTasks.includes(task)) {
      const state = taskStatusMap.get(task.id);
      const status = state?.status || state?.taskStatus || task.status || TASK_STATUSES.PENDING;

      if (status === TASK_STATUSES.SUCCESS || status === TASK_STATUSES.RECOVERED) {
        const filePath = task.toolArgs?.path || task.toolArgs?.file || '';
        if (filePath) {
          const normalizePath = (input) => {
            if (!input) return '';
            const str = typeof input === 'string' ? input : (input.path || input.file || input.filePath || '');
            if (!str) return '';
            return str.replace(/\\/g, '/').toLowerCase();
          };
          const fileExists = changedFiles.some(f => {
            const normalizedF = normalizePath(f);
            return normalizedF === normalizePath(filePath);
          });
          if (!fileExists) {
            warnings.push({ id: task.id, kind: task.kind, message: `WRITE_FILE task completed but file '${filePath}' not found in changedFiles evidence` });
          }
        }
      }
    }
  }

  for (const task of terminalTasks) {
    if (!criticalTasks.includes(task)) {
      const cmd = task.toolArgs?.command || '';
      if (cmd) {
        const hasTerminalEvidence = terminalResultMap.has(cmd.trim()) || stateHasCommandEvidence(task.id, taskStates, cmd);
        if (!hasTerminalEvidence) {
          warnings.push({ id: task.id, kind: task.kind, message: `RUN_TERMINAL task for '${cmd}' has no matching terminal evidence` });
        }
      }
    }
  }

  return { passed, failed, warnings, missingTasks, requiredFixes };
}

function stateHasCommandEvidence(taskId, taskStates, command) {
  for (const state of taskStates) {
    if ((state.taskId || state.id) === taskId) {
      const result = state.result || state.taskResult || {};
      const stdout = String(result.stdout || result.output || result.text || '').toLowerCase();
      const stderr = String(result.stderr || '').toLowerCase();
      const exitCode = result.exitCode != null ? result.exitCode : result.code;
      return exitCode === 0 || exitCode === undefined;
    }
  }
  return false;
}
