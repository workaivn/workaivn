import crypto from 'node:crypto';
import { TaskStatus } from './plannerTypes.js';
import { getTimestamp } from './plannerUtils.js';

export class TaskNode {
  constructor({
    id,
    kind,
    goal,
    dependencies = [],
    tool = null,
    toolArgs = {},
    successNext,
    failureNext,
    recoveredNext,
    blockedNext,
    skipNext,
    priority,
    source = null,
    promotionSource = null,
    verificationEvidence = null,
    plannerReason = null,
    proposalId = null,
    proposalType = null,
    promoted = false,
    promotionId = null,
    contextScanId = null,
    unitType = null,
    description = null,
    targetFiles = [],
    requiredReads = [],
    requiredWrites = [],
    inputs = {},
    outputs = {},
    acceptanceCriteria = [],
    completionPredicate = null,
    retryPolicy = {},
    verificationPolicy = {},
    canonicalTargets = [],
    executionContract = null,
    authoritySource = null,
    authorityState = 'candidate',
    approvalId = null,
    approvedByFirewall = false,
    requestedKind = null
  }) {
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
    this.source = source;
    this.promotionSource = promotionSource;
    this.verificationEvidence = verificationEvidence;
    this.plannerReason = plannerReason;
    this.proposalId = proposalId;
    this.proposalType = proposalType;
    this.promoted = promoted === true;
    this.promotionId = promotionId;
    this.contextScanId = contextScanId;
    this.unitType = unitType;
    this.description = description;
    this.targetFiles = Array.isArray(targetFiles) ? [...targetFiles] : [];
    this.requiredReads = Array.isArray(requiredReads) ? [...requiredReads] : [];
    this.requiredWrites = Array.isArray(requiredWrites) ? [...requiredWrites] : [];
    this.inputs = inputs && typeof inputs === 'object' ? { ...inputs } : {};
    this.outputs = outputs && typeof outputs === 'object' ? { ...outputs } : {};
    this.acceptanceCriteria = Array.isArray(acceptanceCriteria) ? [...acceptanceCriteria] : [];
    this.completionPredicate = completionPredicate;
    this.retryPolicy = retryPolicy && typeof retryPolicy === 'object' ? { ...retryPolicy } : {};
    this.verificationPolicy = verificationPolicy && typeof verificationPolicy === 'object' ? { ...verificationPolicy } : {};
    this.canonicalTargets = Array.isArray(canonicalTargets) ? [...canonicalTargets] : [];
    this.executionContract = executionContract;
    this.authoritySource = authoritySource || null;
    this.authorityState = authorityState || 'candidate';
    this.approvalId = approvalId || null;
    this.approvedByFirewall = approvedByFirewall === true;
    this.requestedKind = requestedKind || null;
  }

  touch() {
    this.updatedAt = getTimestamp();
  }
}
