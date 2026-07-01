import { TaskStatus } from './plannerTypes.js';
import { Task } from './task.js';
import { executeTool } from '../toolExecutor.js';
import { generateRecoveryPlan, determineRecoveryType, inferImplementationFromTestContent, buildRecoveryAssertionContext, analyzeValidationFailure, selectBestRecoveryFrame, assertValidRecoveryTaskPath, extractWorkspaceRelativeStacktracePath } from './recoveryPlanner.js';
import { evaluateExecutionStrategy } from '../strategy/index.js';
import { normalizeWorkspaceRelativePath } from '../workspace.js';
import { generateId } from './plannerUtils.js';
import { getTaskTimeoutMs, getMaxAttempts, markTaskProgress, markTaskStall, shouldStallTask, buildTaskTimeoutReason } from './taskTimeout.js';
import { getTaskPriority, pickNextPlannerTask } from './priorityQueue.js';
import { truncateRunText } from '../runPayload.js';

const WRITE_TOOLS = new Set(['APPLY_PATCH', 'WRITE_FILE']);
const READ_TOOLS = new Set(['READ_FILE', 'LIST_FILES', 'SEARCH_CODE', 'SEARCH_SYMBOL']);
const RECOVERY_TARGET_MISMATCH_BLOCKED = '__RECOVERY_TARGET_MISMATCH_BLOCKED__';

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

function findMatchingTask(planner, toolName, includeSuccess = false, preferredTaskId = null) {
  if (!planner) return null;
  const all = planner.graph.allNodes();
  if (all.length === 0) return null;
  const validStatuses = includeSuccess
    ? [TaskStatus.PENDING, TaskStatus.READY, TaskStatus.SUCCESS, TaskStatus.RECOVERING]
    : [TaskStatus.PENDING, TaskStatus.READY];

  if (preferredTaskId) {
    const preferred = planner.graph.getNode(preferredTaskId);
    if (preferred && validStatuses.includes(preferred.status)) {
      if (preferred.tool === toolName) return preferred;
      if (preferred.tool === 'WRITE_FILE' && toolName === 'APPLY_PATCH') return preferred;
    }
  }

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

function findRecoveryTask(planner, toolName, preferredTaskId = null) {
  if (!planner) return null;
  if (preferredTaskId) {
    const preferred = planner.graph.getNode(preferredTaskId);
    if (preferred && preferred.kind === 'RECOVERY' && preferred.tool === toolName) {
      return preferred;
    }
  }
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

function normalizeRecoveryPath(value, workspaceRoot) {
  return normalizeWorkspaceRelativePath(value, workspaceRoot);
}

function isGlobLikePath(value = '') {
  return /[*?]/.test(String(value || ''));
}

function toRecoveryPathList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  if (value instanceof Map) return [...value.keys()];
  return [value];
}

function pickLastRecoveryPath(value, workspaceRoot = '') {
  const list = toRecoveryPathList(value);
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const candidate = normalizeRecoveryPath(list[i], workspaceRoot);
    if (candidate) return candidate;
  }
  return null;
}

function extractRuntimeStacktraceTarget(validationContext = {}, workspaceRoot = '') {
  const text = [
    validationContext?.stderr,
    validationContext?.stdout,
    validationContext?.output,
    validationContext?.rawOutput
  ]
    .map(value => String(value || ''))
    .filter(Boolean)
    .join('\n');

  if (!text.trim()) return null;

  const lines = text.replace(/\r/g, '').split('\n');
  const patterns = [
    /(?:at\s+.*?\()?(?:file:\/\/\/?)?((?:\.{1,2}[\\/]|[A-Za-z0-9_.-]+[\\/])*?(?:src|app|backend|frontend|server|client|api|lib|core|controllers?|services?)[\\/][^():*?]+\.(?:js|jsx|ts|tsx|mjs|cjs|py|php|java|jsp|cs|html|css|json))(?::\d+:\d+)?\)?/i,
    /(?:at\s+.*?\()?(?:file:\/\/\/?)?((?:[A-Za-z]:[\\/]|\/)?[^():*?]+\.(?:js|jsx|ts|tsx|mjs|cjs|py|php|java|jsp|cs|html|css|json))(?::\d+:\d+)?\)?/i
  ];

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    if (!line || /^\[/.test(line)) continue;
    if (/node:internal|internal\//i.test(line)) continue;
    if (!/^at\s+/i.test(line) && !/file:\/\//i.test(line) && !/[A-Za-z]:[\\/]/.test(line) && !/[\\/](?:src|app|backend|frontend|server|client|api|lib|core|controllers?|services?)[\\/]/i.test(line)) {
      continue;
    }
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match?.[1]) continue;
      const candidate = extractWorkspaceRelativeStacktracePath(match[1], workspaceRoot);
      if (!candidate || /(?:^|\/)(?:tests?|__tests__|specs?)(?:\/|$)|(?:^|\/)(?:[^/]+?\.(?:test|spec))\.[jt]sx?$|(?:^|\/)test\.[jt]sx?$|(?:^|\/)spec\.[jt]sx?$|(?:^|\/)src\/test\.[jt]sx?$|(?:^|\/)src\/tests?\.[jt]sx?$/i.test(candidate) || isGlobLikePath(candidate)) continue;
      if (/node_modules|vendor|dist|build|coverage/i.test(candidate)) continue;
      return candidate;
    }
  }

  return null;
}

function getLatestSuccessfulWritePath(planner, workspaceRoot = '') {
  if (!planner?.executionHistory) return null;
  const history = planner.executionHistory;
  const completedTools = Array.isArray(history.completedTools) ? history.completedTools : [];
  for (let i = completedTools.length - 1; i >= 0; i -= 1) {
    const entry = completedTools[i] || {};
    if (entry.tool !== 'WRITE_FILE' && entry.tool !== 'APPLY_PATCH') continue;
    const candidate = normalizeRecoveryPath(entry.path || entry.target || entry.file, workspaceRoot);
    if (candidate) return candidate;
  }

  if (history.writtenFiles instanceof Map) {
    const writtenFiles = [...history.writtenFiles.keys()];
    for (let i = writtenFiles.length - 1; i >= 0; i -= 1) {
      const candidate = normalizeRecoveryPath(writtenFiles[i], workspaceRoot);
      if (candidate) return candidate;
    }
  }

  return null;
}

function getActiveFailedPhaseTargetFile(planner, failedTask, workspaceRoot = '') {
  if (!planner || !failedTask || failedTask.tool !== 'RUN_TERMINAL') return null;
  const visited = new Set();
  const stack = Array.isArray(failedTask.dependencies) ? [...failedTask.dependencies] : [];

  while (stack.length) {
    const taskId = stack.pop();
    if (!taskId || visited.has(taskId)) continue;
    visited.add(taskId);

    const task = planner.graph.getNode(taskId);
    if (!task) continue;
    if (task.tool === 'WRITE_FILE' || task.tool === 'APPLY_PATCH') {
      const target = task.toolArgs?.path || task.toolArgs?.file || task.toolArgs?.target;
      const normalized = normalizeRecoveryPath(target, workspaceRoot);
      if (normalized) return normalized;
    }

    if (Array.isArray(task.dependencies)) {
      stack.push(...task.dependencies);
    }
  }

  return null;
}

function resolveRecoveryTargetFile(planner, failedTask, context = {}) {
  const workspaceRoot = context.workspaceRoot || '';
  const failureAnalysis = analyzeValidationFailure(context.validationContext || {}, workspaceRoot);
  const failureType = String(failureAnalysis.failureType || '').trim();
  const runtimeFailure = /^(ReferenceError|TypeError|SyntaxError|ImportError|Module resolution error|Compilation error|Runtime exception)$/i.test(failureType);
  const runtimeFrame = runtimeFailure ? selectBestRecoveryFrame(failureAnalysis.stacktraceFrames || []) : null;
  const runtimeTarget = normalizeRecoveryPath(
    extractRuntimeStacktraceTarget(context.validationContext || {}, workspaceRoot) ||
    runtimeFrame?.file ||
    failureAnalysis.rootCauseFile ||
    failureAnalysis.referencedImplementationFiles?.[0] ||
    '',
    workspaceRoot
  );
  const preservedTarget = normalizeRecoveryPath(
    context.activeFailedPhaseTargetFile ||
    context.repairTargetFile ||
    context.selectedTarget ||
    getActiveFailedPhaseTargetFile(planner, failedTask, workspaceRoot) ||
    '',
    workspaceRoot
  );

  if (preservedTarget && runtimeTarget && runtimeTarget !== preservedTarget) {
    console.log('[RECOVERY_TARGET_MISMATCH_BLOCKED]', {
      expected: preservedTarget,
      actual: runtimeTarget,
      recoveryTaskId: failedTask?.id || null
    });
    return RECOVERY_TARGET_MISMATCH_BLOCKED;
  }

  const implementationCandidates = [
    normalizeRecoveryPath(context.implementationModule, workspaceRoot),
    preservedTarget,
    normalizeRecoveryPath(context.latestSuccessfulWritePath, workspaceRoot) || getLatestSuccessfulWritePath(planner, workspaceRoot),
    pickLastRecoveryPath(context.plannerChangedFiles, workspaceRoot) || pickLastRecoveryPath(planner?.changedFiles, workspaceRoot),
    normalizeRecoveryPath(context.requiredFiles?.[0] || planner?.requiredFiles?.[0] || '', workspaceRoot)
  ].filter(Boolean);
  const implementationTarget = implementationCandidates[0] || null;
  const changedTarget = pickLastRecoveryPath(context.changedFiles, workspaceRoot) || pickLastRecoveryPath(context.validationContext?.changedFiles, workspaceRoot);
  const selectedTarget = runtimeTarget || preservedTarget || implementationTarget || changedTarget || null;
  const selectionReason = runtimeTarget
    ? 'STACKTRACE_ROOT_CAUSE'
    : failureType === 'AssertionError'
      ? 'STACKTRACE_ASSERTION'
      : implementationTarget
        ? 'IMPLEMENTATION_MODULE'
        : changedTarget
          ? 'CHANGED_FILES'
          : 'NO_TARGET';

  console.log('[RECOVERY_STRATEGY]', {
    failureClassification: failureType || 'unknown',
    strategy: runtimeTarget ? 'STACKTRACE_RUNTIME' : (failureType === 'AssertionError' ? 'STACKTRACE_ASSERTION' : 'IMPLEMENTATION_MODULE')
  });

  console.log('[RECOVERY_TARGET_SELECTION]', {
    rootCauseFile: runtimeTarget || null,
    implementationModule: implementationTarget || null,
    selectedTarget: selectedTarget || null,
    selectionReason
  });

  if (runtimeTarget) {
    return runtimeTarget;
  }

  return selectedTarget;
}

function findRepairTargetFile(planner, failedTask, context = {}) {
  return resolveRecoveryTargetFile(planner, failedTask, context);
}

function toPathList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  if (value instanceof Map) return [...value.keys()];
  return [value];
}

function collectPlannerWriteTargets(planner, failedTask, context = {}) {
  const workspaceRoot = context.workspaceRoot || '';
  const ownedTargets = new Set();
  const plannerWriteTargets = new Set();

  const addOwnedTarget = (value) => {
    const normalized = normalizeRecoveryPath(value, workspaceRoot);
    if (normalized) {
      ownedTargets.add(normalized);
      return normalized;
    }
    return null;
  };

  const addPlannerWriteTarget = (value) => {
    const normalized = addOwnedTarget(value);
    if (normalized) {
      plannerWriteTargets.add(normalized);
    }
    return normalized;
  };

  for (const value of toPathList(context.changedFiles)) addOwnedTarget(value);
  for (const value of toPathList(context.plannerChangedFiles)) addOwnedTarget(value);
  addPlannerWriteTarget(context.activeFailedPhaseTargetFile);
  addPlannerWriteTarget(context.latestSuccessfulWritePath);
  addPlannerWriteTarget(getActiveFailedPhaseTargetFile(planner, failedTask, workspaceRoot));
  addPlannerWriteTarget(getLatestSuccessfulWritePath(planner, workspaceRoot));

  for (const task of planner?.graph?.allNodes?.() || []) {
    if (!task || task.kind === 'RECOVERY') continue;
    if (task.tool !== 'WRITE_FILE' && task.tool !== 'APPLY_PATCH') continue;
    addPlannerWriteTarget(task.toolArgs?.path || task.toolArgs?.file || task.toolArgs?.target);
  }

  for (const value of toPathList(context.plannerWriteTargets)) addPlannerWriteTarget(value);

  return {
    ownedTargets,
    plannerWriteTargets
  };
}

function evaluateRecoveryOwnership(planner, failedTask, context = {}, rootCauseFile = null) {
  const { ownedTargets, plannerWriteTargets } = collectPlannerWriteTargets(planner, failedTask, context);
  const repairTargetFile = normalizeRecoveryPath(context.repairTargetFile, context.workspaceRoot || '') || null;
  const requestedFiles = new Set(toPathList(context.requiredFiles).map(value => normalizeRecoveryPath(value, context.workspaceRoot || '')).filter(Boolean));
  const packageJsonRequested = requestedFiles.has('package.json');
  const exactOwned = Boolean(rootCauseFile) && (
    ownedTargets.has(rootCauseFile) ||
    plannerWriteTargets.has(rootCauseFile) ||
    requestedFiles.has(rootCauseFile) ||
    (packageJsonRequested && rootCauseFile === 'package.json')
  );
  const owned = exactOwned;
  const mode = exactOwned ? 'EXACT' : 'OUTSIDE_REQUESTED_SCOPE';
  const decision = owned ? 'OWNED' : 'NOT_OWNED';

  console.log('[RECOVERY_OWNERSHIP_CHECK]', {
    rootCauseFile: rootCauseFile || null,
    changedFiles: toPathList(context.changedFiles).map(value => normalizeRecoveryPath(value, context.workspaceRoot || '')).filter(Boolean),
    plannerWriteTargets: [...plannerWriteTargets],
    requestedFiles: [...requestedFiles],
    repairTargetFile,
    owned
  });
  console.log('[RECOVERY_OWNERSHIP]', {
    mode,
    decision
  });

  return {
    owned,
    ownedTargets,
    plannerWriteTargets,
    repairTargetFile,
    mode,
    decision
  };
}

function buildTerminalValidationContext(failedTask, args = {}, result = {}) {
  const command = String(result?.command || args?.command || failedTask?.toolArgs?.command || '').trim();
  const stdout = truncateRunText(String(result?.stdout || '').replace(/\r/g, '').trim(), 'recovery.validationContext.stdout');
  const stderr = truncateRunText(String(result?.stderr || '').replace(/\r/g, '').trim(), 'recovery.validationContext.stderr');
  const assertion = truncateRunText(String(result?.assertion || result?.error || '').trim(), 'recovery.validationContext.assertion');
  const expectedValue = truncateRunText(String(result?.expectedValue || result?.expected || '').trim(), 'recovery.validationContext.expectedValue');
  const actualValue = truncateRunText(String(result?.actualValue || result?.actual || '').trim(), 'recovery.validationContext.actualValue');
  const changedFiles = Array.isArray(result?.changedFiles) ? result.changedFiles.filter(Boolean) : [];
  return {
    failedCommand: command,
    command,
    exitCode: result?.exitCode,
    stdout,
    stderr,
    assertion,
    expectedValue,
    actualValue,
    changedFiles
  };
}

function expandTerminalRecoveryAfterTestRead(planner, task, result = {}) {
  if (!planner || !task || task.kind !== 'RECOVERY' || task.tool !== 'READ_FILE') return { expanded: false };
  const taskNode = planner.graph?.getNode?.(task.id);
  const alreadyHasRecoveryChildren = Boolean(taskNode?.children && planner?.taskMap && [...taskNode.children].some(childId => {
    const child = planner.taskMap.get(childId);
    return child && child.kind === 'RECOVERY';
  }));
  if (alreadyHasRecoveryChildren) {
    return { expanded: false, alreadyPlanned: true };
  }
  const stage = String(task.toolArgs?.recoveryStage || '').toLowerCase();
  const isFailingTestRead = stage === 'failing_test' || /failing test/i.test(String(task.goal || ''));
  if (!isFailingTestRead) return { expanded: false };

  const testPath = String(task.toolArgs?.path || '').trim();
  if (!testPath || !String(result?.content || '').trim()) return { expanded: false };

  const recoveryAssertionContext = buildRecoveryAssertionContext({
    testPath,
    testContent: result.content,
    validationContext: task.toolArgs?.validationContext || {}
  });
  if (!recoveryAssertionContext) {
    const parentId = findRecoveryParent(planner, task.id);
    if (parentId) {
      planner.markRecoveryFailed(parentId, `Could not extract assertion context from failing test: ${testPath}`);
      console.log('[PLANNER_RECOVERY_ASSERTION_CONTEXT_ABORT]', {
        recoveryTaskId: task.id,
        parentId,
        testPath
      });
    }
    return { expanded: false, aborted: true };
  }

  const parentId = findRecoveryParent(planner, task.id);
  const failedTask = parentId ? planner.graph.getNode(parentId) : null;
  const preferredTarget = normalizeRecoveryPath(task.toolArgs?.repairTargetFile)
    || resolveRecoveryTargetFile(planner, failedTask, {
      plannerChangedFiles: planner?.changedFiles,
      requiredFiles: planner?.requiredFiles,
      changedFiles: task.toolArgs?.changedFiles || []
    });
  const explicitTarget = inferImplementationFromTestContent(testPath, result.content);
  const implPath = preferredTarget || explicitTarget;
  if (!implPath) {
    console.log('[PLANNER_RECOVERY_IMPL_NOT_FOUND]', { recoveryTaskId: task.id, testPath });
    return { expanded: false };
  }

  if (preferredTarget && explicitTarget && normalizeRecoveryPath(preferredTarget) !== normalizeRecoveryPath(explicitTarget)) {
    console.log('[PLANNER_RECOVERY_TARGET_SUSPICIOUS]', {
      recoveryTaskId: task.id,
      testPath,
      preferredTarget,
      explicitTarget
    });
  }

  const failedCommand = String(failedTask?.toolArgs?.command || '').trim();

  const implReadTask = new Task({
    id: generateId(),
    kind: 'RECOVERY',
    goal: `Recovery: read implementation imported by ${testPath}`,
    tool: 'READ_FILE',
    toolArgs: {
      path: implPath,
      recoveryStage: 'implementation',
      testPath,
      recoveryAssertionContext
    },
    dependencies: []
  });

  const repairTask = new Task({
    id: generateId(),
    kind: 'RECOVERY',
    goal: `Recovery: patch implementation after reading ${testPath}`,
    tool: 'WRITE_FILE',
    toolArgs: {
      path: implPath,
      file: implPath,
      content: '',
      testPath,
      sourceTestPath: testPath,
      recoveryAssertionContext
    },
    dependencies: []
  });

  const rerunTask = new Task({
    id: generateId(),
    kind: 'RECOVERY',
    goal: `Recovery: run command${failedCommand ? ` ${failedCommand}` : ''}`,
    tool: 'RUN_TERMINAL',
    toolArgs: { command: failedCommand },
    dependencies: []
  });

  const addedIds = planner.addRecoveryTasks(task.id, [implReadTask, repairTask, rerunTask]);
  console.log('[PLANNER_RECOVERY_CHAIN_EXPANDED]', {
    recoveryTaskId: task.id,
    testPath,
    implementationPath: implPath,
    addedIds
  });

  return { expanded: true, implementationPath: implPath, addedIds };
}

function expandTerminalRecoveryAfterModuleLoadRead(planner, task, result = {}) {
  if (!planner || !task || task.kind !== 'RECOVERY' || task.tool !== 'READ_FILE') return { expanded: false };
  const taskNode = planner.graph?.getNode?.(task.id);
  const alreadyHasRecoveryChildren = Boolean(taskNode?.children && planner?.taskMap && [...taskNode.children].some(childId => {
    const child = planner.taskMap.get(childId);
    return child && child.kind === 'RECOVERY';
  }));
  if (alreadyHasRecoveryChildren) {
    return { expanded: false, alreadyPlanned: true };
  }
  const stage = String(task.toolArgs?.recoveryStage || '').toLowerCase();
  if (stage !== 'module_error' && stage !== 'root_cause') return { expanded: false };

  const implPath = String(task.toolArgs?.path || '').trim();
  if (!implPath || !String(result?.content || '').trim()) return { expanded: false };

  const parentId = findRecoveryParent(planner, task.id);
  const failedTask = parentId ? planner.graph.getNode(parentId) : null;
  const failedCommand = String(task.toolArgs?.failedCommand || failedTask?.toolArgs?.command || '').trim();
  const repairTask = new Task({
    id: generateId(),
    kind: 'RECOVERY',
    goal: stage === 'module_error'
      ? `Recovery: repair module export at ${implPath}`
      : `Recovery: repair source at ${implPath}`,
    tool: 'WRITE_FILE',
    toolArgs: {
      path: implPath,
      file: implPath,
      content: '',
      sourceTestPath: null,
      failureType: stage === 'module_error' ? 'module_load_error' : 'root_cause_error',
      stacktrace: task.toolArgs?.validationContext?.stderr || task.toolArgs?.validationContext?.stdout || '',
      failedCommand
    },
    dependencies: []
  });

  const rerunTask = new Task({
    id: generateId(),
    kind: 'RECOVERY',
    goal: `Recovery: run command${failedCommand ? ` ${failedCommand}` : ''}`,
    tool: 'RUN_TERMINAL',
    toolArgs: { command: failedCommand },
    dependencies: []
  });

  const addedIds = planner.addRecoveryTasks(task.id, [repairTask, rerunTask]);
  console.log('[PLANNER_RECOVERY_MODULE_LOAD_EXPANDED]', {
    recoveryTaskId: task.id,
    implementationPath: implPath,
    recoveryStage: stage,
    addedIds
  });

  return { expanded: true, implementationPath: implPath, addedIds };
}

export function tryRecovery(planner, failedTask, context = {}) {
  if (!planner || !failedTask) return { recoveryStarted: false };

  const strategyDecision = evaluateExecutionStrategy({
    failedTask,
    validationResult: context.validationContext || {},
    plannerMetadata: {
      parallelAllowed: planner?.parallelMode !== false,
      requiredCommands: context.requiredFiles || planner?.requiredCommands || []
    },
    workspaceMetadata: {
      workspaceRoot: context.workspaceRoot || '',
      readOnly: context.readOnly === true || false,
      packageManagerAvailable: context.packageManagerAvailable !== false,
      frameworkRunnable: context.frameworkRunnable !== false,
      terminalAvailable: context.terminalAvailable !== false,
      packageEditable: context.packageEditable !== false,
      frameworkSetupAllowed: context.frameworkSetupAllowed === true,
      validationRequired: context.validationRequired !== false
    },
    projectScan: context.projectScan || {},
    requiredCommands: context.requiredCommands || planner?.requiredCommands || []
  });
  console.log('[EXECUTION_STRATEGY_DECISION_APPLIED]', {
    taskId: failedTask.id,
    decision: strategyDecision.decision,
    owner: strategyDecision.owner,
    retryAllowed: strategyDecision.retryAllowed,
    setupRequired: strategyDecision.setupRequired,
    packageRequired: strategyDecision.packageRequired,
    commandRequired: strategyDecision.commandRequired,
    recoveryRequired: strategyDecision.recoveryRequired,
    reason: strategyDecision.reason
  });

  if (strategyDecision.owner === 'MODEL' && strategyDecision.retryAllowed) {
    return {
      recoveryStarted: false,
      shouldRetryModel: true,
      retryAllowed: true,
      strategyDecision
    };
  }
  if (strategyDecision.decision === 'Block' && failedTask.tool !== 'RUN_TERMINAL') {
    return {
      recoveryStarted: false,
      shouldRecover: false,
      reason: strategyDecision.reason,
      strategyDecision
    };
  }

  // Only one recovery plan per failed task
  if (hasRecoveryBeenAttempted(planner, failedTask.id)) {
    const retryResult = failedTask.tool === 'RUN_TERMINAL'
      ? {
          recoveryStarted: false,
          recoveryType: 'PROJECT_PREEXISTING_FAILURE',
          shouldRecover: false,
          reason: 'RETRY_BUDGET_EXHAUSTED'
        }
      : { recoveryStarted: false };
    console.log('[PLANNER_RECOVERY_SKIPPED]', {
      id: failedTask.id,
      reason: 'Recovery already attempted',
      recoveryType: retryResult.recoveryType || null
    });
    return retryResult;
  }

  const recoveryType = determineRecoveryType(failedTask);
  if (!recoveryType) {
    console.log('[PLANNER_RECOVERY_SKIPPED]', { id: failedTask.id, tool: failedTask.tool, reason: 'No recovery strategy available' });
    return { recoveryStarted: false, strategyDecision };
  }

  // Generate recovery plan
  const repairTargetFile = failedTask.tool === 'RUN_TERMINAL'
    ? findRepairTargetFile(planner, failedTask, {
        ...context,
        selectedTarget: context.selectedTarget || null,
        repairTargetFile: context.repairTargetFile || null,
        plannerChangedFiles: context.plannerChangedFiles || planner?.changedFiles,
        requiredFiles: context.requiredFiles || planner?.requiredFiles || [],
        latestSuccessfulWritePath: context.latestSuccessfulWritePath || null,
        activeFailedPhaseTargetFile: context.activeFailedPhaseTargetFile || null
      })
    : null;
  if (repairTargetFile === RECOVERY_TARGET_MISMATCH_BLOCKED) {
    return {
      recoveryStarted: false,
      shouldRecover: false,
      reason: 'RECOVERY_TARGET_MISMATCH_BLOCKED',
      strategyDecision
    };
  }
  const ownership = failedTask.tool === 'RUN_TERMINAL' && repairTargetFile
    ? evaluateRecoveryOwnership(planner, failedTask, {
        ...context,
        repairTargetFile,
        plannerChangedFiles: context.plannerChangedFiles || planner?.changedFiles
      }, repairTargetFile)
    : { owned: true, ownedTargets: new Set(), plannerWriteTargets: new Set(), repairTargetFile: null };
  if (failedTask.tool === 'RUN_TERMINAL' && repairTargetFile && !ownership.owned) {
    console.log('[RECOVERY_SKIPPED_UNRELATED_FAILURE]', {
      rootCauseFile: repairTargetFile,
      recoveryType: 'PROJECT_PREEXISTING_FAILURE'
    });
    return {
      recoveryStarted: false,
      recoveryType: 'PROJECT_PREEXISTING_FAILURE',
      shouldRecover: false,
      reason: 'UNRELATED_STACKTRACE_TARGET',
      rootCauseFile: repairTargetFile,
      repairTargetFile,
      plannerWriteTargets: [...ownership.plannerWriteTargets],
      ownedTargets: [...ownership.ownedTargets],
      strategyDecision
    };
  }
  const validatedRepairTargetFile = repairTargetFile
    ? assertValidRecoveryTaskPath(repairTargetFile, context.workspaceRoot || '', 'try_recovery_target')
    : null;
  const plan = generateRecoveryPlan(failedTask, {
    repairTargetFile: validatedRepairTargetFile,
    selectedTarget: validatedRepairTargetFile,
    validationContext: context.validationContext || {},
    changedFiles: context.changedFiles || [],
    plannerChangedFiles: context.plannerChangedFiles || [],
    requiredFiles: context.requiredFiles || [],
    workspaceRoot: context.workspaceRoot || ''
  });
  if (!plan || plan.tasks.length === 0) {
    console.log('[PLANNER_RECOVERY_SKIPPED]', { id: failedTask.id, reason: 'Empty recovery plan' });
    return { recoveryStarted: false, strategyDecision };
  }

  // Mark task as RECOVERING and add recovery tasks
  console.log('[PLANNER_RECOVERY_START]', { id: failedTask.id, kind: failedTask.kind, recoveryType, taskCount: plan.tasks.length });
  planner.markRecovering(failedTask.id);
  const addedIds = planner.addRecoveryTasks(failedTask.id, plan.tasks);

  return { recoveryStarted: true, recoveryTaskIds: addedIds, recoveryPlan: plan, strategyDecision };
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
  const isFirst = !task.startedAt;
  if (isFirst) {
    task.startedAt = now;
    task.timeoutMs = getTaskTimeoutMs(task);
    task.maxAttempts = getMaxAttempts(task);
    console.log('[PLANNER_TASK_STARTED]', {
      taskId: task.id,
      tool: task.tool || 'CODING',
      timeoutMs: task.timeoutMs,
      maxAttempts: task.maxAttempts,
      goal: (task.goal || '').substring(0, 80)
    });
  }
  markTaskProgress(task, null);
  // Reset stall counter on genuine progress
  task.stallCount = 0;
  console.log('[PLANNER_TASK_PROGRESS]', {
    taskId: task.id,
    tool: task.tool || 'CODING',
    attempts: task.attempts,
    elapsed: `${Date.now() - task.startedAt}ms`
  });
}

function parseScriptName(command) {
  if (!command) return null;
  // Extract script name from "npm run build", "npm run local:ok", "pnpm run build", etc.
  const match = String(command).match(/(?:npm|pnpm|yarn)\s+run\s+([^\s]+)/i);
  if (match) return match[1];
  // Direct npm command like "npm test"
  const directMatch = String(command).match(/npm\s+(test|start|stop|restart)\b/i);
  if (directMatch) return directMatch[1];
  return null;
}

export function notifyToolExecution(planner, toolName, args, result, preferredTaskId = null) {
  if (!planner) return { handled: false };

  // Check if this is a recovery task before checking regular tasks
  const resultTaskId = preferredTaskId || result?.taskId || result?.plannerTaskId || null;
  const recoveryTask = findRecoveryTask(planner, toolName, resultTaskId);
  const task = recoveryTask || findMatchingTask(planner, toolName, false, resultTaskId);
  if (!task) {
    // Phase 4.11: Stall detected — tool doesn't match any ready task
    return handleStall(planner, toolName);
  }

  // Phase 4.11: Mark progress on the matched task
  markTaskAttempt(task);

  const success = result?.success !== false;
  const isRecovery = task.kind === 'RECOVERY';

  // Phase 4.15 fix — Regression 4: When recovery reads package.json, check if the
  // failed command script exists. If not, abort recovery with intelligent reason.
  if (success && isRecovery && toolName === 'READ_FILE' && String(args.path || '').replace(/\\/g, '/').toLowerCase().endsWith('package.json')) {
    const pkgContent = result?.content;
    if (pkgContent) {
      try {
        const pkg = JSON.parse(pkgContent);
        const scripts = pkg.scripts || {};
        const parentId = findRecoveryParent(planner, task.id);
        if (parentId) {
          const failedTask = planner.graph.getNode(parentId);
          const failedCommand = failedTask?.toolArgs?.command || '';
          const scriptName = parseScriptName(failedCommand);
          if (scriptName && !scripts[scriptName]) {
            console.log('[PLANNER_RECOVERY_CONTEXT]', {
              reason: `Script "${scriptName}" not found in package.json`,
              availableScripts: Object.keys(scripts),
              failedCommand
            });
            planner.markRecoveryFailed(parentId, `No "${scriptName}" script found in package.json. Available scripts: ${Object.keys(scripts).join(', ') || 'none'}. Aborting recovery.`);
            console.log('[PLANNER_RECOVERY_ABORT]', {
              taskId: parentId,
              reason: `Script "${scriptName}" not found in package.json`,
              command: failedCommand
            });
            return { handled: true, taskId: task.id, status: 'SUCCESS', recoveryAborted: true };
          }
        }
      } catch {
        // Invalid JSON — proceed with recovery anyway
      }
    }
  }

  if (success) {
    planner.markSuccess(task.id, { tool: toolName, args, result });
    const kind = isRecovery ? 'RECOVERY' : task.kind;
    console.log('[PLANNER_TASK_SUCCESS]', { id: task.id, kind, tool: toolName });
    if (toolName === 'WRITE_FILE') {
      const finalizedPayload = {
        taskId: task.id,
        path: String(args?.path || args?.file || task?.toolArgs?.path || task?.toolArgs?.file || '').trim(),
        status: 'SUCCESS',
        reason: result?.changed === false || result?.alreadyUpToDate === true || result?.cached === true ? 'no_change' : 'written'
      };
      if (planner.executionStateRegistry?.logOnce) {
        planner.executionStateRegistry.logOnce('WRITE_TASK_FINALIZED', finalizedPayload, {
          taskId: task.id,
          path: finalizedPayload.path
        });
      } else {
        console.log('[WRITE_TASK_FINALIZED]', finalizedPayload);
      }
    }
    // Phase 4.12: Record successful tool execution in planner history
    if (planner.executionHistory) {
      planner.executionHistory.recordTool(toolName, args, result, task);
      planner.executionHistory.recordTask(task.id);
      console.log('[PLANNER_HISTORY_RECORD]', { tool: toolName, taskId: task.id });
    }

    if (isRecovery && toolName === 'READ_FILE') {
      const expansion = expandTerminalRecoveryAfterTestRead(planner, task, result);
      if (expansion.expanded) {
        console.log('[PLANNER_RECOVERY_TEST_READ]', {
          recoveryTaskId: task.id,
          implementationPath: expansion.implementationPath
        });
      } else {
        const moduleExpansion = expandTerminalRecoveryAfterModuleLoadRead(planner, task, result);
        if (moduleExpansion.expanded) {
          console.log('[PLANNER_RECOVERY_MODULE_LOAD_READ]', {
            recoveryTaskId: task.id,
            implementationPath: moduleExpansion.implementationPath
          });
        }
      }
    }
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
      const memoryState = planner.executionMemory?.lookup?.(task);
      if (memoryState && memoryState.status !== 'NOT_EXECUTED') {
        console.log('[PLANNER_RECOVERY_MEMORY]', {
          taskId: task.id,
          status: memoryState.status,
          attempts: memoryState.record?.attemptCount || task.retryCount || 0,
          failureReason: memoryState.record?.failureReason || error
        });
      }
      const recoveryResult = tryRecovery(planner, task, {
        validationContext: buildTerminalValidationContext(task, args, result),
        changedFiles: Array.isArray(result?.changedFiles) ? result.changedFiles.filter(Boolean) : [],
        plannerChangedFiles: planner?.changedFiles instanceof Set ? [...planner.changedFiles] : [],
        requiredFiles: Array.isArray(planner?.requiredFiles) ? planner.requiredFiles : [],
        latestSuccessfulWritePath: getLatestSuccessfulWritePath(planner)
      });
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
