import crypto from 'node:crypto';
import { TaskStatus } from './plannerTypes.js';
import { getTimestamp } from './plannerUtils.js';

export class TaskNode {
  constructor({ id, kind, goal, dependencies = [], tool = null, toolArgs = {}, successNext, failureNext, recoveredNext, blockedNext, skipNext, priority }) {
    this.id = id || crypto.randomUUID();
    this.kind = kind;
    this.goal = goal;
    this.status = TaskStatus.PENDING;
    this.dependencies = new Set(dependencies);
    this.parents = new Set();
    this.children = new Set();
    this.retryCount = 0;
    this.tool = tool;
    this.toolArgs = toolArgs;
    this.priority = priority != null ? priority : null;
    this.result = null;
    this.error = null;
    this.reason = null;
    this.successNext = successNext || null;
    this.failureNext = failureNext || null;
    this.recoveredNext = recoveredNext || null;
    this.blockedNext = blockedNext || null;
    this.skipNext = skipNext || null;
    this.branchType = null;
    this.branchReason = null;
    this.estimatedCost = null;
    this.estimatedCategory = null;
    this.estimatedTime = null;
    this.estimatedTokens = null;
    this.estimatedIO = null;
    this.estimatedCPU = null;
    this.estimatedMemory = null;
    this.estimatedRisk = null;
    this.createdAt = getTimestamp();
    this.updatedAt = this.createdAt;
    // Phase 4.11: Task timeout/stall runtime state
    this.startedAt = null;
    this.lastProgressAt = null;
    this.attempts = 0;
    this.stallCount = 0;
    this.statusReason = null;
    this.timeoutMs = null;
    this.maxAttempts = null;
  }

  touch() {
    this.updatedAt = getTimestamp();
  }
}
