import crypto from 'node:crypto';

export const ExecutionMemoryStatus = Object.freeze({
  NOT_FOUND: 'NOT_EXECUTED',
  NOT_EXECUTED: 'NOT_EXECUTED',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
  BLOCKED: 'BLOCKED',
  RECOVERED: 'RECOVERED',
  GENERATED: 'GENERATED',
  VALIDATING: 'VALIDATING',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  READY_TO_COMMIT: 'READY_TO_COMMIT',
  COMMITTING: 'COMMITTING',
  COMMITTED: 'COMMITTED',
  COMMIT_FAILED: 'COMMIT_FAILED'
});

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function normalizeTool(tool) {
  return String(tool || '').toUpperCase();
}

export function normalizeToolArgs(tool, args = {}) {
  const toolName = normalizeTool(tool);
  if (toolName === 'READ_FILE') {
    return { path: normalizePath(args.path || args.file) };
  }
  if (toolName === 'WRITE_FILE') {
    return {
      path: normalizePath(args.path || args.file),
      content: String(args.content ?? '')
    };
  }
  if (toolName === 'APPLY_PATCH') {
    return {
      file: normalizePath(args.file || args.path || args.target),
      find: String(args.find ?? ''),
      replace: String(args.replace ?? ''),
      patch: String(args.patch ?? '')
    };
  }
  if (toolName === 'RUN_TERMINAL') {
    return { command: String(args.command || '').trim() };
  }
  return args && typeof args === 'object' ? JSON.parse(JSON.stringify(args)) : {};
}

function contentHash(value) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 12);
}

export function createExecutionMemory() {
  const byTaskId = new Map();
  const byExecutionKey = new Map();
  const reasoningByKey = new Map();
  let defaultContext = {};
  const stats = {
    tasksRemembered: 0,
    memoryLookups: 0,
    memoryHits: 0,
    reasoningReused: 0,
    retriesAvoided: 0,
    skippedDuplicateExecutions: 0,
    plannerDedupesRecorded: 0
  };

  function normalizeContext(context = {}) {
    return {
      workspaceRoot: normalizePath(context.workspaceRoot || defaultContext.workspaceRoot || ''),
      cwd: normalizePath(context.cwd || defaultContext.cwd || context.workspaceRoot || defaultContext.workspaceRoot || ''),
      envHash: String(context.envHash || defaultContext.envHash || ''),
      dependencyHash: String(context.dependencyHash || defaultContext.dependencyHash || '')
    };
  }

  function workspaceScope(context = {}) {
    const ctx = normalizeContext(context);
    return ctx.workspaceRoot || ctx.cwd || '';
  }

  function executionKey(tool, args = {}, context = {}) {
    const normalizedTool = normalizeTool(tool);
    const normalizedArgs = normalizeToolArgs(normalizedTool, args);
    const workspace = workspaceScope(context);

    if (normalizedTool === 'READ_FILE') {
      return `READ_FILE:${normalizedArgs.path}@${workspace}`;
    }
    if (normalizedTool === 'RUN_TERMINAL') {
      return `RUN_TERMINAL:${normalizedArgs.command}@${workspace}`;
    }
    if (normalizedTool === 'WRITE_FILE') {
      const hash = contentHash(normalizedArgs.content);
      return `WRITE_FILE:${normalizedArgs.path}:${hash}@${workspace}`;
    }
    if (normalizedTool === 'APPLY_PATCH') {
      const hash = contentHash(`${normalizedArgs.find}|${normalizedArgs.replace}|${normalizedArgs.patch}`);
      return `APPLY_PATCH:${normalizedArgs.file}:${hash}@${workspace}`;
    }
    return `${normalizedTool}:${JSON.stringify(normalizedArgs)}@${workspace}`;
  }

  function summarizeResult(result) {
    if (!result || typeof result !== 'object') return result == null ? null : String(result).slice(0, 500);
    const summary = {
      success: result.success !== false,
      file: result.file || null,
      changed: result.changed,
      cached: result.cached,
      skipped: result.skipped,
      exitCode: result.exitCode,
      error: result.error || null
    };
    if (typeof result.stdout === 'string') summary.stdout = result.stdout.slice(0, 500);
    if (typeof result.stderr === 'string') summary.stderr = result.stderr.slice(0, 500);
    if (typeof result.content === 'string') summary.contentLength = result.content.length;
    return summary;
  }

  function shouldKeepExistingExecutionRecord(existingByKey, status) {
    if (!existingByKey) return false;
    const terminal =
      existingByKey.status === ExecutionMemoryStatus.SUCCEEDED ||
      existingByKey.status === ExecutionMemoryStatus.SKIPPED ||
      existingByKey.status === ExecutionMemoryStatus.RECOVERED;
    if (status === ExecutionMemoryStatus.RUNNING && terminal) return true;
    if (status === ExecutionMemoryStatus.SKIPPED && terminal) return true;
    return false;
  }

  function record(task = {}, status, payload = {}) {
    const taskId = task.id || payload.taskId || crypto.randomUUID();
    const tool = normalizeTool(payload.tool || task.tool);
    const args = payload.args || task.toolArgs || {};
    const context = payload.context || defaultContext;
    const key = tool ? executionKey(tool, args, context) : null;
    const existing = byTaskId.get(taskId);
    const existingByKey = key ? byExecutionKey.get(key) : null;
    const attemptCount = payload.attemptCount ?? task.attempts ?? existing?.attemptCount ?? 0;
    const recordValue = {
      taskId,
      plannerNodeId: taskId,
      executionKey: key,
      tool,
      normalizedArgs: normalizeToolArgs(tool, args),
      status,
      attemptCount,
      reasoning: payload.reasoning || task.reason || task.goal || '',
      dependencies: [...(task.dependencies || [])],
      resultSummary: summarizeResult(payload.result),
      failureReason: payload.failureReason || payload.reason || task.reason || null,
      phase: payload.phase || null,
      committed: payload.committed === true,
      path: normalizePath(payload.path || args.path || args.file || task.toolArgs?.path || task.toolArgs?.file || ''),
      timestamp: new Date().toISOString()
    };
    byTaskId.set(taskId, recordValue);
    if (key && !shouldKeepExistingExecutionRecord(existingByKey, status)) {
      byExecutionKey.set(key, recordValue);
    }
    if (status === ExecutionMemoryStatus.SKIPPED && existing?.status !== ExecutionMemoryStatus.SKIPPED) {
      stats.skippedDuplicateExecutions++;
    }
    stats.tasksRemembered = byExecutionKey.size;
    console.log('[EXECUTION_MEMORY_STORE]', {
      executionKey: key,
      tool: tool || null,
      status,
      attempts: recordValue.attemptCount
    });
    return recordValue;
  }

  function lookup(taskOrTool, maybeArgs = null, maybeContext = {}) {
    stats.memoryLookups++;
    const context = typeof taskOrTool === 'object' && taskOrTool && !Array.isArray(taskOrTool) && taskOrTool.tool
      ? (maybeArgs || defaultContext)
      : (maybeContext || defaultContext);
    let key = null;
    if (typeof taskOrTool === 'object' && taskOrTool?.tool) {
      key = executionKey(taskOrTool.tool, taskOrTool.toolArgs || {}, context);
    } else if (typeof taskOrTool === 'string') {
      key = executionKey(taskOrTool, maybeArgs || {}, context);
    }
    const recordValue = key ? byExecutionKey.get(key) : null;
    console.log('[EXECUTION_MEMORY_LOOKUP]', {
      executionKey: key,
      tool: typeof taskOrTool === 'object' ? (taskOrTool?.tool || null) : normalizeTool(taskOrTool),
      status: recordValue?.status || ExecutionMemoryStatus.NOT_EXECUTED
    });
    if (!recordValue) return { status: ExecutionMemoryStatus.NOT_EXECUTED, record: null, executionKey: key };
    const isTerminalHit =
      recordValue.status === ExecutionMemoryStatus.SUCCEEDED ||
      recordValue.status === ExecutionMemoryStatus.SKIPPED ||
      recordValue.status === ExecutionMemoryStatus.RECOVERED;
    if (isTerminalHit) {
      stats.memoryHits++;
      console.log('[EXECUTION_MEMORY_HIT]', {
        executionKey: key,
        tool: recordValue.tool || null,
        status: recordValue.status
      });
    }
    return { status: recordValue.status, record: recordValue, executionKey: key };
  }

  function markRunning(task, context = {}) {
    return record(task, ExecutionMemoryStatus.RUNNING, {
      tool: task.tool,
      args: task.toolArgs || {},
      context,
      attemptCount: (task.attempts || 0) + 1
    });
  }

  function markSucceeded(task, payload = {}) {
    const recordValue = record(task, ExecutionMemoryStatus.SUCCEEDED, payload);
    const reasoning = payload.reasoning || task.reason || task.goal || '';
    if (reasoning) {
      setReasoning(reasoning, {
        taskId: task.id || payload.taskId,
        tool: payload.tool || task.tool,
        args: payload.args || task.toolArgs
      });
    }
    return recordValue;
  }

  function markFailed(task, payload = {}) {
    return record(task, ExecutionMemoryStatus.FAILED, payload);
  }

  function markSkipped(task, payload = {}) {
    return record(task, ExecutionMemoryStatus.SKIPPED, payload);
  }

  function markRetryAvoided() {
    stats.retriesAvoided++;
  }

  function recordPlannerDedupe(tool, args, context = {}) {
    const normalizedTool = normalizeTool(tool);
    const key = executionKey(normalizedTool, args, context);
    stats.plannerDedupesRecorded++;
    console.log('[EXECUTION_MEMORY_DEDUPE_RECORDED]', {
      tool: normalizedTool,
      args: normalizeToolArgs(normalizedTool, args),
      reason: 'duplicate_prompt_collapsed',
      executionKey: key
    });
    return key;
  }

  function setContext(context = {}) {
    defaultContext = normalizeContext(context);
  }

  function markBlocked(task, payload = {}) {
    return record(task, ExecutionMemoryStatus.BLOCKED, payload);
  }

  function markRecovered(task, payload = {}) {
    return record(task, ExecutionMemoryStatus.RECOVERED, payload);
  }

  function reasoningKey(input) {
    return crypto.createHash('sha1').update(String(input || '')).digest('hex');
  }

  function getReasoning(input) {
    const key = reasoningKey(input);
    const hit = reasoningByKey.get(key);
    if (hit) {
      stats.reasoningReused++;
      console.log('[REASONING_REUSED]', { key, taskId: hit.taskId || null });
      return hit;
    }
    return null;
  }

  function setReasoning(input, value = {}) {
    const key = reasoningKey(input);
    const entry = { ...value, key, timestamp: new Date().toISOString() };
    reasoningByKey.set(key, entry);
    console.log('[EXECUTION_MEMORY_STORE]', {
      taskId: value.taskId || null,
      tool: 'REASONING',
      status: ExecutionMemoryStatus.SUCCEEDED
    });
    return entry;
  }

  function getStats() {
    return {
      ...stats,
      tasksRemembered: byExecutionKey.size,
      reasoningEntries: reasoningByKey.size
    };
  }

  function printSummary() {
    const s = getStats();
    console.log('========== Execution Memory =========');
    console.log(`Tasks remembered:            ${s.tasksRemembered}`);
    console.log(`Memory lookups:              ${s.memoryLookups}`);
    console.log(`Memory hits:                 ${s.memoryHits}`);
    console.log(`Reasoning reused:            ${s.reasoningReused}`);
    console.log(`Retries avoided:             ${s.retriesAvoided}`);
    console.log(`Skipped duplicate executions: ${s.skippedDuplicateExecutions}`);
    console.log(`Planner-level dedupes:       ${s.plannerDedupesRecorded}`);
    console.log('=====================================');
  }

  return {
    lookup,
    record,
    markRunning,
    markSucceeded,
    markFailed,
    markSkipped,
    markRetryAvoided,
    recordPlannerDedupe,
    markBlocked,
    markRecovered,
    setContext,
    getReasoning,
    setReasoning,
    executionKey,
    toolKey: executionKey,
    getStats,
    printSummary,
    getAllRecords: () => [...byExecutionKey.values()]
  };
}
