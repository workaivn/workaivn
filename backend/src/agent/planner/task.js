import crypto from 'node:crypto';
import { TaskStatus } from './plannerTypes.js';

export class Task {
  constructor({ id, kind, goal, dependencies = [], tool = null, toolArgs = {}, successNext, failureNext, recoveredNext, blockedNext, skipNext, priority }) {
    this.id = id || crypto.randomUUID();
    this.kind = kind;
    this.goal = goal;
    this.dependencies = dependencies;
    this.status = TaskStatus.PENDING;
    this.retryCount = 0;
    this.tool = tool;
    this.toolArgs = toolArgs;
    this.priority = priority != null ? priority : null;
    this.result = null;
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
    // Phase 4.11: Task timeout/stall runtime state
    this.startedAt = null;
    this.lastProgressAt = null;
    this.attempts = 0;
    this.stallCount = 0;
    this.statusReason = null;
    this.timeoutMs = null;
    this.maxAttempts = null;
  }
}
