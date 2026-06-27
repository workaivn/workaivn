import { ExecutionMemoryStatus, createExecutionMemory, normalizeToolArgs } from './executionMemory.js';

export function createExecutionHistory(executionMemory = createExecutionMemory()) {
  const readFiles = new Map();
  const writtenFiles = new Map();
  const executedCommands = new Map();
  const appliedPatches = new Set();
  const completedTasks = new Set();
  const completedTools = [];

  return {
    readFiles,
    writtenFiles,
    executedCommands,
    appliedPatches,
    completedTasks,
    completedTools,
    executionMemory,

    recordRead(path) {
      const normalized = String(path || '').replace(/\\/g, '/');
      readFiles.set(normalized, true);
      completedTools.push({ tool: 'READ_FILE', path: normalized });
    },

    recordWrite(path, content) {
      const normalized = String(path || '').replace(/\\/g, '/');
      writtenFiles.set(normalized, { path: normalized, content: String(content || '') });
      completedTools.push({ tool: 'WRITE_FILE', path: normalized });
    },

    recordPatch(targetPath) {
      const normalized = String(targetPath || '').replace(/\\/g, '/');
      appliedPatches.add(normalized);
      completedTools.push({ tool: 'APPLY_PATCH', target: normalized });
    },

    recordCommand(command, exitCode) {
      const normalized = String(command || '');
      executedCommands.set(normalized, { command: normalized, exitCode: exitCode != null ? exitCode : 0 });
      completedTools.push({ tool: 'RUN_TERMINAL', command: normalized, exitCode });
    },

    recordTool(toolName, args, result, task = null) {
      const success = result?.success !== false;
      const status = success
        ? (result?.skipped ? ExecutionMemoryStatus.SKIPPED : ExecutionMemoryStatus.SUCCEEDED)
        : ExecutionMemoryStatus.FAILED;
      executionMemory.record(task || { tool: toolName, toolArgs: args || {} }, status, {
        tool: toolName,
        args,
        result,
        context: task ? undefined : {},
        reasoning: task?.reason || task?.goal || '',
        failureReason: success ? null : (result?.error || `Tool ${toolName} failed`)
      });
      if (!success) return;
      switch (toolName) {
        case 'READ_FILE':
          this.recordRead(args?.path || args?.file || result?.file);
          break;
        case 'WRITE_FILE':
          this.recordWrite(args?.file || args?.path || result?.file, args?.content || result?.content);
          break;
        case 'APPLY_PATCH':
          this.recordPatch(args?.file || args?.path || result?.file);
          break;
        case 'RUN_TERMINAL':
          this.recordCommand(args?.command, result?.exitCode);
          break;
        case 'FINAL':
          completedTools.push({ tool: 'FINAL' });
          break;
      }
    },

    recordTask(taskId) {
      completedTasks.add(taskId);
    },

    recordTaskExecution(task, status, payload = {}) {
      return executionMemory.record(task, status, payload);
    },

    lookupTask(task, context = {}) {
      return executionMemory.lookup(task, context);
    },

    getAllRecords() {
      return executionMemory.getAllRecords();
    },

    getStats() {
      return executionMemory.getStats();
    },

    hasRead(path) {
      const normalized = String(path || '').replace(/\\/g, '/');
      const mem = executionMemory.lookup('READ_FILE', { path: normalized });
      return mem.status === ExecutionMemoryStatus.SUCCEEDED || readFiles.has(normalized);
    },

    hasWritten(path, content) {
      const normalized = String(path || '').replace(/\\/g, '/');
      const normalizedArgs = normalizeToolArgs('WRITE_FILE', { path: normalized, content });
      const mem = executionMemory.lookup('WRITE_FILE', normalizedArgs);
      if (mem.status === ExecutionMemoryStatus.SUCCEEDED || mem.status === ExecutionMemoryStatus.SKIPPED) return true;
      const existing = writtenFiles.get(normalized);
      if (!existing) return false;
      if (content !== undefined && existing.content !== String(content || '')) return false;
      return true;
    },

    hasExecuted(command) {
      const normalized = String(command || '');
      const mem = executionMemory.lookup('RUN_TERMINAL', { command: normalized });
      if (mem.status === ExecutionMemoryStatus.SUCCEEDED) return true;
      const existing = executedCommands.get(normalized);
      if (!existing) return false;
      if (existing.exitCode !== 0) return false;
      return true;
    },

    hasAppliedPatch(targetPath) {
      const normalized = String(targetPath || '').replace(/\\/g, '/');
      const mem = executionMemory.lookup('APPLY_PATCH', { file: normalized });
      return mem.status === ExecutionMemoryStatus.SUCCEEDED || appliedPatches.has(normalized);
    },

    hasCompletedTask(taskId) {
      return completedTasks.has(taskId);
    },

    shouldSkip(toolName, args) {
      switch (toolName) {
        case 'READ_FILE':
          return this.hasRead(args?.path || args?.file);
        case 'WRITE_FILE':
          return this.hasWritten(args?.file || args?.path, args?.content);
        case 'RUN_TERMINAL':
          return this.hasExecuted(args?.command);
        case 'APPLY_PATCH':
          return this.hasAppliedPatch(args?.file || args?.path);
        case 'FINAL':
          return completedTools.some(t => t.tool === 'FINAL');
        default:
          return false;
      }
    },

    skipReason(toolName, args) {
      switch (toolName) {
        case 'READ_FILE':
          if (this.hasRead(args?.path || args?.file)) return 'already_read';
          return null;
        case 'WRITE_FILE':
          if (this.hasWritten(args?.file || args?.path, args?.content)) return 'already_written';
          return null;
        case 'RUN_TERMINAL':
          if (this.hasExecuted(args?.command)) return 'already_executed';
          return null;
        case 'APPLY_PATCH':
          if (this.hasAppliedPatch(args?.file || args?.path)) return 'already_applied';
          return null;
        case 'FINAL':
          if (completedTools.some(t => t.tool === 'FINAL')) return 'already_final';
          return null;
        default:
          return null;
      }
    }
  };
}
