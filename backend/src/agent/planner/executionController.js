import { TaskStatus } from './plannerTypes.js';
import { executeTool } from '../toolExecutor.js';
import { generateRecoveryPlan, determineRecoveryType } from './recoveryPlanner.js';
import { generateId } from './plannerUtils.js';
import { getTaskTimeoutMs, getMaxAttempts, markTaskProgress, markTaskStall, shouldStallTask, buildTaskTimeoutReason } from './taskTimeout.js';
import { getTaskPriority, pickNextPlannerTask } from './priorityQueue.js';

const WRITE_TOOLS = new Set(['APPLY_PATCH', 'WRITE_FILE']);
const READ_TOOLS = new Set(['READ_FILE', 'LIST_FILES', 'SEARCH_CODE', 'SEARCH_SYMBOL']);

function _goalHasWriteIntent(goal) {
  return /\b(?:create|write|add|implement|generate|build|construct|modify|update|change|edit|patch|replace|refactor|fix|delete|remove)\b/i.test(String(goal || ''));
}

function _goalHasReadIntent(goal) {
  return /\b(?:read|open|inspect|check|review|show|display|print|dump|list)\b/i.test(String(goal || ''));
}

function _toolMatchesGoal(toolName, goal) {
  // If goal has clear intent, enforce matching
  const goalHasWrite = _goalHasWriteIntent(goal);
  const goalHasRead = _goalHasReadIntent(goal);
  if (WRITE_TOOLS.has(toolName) && goalHasWrite) return true;
  if (READ_TOOLS.has(toolName) && goalHasRead) return true;
  if (toolName === 'RUN_TERMINAL' && /\brun\b|\bcommand\b|\bexecute\b|\btest\b/i.test(goal)) return true;
  // If goal has ambiguous/generic intent (no clear read/write keywords), allow any tool
  if (!goalHasWrite && !goalHasRead) return true;
  // Goal has specific intent but tool doesn't match — prevent mismatch
  return false;
}

function findMatchingTask(planner, toolName, includeSuccess = false) {
  if (!planner) return null;
  const all = planner.graph.allNodes();
  if (all.length === 0) return null;
  const validStatuses = includeSuccess
    ? [TaskStatus.PENDING, TaskStatus.READY, TaskStatus.SUCCESS, TaskStatus.RECOVERING]
    : [TaskStatus.PENDING, TaskStatus.READY];
  // Prefer exact tool match
  const exact = all.filter(t =>
    validStatuses.includes(t.status) && t.tool === toolName
  );
  if (exact.length > 0) return exact[0];
  // Fallback: READY tasks without tool set (handles buildPlan CODING tasks)
  const validStatuses2 = includeSuccess
    ? [TaskStatus.READY, TaskStatus.SUCCESS]
    : [TaskStatus.READY];
  const candidates = all.filter(t => validStatuses2.includes(t.status) && !t.tool);
  if (candidates.length === 0) return null;
  // Phase 4.10+: Completion guard — prefer candidate whose goal matches the tool
  const matched = candidates.filter(t => _toolMatchesGoal(toolName, t.goal));
  if (matched.length > 0) {
    if (matched.length > 1) {
      console.log('[PLANNER_COMPLETION_GUARD]', { toolName, candidates: matched.length, pickingFirst: true });
    }
    return matched[0];
  }
  // No candidate matches tool — log and skip (prevent wrong tool from completing wrong task)
  console.log('[PLANNER_TASK_NOT_COMPLETE]', {
    tool: toolName,
    candidates: candidates.length,
    candidateGoals: candidates.map(t => (t.goal || '').substring(0, 80))
  });
  return null;
}

function findRecoveryTask(planner, toolName) {
  if (!planner) return null;
  const all = planner.graph.allNodes();
  const recovery = all.filter(t =>
    t.kind === 'RECOVERY' &&
    t.status === TaskStatus.READY &&
    t.tool === toolName
  );
  return recovery.length > 0 ? recovery[0] : null;
}

function hasRecoveryBeenAttempted(planner, taskId) {
  const node = planner.graph.getNode(taskId);
  if (!node) return false;
  for (const childId of node.children) {
    const child = planner.graph.getNode(childId);
    if (child && child.kind === 'RECOVERY') return true;
  }
  return false;
}

export function tryRecovery(planner, failedTask) {
  if (!planner || !failedTask) return { recoveryStarted: false };

  // Only one recovery plan per failed task
  if (hasRecoveryBeenAttempted(planner, failedTask.id)) {
    console.log('[PLANNER_RECOVERY_SKIPPED]', { id: failedTask.id, reason: 'Recovery already attempted' });
    return { recoveryStarted: false };
  }

  const recoveryType = determineRecoveryType(failedTask);
  if (!recoveryType) {
    console.log('[PLANNER_RECOVERY_SKIPPED]', { id: failedTask.id, tool: failedTask.tool, reason: 'No recovery strategy available' });
    return { recoveryStarted: false };
  }

  // Generate recovery plan
  const plan = generateRecoveryPlan(failedTask);
  if (!plan || plan.tasks.length === 0) {
    console.log('[PLANNER_RECOVERY_SKIPPED]', { id: failedTask.id, reason: 'Empty recovery plan' });
    return { recoveryStarted: false };
  }

  // Mark task as RECOVERING and add recovery tasks
  console.log('[PLANNER_RECOVERY_START]', { id: failedTask.id, kind: failedTask.kind, recoveryType, taskCount: plan.tasks.length });
  planner.markRecovering(failedTask.id);
  const addedIds = planner.addRecoveryTasks(failedTask.id, plan.tasks);

  return { recoveryStarted: true, recoveryTaskIds: addedIds, recoveryPlan: plan };
}

function handleStall(planner, toolName) {
  const modelTask = planner.getModelTask();
  if (!modelTask) return { handled: false };
  const now = Date.now();
  if (!modelTask.startedAt) {
    modelTask.startedAt = now;
    modelTask.timeoutMs = getTaskTimeoutMs(modelTask);
    modelTask.maxAttempts = getMaxAttempts(modelTask);
  }
  markTaskStall(modelTask, `Tool ${toolName} does not match task goal`);
  console.log('[PLANNER_STALL_DETECTED]', {
    taskId: modelTask.id,
    tool: modelTask.tool || 'CODING',
    actualTool: toolName,
    stallCount: modelTask.stallCount,
    attempts: modelTask.attempts,
    goal: (modelTask.goal || '').substring(0, 80),
    reason: modelTask.statusReason
  });
  const { stalled, reason: stallReason } = shouldStallTask(modelTask, now);
  if (stalled) {
    console.log('[PLANNER_TASK_ATTEMPT_LIMIT]', {
      taskId: modelTask.id,
      tool: modelTask.tool || 'CODING',
      stallCount: modelTask.stallCount,
      attempts: modelTask.attempts,
      reason: stallReason
    });
    const error = `Task stalled after ${modelTask.attempts} attempt(s): ${buildTaskTimeoutReason(modelTask)}`;
    planner.markFailure(modelTask.id, error);
    const branchType = planner.branchType(modelTask.id);
    if (branchType === 'FAILURE') {
      const recoveryResult = tryRecovery(planner, modelTask);
      if (recoveryResult.recoveryStarted) {
        console.log('[PLANNER_TASK_NEEDS_RECOVERY]', {
          taskId: modelTask.id,
          recoveryTaskIds: recoveryResult.recoveryTaskIds
        });
        return { handled: false, stalled: true, recoveryStarted: true, recoveryTaskIds: recoveryResult.recoveryTaskIds };
      }
    }
    return { handled: false, stalled: true, needsRevision: true };
  }
  return { handled: false, stalled: true };
}

function markTaskAttempt(task) {
  const now = Date.now();
  if (!task.startedAt) {
    task.startedAt = now;
    task.timeoutMs = getTaskTimeoutMs(task);
    task.maxAttempts = getMaxAttempts(task);
  }
  markTaskProgress(task, null);
}

export function notifyToolExecution(planner, toolName, args, result) {
  if (!planner) return { handled: false };

  // Check if this is a recovery task before checking regular tasks
  const recoveryTask = findRecoveryTask(planner, toolName);
  const task = recoveryTask || findMatchingTask(planner, toolName, false);
  if (!task) {
    // Phase 4.11: Stall detected — tool doesn't match any ready task
    return handleStall(planner, toolName);
  }

  // Phase 4.11: Mark progress on the matched task
  markTaskAttempt(task);

  const success = result?.success !== false;
  const isRecovery = task.kind === 'RECOVERY';

  if (success) {
    planner.markSuccess(task.id, { tool: toolName, args, result });
    const kind = isRecovery ? 'RECOVERY' : task.kind;
    console.log('[PLANNER_TASK_SUCCESS]', { id: task.id, kind, tool: toolName });
  } else {
    const error = (result?.error || `Tool ${toolName} failed`).slice(0, 200);
    planner.markFailure(task.id, error);
    const kind = isRecovery ? 'RECOVERY' : task.kind;
    console.log('[PLANNER_TASK_FAILURE]', { id: task.id, kind, tool: toolName, error });

    // If a recovery task itself fails, recovery fails — STOP
    if (isRecovery) {
      const parentId = findRecoveryParent(planner, task.id);
      if (parentId) {
        planner.markRecoveryFailed(parentId, `Recovery task ${task.id} failed: ${error}`);
        console.log('[PLANNER_RECOVERY_FAILED]', { id: parentId, failedRecoveryTask: task.id, error });
      }
      return { handled: true, taskId: task.id, status: 'FAILED', isRecovery: true };
    }

    // Phase 4.7: Recovery triggered by FAILURE branch, not hardcoded
    const branchType = planner.branchType(task.id);
    if (branchType === 'FAILURE') {
      const recoveryResult = tryRecovery(planner, task);
      if (recoveryResult.recoveryStarted) {
        return { handled: true, taskId: task.id, status: 'FAILED', recoveryStarted: true, recoveryTaskIds: recoveryResult.recoveryTaskIds };
      }
    }

    return { handled: true, taskId: task.id, status: 'FAILED' };
  }
  return { handled: true, taskId: task.id, status: success ? 'SUCCESS' : 'FAILED' };
}

function findRecoveryParent(planner, recoveryTaskId) {
  const node = planner.graph.getNode(recoveryTaskId);
  if (!node) return null;
  const visited = new Set([recoveryTaskId]);
  function walk(nodeId) {
    const n = planner.graph.getNode(nodeId);
    if (!n) return null;
    if (n.status === TaskStatus.RECOVERING) {
      return n.id;
    }
    for (const depId of n.dependencies) {
      if (visited.has(depId)) continue;
      visited.add(depId);
      const result = walk(depId);
      if (result) return result;
    }
    return null;
  }
  for (const depId of node.dependencies) {
    visited.add(depId);
    const result = walk(depId);
    if (result) return result;
  }
  return null;
}

export function isPlannerRecovering(planner) {
  if (!planner) return false;
  return planner.graph.allNodes().some(t => t.status === TaskStatus.RECOVERING);
}

export function hasRecoveryFailed(planner) {
  if (!planner) return false;
  return planner.graph.allNodes().some(t => t.status === TaskStatus.RECOVERY_FAILED);
}

export function getNextRecoveryTask(planner) {
  if (!planner) return null;
  const ready = planner.graph.allNodes().filter(t =>
    t.kind === 'RECOVERY' && t.status === TaskStatus.READY
  );
  return ready.length > 0 ? ready[0] : null;
}

export function hasReadyRecoveryTask(planner) {
  return getNextRecoveryTask(planner) !== null;
}

function collectAllDescendantRecoveryTasks(planner, taskId) {
  const results = [];
  const visited = new Set();
  function walk(nodeId) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = planner.graph.getNode(nodeId);
    if (!node) return;
    for (const childId of node.children) {
      if (visited.has(childId)) continue;
      const child = planner.graph.getNode(childId);
      if (child && child.kind === 'RECOVERY') {
        results.push(child);
        walk(childId);
      }
    }
  }
  walk(taskId);
  return results;
}

export function checkRecoveryCompletion(planner) {
  if (!planner) return { recoveryComplete: false };
  const recovering = planner.graph.allNodes().filter(t => t.status === TaskStatus.RECOVERING);
  for (const task of recovering) {
    const recoveryTasks = collectAllDescendantRecoveryTasks(planner, task.id);
    if (recoveryTasks.length === 0) continue;

    // If any descendant recovery task has FAILED, recovery has failed
    const anyFailed = recoveryTasks.some(t => t.status === TaskStatus.FAILED);
    if (anyFailed) {
      console.log('[PLANNER_RECOVERY_DESCENDANT_FAILED]', { id: task.id, failed: recoveryTasks.filter(t => t.status === TaskStatus.FAILED).map(t => t.id) });
      return { recoveryComplete: false, hasFailedDescendant: true };
    }

    // All descendant recovery tasks must be SUCCESS for recovery to complete
    const allSucceeded = recoveryTasks.every(t => t.status === TaskStatus.SUCCESS);
    if (allSucceeded) {
      planner.markRecovered(task.id);
      console.log('[PLANNER_RECOVERY_SUCCESS]', { id: task.id, kind: task.kind });
      return { recoveryComplete: true, recoveredTaskId: task.id };
    }
  }
  return { recoveryComplete: false };
}

export function canExecuteTool(planner, toolType) {
  if (!planner) return { allowed: true };
  const all = planner.graph.allNodes();
  const hasFailed = all.some(t => t.status === TaskStatus.FAILED);
  const hasBlocked = all.some(t => t.status === TaskStatus.BLOCKED);
  const hasRecoveryFailed = all.some(t => t.status === TaskStatus.RECOVERY_FAILED);
  const isRecovering = all.some(t => t.status === TaskStatus.RECOVERING);
  const hasRecoveryTasks = all.some(t => t.kind === 'RECOVERY' && (t.status === TaskStatus.PENDING || t.status === TaskStatus.READY));
  const failed = all.filter(t => t.status === TaskStatus.FAILED).map(t => `${t.id}: ${t.reason || 'Unknown'}`);
  const blocked = all.filter(t => t.status === TaskStatus.BLOCKED).map(t => `${t.id}: ${t.reason || 'Unknown'}`);

  // If recovery is active, allow recovery tasks to proceed
  if (isRecovering && hasRecoveryTasks) {
    return { allowed: true, isRecovering: true };
  }

  // If recovery failed, block everything
  if (hasRecoveryFailed) {
    return { allowed: false, reason: 'Recovery has FAILED. Cannot proceed.', failedTasks: failed, blockedTasks: blocked, recoveryFailed: true };
  }

  if (toolType === 'write' || toolType === 'read') {
    if (hasFailed) {
      return { allowed: false, reason: `Cannot ${toolType}: prior tasks have FAILED (${failed.join(', ')})`, failedTasks: failed, blockedTasks: blocked };
    }
    if (hasBlocked) {
      return { allowed: false, reason: `Cannot ${toolType}: prior tasks are BLOCKED (${blocked.join(', ')})`, failedTasks: failed, blockedTasks: blocked };
    }
    if (hasRecoveryFailed) {
      return { allowed: false, reason: 'Recovery has FAILED.', failedTasks: failed, blockedTasks: blocked };
    }
    return { allowed: true };
  }

  if (toolType === 'terminal') {
    if (hasFailed || hasBlocked || hasRecoveryFailed) {
      return {
        allowed: false,
        reason: `Planner has ${hasFailed ? 'FAILED' : hasBlocked ? 'BLOCKED' : 'RECOVERY_FAILED'} tasks. Blocking terminal.`,
        failedTasks: failed,
        blockedTasks: blocked
      };
    }
    return { allowed: true };
  }

  if (toolType === 'final') {
    if (hasFailed) {
      return {
        allowed: false,
        reason: `Cannot complete: planner tasks have FAILED (${failed.join(', ')})`,
        failedTasks: failed,
        blockedTasks: blocked
      };
    }
    if (hasBlocked) {
      return {
        allowed: false,
        reason: `Cannot complete: planner tasks are BLOCKED (${blocked.join(', ')})`,
        failedTasks: failed,
        blockedTasks: blocked
      };
    }
    if (hasRecoveryFailed) {
      return {
        allowed: false,
        reason: 'Cannot complete: recovery has FAILED.',
        failedTasks: failed,
        blockedTasks: blocked
      };
    }
    if (isRecovering) {
      return {
        allowed: false,
        reason: 'Cannot complete: recovery is in progress.',
        isRecovering: true
      };
    }
    return { allowed: true };
  }

  return { allowed: true };
}

export async function validatePackageJsonAfterWrite(planner, toolName, args, result, toolContext) {
  if (!planner || !WRITE_TOOLS.has(toolName)) return { valid: true };

  const filePath = result?.file || args?.file || args?.path || '';
  const normalized = String(filePath || '').replace(/\\/g, '/').toLowerCase();
  if (!/(^|\/)package\.json$/i.test(normalized)) return { valid: true };

  try {
    const readResult = await executeTool('READ_FILE', { path: normalized }, toolContext);
    if (!readResult?.success || !readResult?.content) {
      return { valid: false, error: `Cannot read ${normalized} for post-write validation` };
    }
    JSON.parse(readResult.content);
    console.log('[PACKAGE_JSON_VALIDATION_OK]', { file: normalized });
    return { valid: true };
  } catch (err) {
    const error = `Invalid JSON in ${normalized} after ${toolName}: ${err.message}`;
    console.log('[PACKAGE_JSON_VALIDATION_FAILED]', { file: normalized, error });
    const task = findMatchingTask(planner, toolName, true);
    if (task) {
      planner.markFailure(task.id, error);
    }
    return { valid: false, error, taskId: task?.id || null };
  }
}

export function logPlannerStatus(planner) {
  if (!planner) return;
  const all = planner.graph.allNodes();
  if (all.length === 0) return;
  const summary = {};
  for (const task of all) {
    const s = task.status;
    summary[s] = (summary[s] || 0) + 1;
  }
  console.log('[PLANNER_EXECUTION_STATUS]', summary);
}
