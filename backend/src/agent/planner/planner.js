import { TaskStatus, BranchType, CostCategory } from './plannerTypes.js';
import { TaskNode } from './taskNode.js';
import { TaskGraph } from './taskGraph.js';
import {
  updateReadyStates,
  unlockChildren,
  blockChildren,
  explainBlocked
} from './dependencyEngine.js';
import { allDependenciesSatisfied } from './dependencyUtils.js';
import { estimateForTool, costBreakdown } from './costEstimator.js';
import { getTaskPriority, sortReadyTasksByPriority, pickNextPlannerTask } from './priorityQueue.js';

export class Planner {
  constructor(tasks = []) {
    this.graph = new TaskGraph();
    this.graph.create();
    this.taskMap = new Map();
    for (const task of tasks) {
      this._addTask(task);
    }
    this._updateReadyStates();
    this.totalPlanCost();

    // Phase 4.8: Parallel Planner
    this.parallelMode = false;
    this.parallelGroups = [];
    this.currentParallelGroupIndex = -1;
  }

  _addTask(task) {
    const node = task instanceof TaskNode
      ? task
      : new TaskNode({
          id: task.id,
          kind: task.kind,
          goal: task.goal,
          dependencies: task.dependencies || [],
          tool: task.tool,
          toolArgs: task.toolArgs,
          successNext: task.successNext,
          failureNext: task.failureNext,
          recoveredNext: task.recoveredNext,
          blockedNext: task.blockedNext,
          skipNext: task.skipNext,
          priority: task.priority
        });
    if (task.status && task.status !== TaskStatus.PENDING) {
      node.status = task.status;
    }
    if (task.result) node.result = task.result;
    if (task.reason) node.reason = task.reason;
    if (task.retryCount) node.retryCount = task.retryCount;
    if (task.error) node.error = task.error;
    if (task.branchType) node.branchType = task.branchType;
    if (task.branchReason) node.branchReason = task.branchReason;
    // Phase 4.11: Copy runtime metadata if provided
    if (task.attempts != null) node.attempts = task.attempts;
    if (task.stallCount != null) node.stallCount = task.stallCount;
    if (task.startedAt != null) node.startedAt = task.startedAt;
    if (task.lastProgressAt != null) node.lastProgressAt = task.lastProgressAt;
    if (task.statusReason != null) node.statusReason = task.statusReason;
    if (task.timeoutMs != null) node.timeoutMs = task.timeoutMs;
    if (task.maxAttempts != null) node.maxAttempts = task.maxAttempts;
    if (task.estimatedCost !== null && task.estimatedCost !== undefined) {
      node.estimatedCost = task.estimatedCost;
      node.estimatedCategory = task.estimatedCategory;
      node.estimatedTime = task.estimatedTime;
      node.estimatedTokens = task.estimatedTokens;
      node.estimatedIO = task.estimatedIO;
      node.estimatedCPU = task.estimatedCPU;
      node.estimatedMemory = task.estimatedMemory;
      node.estimatedRisk = task.estimatedRisk;
    }
    if (task.priority != null) {
      node.priority = task.priority;
    }
    if (task.parents) {
      for (const p of task.parents) node.parents.add(p);
    }
    if (task.children) {
      for (const c of task.children) node.children.add(c);
    }
    try {
      this.graph.addNode(node);
    } catch {
      return;
    }
    this.taskMap.set(node.id, node);
    for (const depId of node.dependencies) {
      try {
        this.graph.connect(depId, node.id);
      } catch {
        // dependency may not be in graph yet
      }
    }

    // Phase 4.9: Set cost estimates if not already set
    if (node.estimatedCost === null || node.estimatedCost === undefined) {
      this._setCostEstimates(node);
    }
  }

  _setCostEstimates(node) {
    const tool = node.tool;
    if (!tool) {
      node.estimatedCost = 7;
      node.estimatedCategory = CostCategory.MEDIUM;
      node.estimatedTime = CostCategory.MEDIUM;
      node.estimatedTokens = CostCategory.HIGH;
      node.estimatedIO = CostCategory.LOW;
      node.estimatedCPU = CostCategory.LOW;
      node.estimatedMemory = CostCategory.MEDIUM;
      node.estimatedRisk = CostCategory.MEDIUM;
      return;
    }
    const { estimates, score, category } = estimateForTool(tool);
    node.estimatedCost = score;
    node.estimatedCategory = category;
    node.estimatedTime = estimates.time;
    node.estimatedTokens = estimates.tokens;
    node.estimatedIO = estimates.io;
    node.estimatedCPU = estimates.cpu;
    node.estimatedMemory = estimates.memory;
    node.estimatedRisk = estimates.risk;
    console.log('[PLANNER_COST_ESTIMATE]', {
      taskId: node.id,
      tool: tool,
      score,
      category,
      estimates
    });
    console.log('[PLANNER_COST_BREAKDOWN]', {
      taskId: node.id,
      tool,
      time: estimates.time,
      tokens: estimates.tokens,
      io: estimates.io,
      cpu: estimates.cpu,
      memory: estimates.memory,
      risk: estimates.risk,
      score,
      category
    });
  }

  createPlan(tasks) {
    this.graph.create();
    this.taskMap = new Map();
    for (const task of tasks) {
      this._addTask(task);
    }
    this._updateReadyStates();
    this.totalPlanCost();
  }

  getNextTask() {
    this._updateReadyStates();
    const ready = this.graph.allNodes().filter(n => n.status === TaskStatus.READY);
    if (ready.length === 0) {
      const remaining = this.remainingTasks();
      if (remaining.length > 0) {
        const blocked = remaining.filter(t => t.status === TaskStatus.BLOCKED);
        const failed = remaining.filter(t => t.status === TaskStatus.FAILED);
        const pending = remaining.filter(t => t.status === TaskStatus.PENDING);
        console.log('[PLANNER_NO_READY_TASK]', {
          totalRemaining: remaining.length,
          blocked: blocked.length,
          failed: failed.length,
          pending: pending.length
        });
      }
      return null;
    }

    // Phase 4.10: Reorder by priority descending (highest first)
    if (ready.length > 1) {
      const sorted = sortReadyTasksByPriority(ready);
      ready.length = 0;
      ready.push(...sorted);
      console.log('[PLANNER_PRIORITY_ORDER]', {
        count: ready.length,
        order: ready.map(t => ({ id: t.id, tool: t.tool, priority: getTaskPriority(t) }))
      });
    }

    const next = pickNextPlannerTask(ready);
    if (next) {
      console.log('[PLANNER_NEXT]', {
        id: next.id,
        kind: next.kind,
        goal: (next.goal || '').substring(0, 80),
        priority: getTaskPriority(next)
      });
      console.log('[PlannerPriority]', `ready=${ready.length} selected=${next.tool || 'N/A'} priority=${getTaskPriority(next)}`);
    }
    return next || null;
  }

  markSuccess(taskId, result) {
    const task = this.taskMap.get(taskId);
    if (!task) return false;
    task.status = TaskStatus.SUCCESS;
    task.result = result;
    task.touch();
    console.log('[PLANNER_SUCCESS]', { id: taskId, kind: task.kind });
    unlockChildren(this.graph, taskId);
    this._updateReadyStates();
    this._evaluateAndApplyBranch(taskId);
    this._logCompletion();
    return true;
  }

  markFailure(taskId, reason) {
    const task = this.taskMap.get(taskId);
    if (!task) return false;
    task.status = TaskStatus.FAILED;
    task.reason = reason;
    task.retryCount += 1;
    task.touch();
    console.log('[PLANNER_FAILURE]', { id: taskId, kind: task.kind, reason, retryCount: task.retryCount });
    blockChildren(this.graph, taskId, reason);
    this._updateReadyStates();
    this._evaluateAndApplyBranch(taskId);
    return true;
  }

  markBlocked(taskId, reason) {
    const task = this.taskMap.get(taskId);
    if (!task) return false;
    task.status = TaskStatus.BLOCKED;
    task.reason = reason;
    task.touch();
    console.log('[PLANNER_BLOCKED]', { id: taskId, kind: task.kind, reason });
    blockChildren(this.graph, taskId, reason);
    this._updateReadyStates();
    this._evaluateAndApplyBranch(taskId);
    return true;
  }

  markRecovering(taskId) {
    const task = this.taskMap.get(taskId);
    if (!task) return false;
    task.status = TaskStatus.RECOVERING;
    task.touch();
    console.log('[PLANNER_RECOVERING]', { id: taskId, kind: task.kind });
    return true;
  }

  markRecovered(taskId) {
    const task = this.taskMap.get(taskId);
    if (!task) return false;
    task.status = TaskStatus.RECOVERED;
    task.touch();
    console.log('[PLANNER_RECOVERED]', { id: taskId, kind: task.kind });
    // Unblock children so the original flow can continue after recovery
    unlockChildren(this.graph, taskId);
    this._updateReadyStates();
    this._evaluateAndApplyBranch(taskId);
    return true;
  }

  markRecoveryFailed(taskId, reason) {
    const task = this.taskMap.get(taskId);
    if (!task) return false;
    task.status = TaskStatus.RECOVERY_FAILED;
    task.reason = reason;
    task.touch();
    console.log('[PLANNER_RECOVERY_FAILED]', { id: taskId, kind: task.kind, reason });
    // Block children — recovery failure is terminal
    blockChildren(this.graph, taskId, reason);
    this._updateReadyStates();
    return true;
  }

  addRecoveryTasks(failedTaskId, recoveryTasks) {
    const failedTask = this.taskMap.get(failedTaskId);
    if (!failedTask) return false;
    const addedIds = [];
    for (let i = 0; i < recoveryTasks.length; i++) {
      const rt = recoveryTasks[i];
      // Chain recovery tasks: each depends on the previous one
      const existingDeps = rt.dependencies || [];
      const deps = Array.isArray(existingDeps) ? [...existingDeps] : [];
      if (i > 0) {
        deps.push(addedIds[i - 1]);
      } else {
        // First recovery task depends on the failed task (RECOVERING)
        deps.push(failedTaskId);
      }
      rt.dependencies = deps;
      this._addTask(rt);
      addedIds.push(rt.id);
      console.log('[PLANNER_RECOVERY_TASK]', { id: rt.id, kind: rt.kind, goal: (rt.goal || '').substring(0, 80) });
    }
    // Manually set first recovery task to READY since it depends on RECOVERING (not SUCCESS)
    if (addedIds.length > 0) {
      const first = this.taskMap.get(addedIds[0]);
      if (first && first.status === TaskStatus.PENDING) {
        first.status = TaskStatus.READY;
        first.touch();
        console.log('[PLANNER_RECOVERY_READY]', { id: first.id, kind: first.kind });
      }
    }
    this._updateReadyStates();
    return addedIds;
  }

  getRecoveryTasks() {
    return this.graph.allNodes().filter(t =>
      t.kind === 'RECOVERY' ||
      t.status === TaskStatus.RECOVERING
    );
  }

  hasRecoveryForTask(taskId) {
    const node = this.taskMap.get(taskId);
    if (!node) return false;
    // Check if any child is a recovery task (depends on this task)
    for (const childId of node.children) {
      const child = this.taskMap.get(childId);
      if (child && child.kind === 'RECOVERY') return true;
    }
    return false;
  }

  isComplete() {
    const all = this.graph.allNodes();
    if (all.length === 0) return false;

    const hasFailed = all.some(t => t.status === TaskStatus.FAILED);
    const hasBlocked = all.some(t => t.status === TaskStatus.BLOCKED);
    const hasRecoveryFailed = all.some(t => t.status === TaskStatus.RECOVERY_FAILED);
    if (hasFailed || hasBlocked || hasRecoveryFailed) return false;

    return all.every(t =>
      t.status === TaskStatus.SUCCESS ||
      t.status === TaskStatus.SKIPPED ||
      t.status === TaskStatus.RECOVERED
    );
  }

  remainingTasks() {
    return this.graph.allNodes().filter(t =>
      t.status !== TaskStatus.SUCCESS &&
      t.status !== TaskStatus.SKIPPED &&
      t.status !== TaskStatus.RECOVERED
    );
  }

  explainBlocked(taskId) {
    return explainBlocked(this.graph, taskId);
  }

  _updateReadyStates() {
    updateReadyStates(this.graph);
  }

  _logCompletion() {
    if (this.isComplete()) {
      const all = this.graph.allNodes();
      const succeeded = all.filter(t => t.status === TaskStatus.SUCCESS).length;
      const failed = all.filter(t => t.status === TaskStatus.FAILED).length;
      const skipped = all.filter(t => t.status === TaskStatus.SKIPPED).length;
      console.log('[PLANNER_COMPLETE]', { total: all.length, succeeded, failed, skipped });
    }
  }

  // Phase 4.11: Get the task the model should be working on (highest-priority READY task without tool set)
  getActiveTask() {
    const ready = this.graph.allNodes().filter(n => n.status === TaskStatus.READY);
    if (ready.length === 0) return null;
    // If any READY task has a tool set, that's the one being dispatched directly
    const withTool = ready.filter(t => t.tool);
    if (withTool.length > 0) return withTool[0];
    // Otherwise, the model is being called for the highest-priority CODING task
    return pickNextPlannerTask(ready);
  }

  // Phase 4.11: Get the task that should be receiving model tool results (fallback path)
  getModelTask() {
    const ready = this.graph.allNodes().filter(n => n.status === TaskStatus.READY && !n.tool);
    if (ready.length === 0) return null;
    return pickNextPlannerTask(ready);
  }

  // Phase 4.9: Cost Estimation API

  estimateCost(task) {
    const tool = task.tool;
    if (!tool) return { score: 7, category: CostCategory.MEDIUM, estimates: { time: CostCategory.MEDIUM, tokens: CostCategory.HIGH, io: CostCategory.LOW, cpu: CostCategory.LOW, memory: CostCategory.MEDIUM, risk: CostCategory.MEDIUM } };
    return estimateForTool(tool);
  }

  totalPlanCost() {
    const all = this.graph.allNodes();
    const tasks = all.filter(t => t.estimatedCost !== null && t.estimatedCost !== undefined);
    const totalScore = tasks.reduce((sum, t) => sum + t.estimatedCost, 0);
    const avgScore = tasks.length > 0 ? Math.round(totalScore / tasks.length) : 0;
    let category;
    if (avgScore <= 3) category = CostCategory.LOW;
    else if (avgScore <= 7) category = CostCategory.MEDIUM;
    else if (avgScore <= 11) category = CostCategory.HIGH;
    else category = CostCategory.VERY_HIGH;
    console.log('[PLANNER_TOTAL_COST]', { totalScore, taskCount: tasks.length, avgScore, category });
    return { totalScore, taskCount: tasks.length, avgScore, category };
  }

  parallelGroupCost() {
    if (this.currentParallelGroupIndex < 0 || this.currentParallelGroupIndex >= this.parallelGroups.length) {
      return { totalScore: 0, taskCount: 0 };
    }
    const group = this.parallelGroups[this.currentParallelGroupIndex];
    const tasks = group.filter(t => t.estimatedCost !== null && t.estimatedCost !== undefined);
    const totalScore = tasks.reduce((sum, t) => sum + t.estimatedCost, 0);
    console.log('[PLANNER_GROUP_COST]', {
      groupIndex: this.currentParallelGroupIndex,
      totalScore,
      taskCount: tasks.length,
      tasks: tasks.map(t => ({ id: t.id, tool: t.tool, estimatedCost: t.estimatedCost }))
    });
    return { totalScore, taskCount: tasks.length };
  }

  costBreakdown(task) {
    const tool = task.tool;
    if (!tool) {
      return { time: CostCategory.MEDIUM, tokens: CostCategory.HIGH, io: CostCategory.LOW, cpu: CostCategory.LOW, memory: CostCategory.MEDIUM, risk: CostCategory.MEDIUM, score: 7, category: CostCategory.MEDIUM };
    }
    const est = estimateForTool(tool);
    const breakdown = {
      time: est.estimates.time,
      tokens: est.estimates.tokens,
      io: est.estimates.io,
      cpu: est.estimates.cpu,
      memory: est.estimates.memory,
      risk: est.estimates.risk,
      score: est.score,
      category: est.category
    };
    console.log('[PLANNER_COST_BREAKDOWN]', {
      taskId: task.id,
      tool,
      ...breakdown
    });
    return breakdown;
  }

  // Phase 4.7: Conditional Branch Planner
  // Evaluate which branch fires based on a completed task's status.
  evaluateBranch(taskId) {
    const task = this.taskMap.get(taskId);
    if (!task) return null;

    const status = task.status;
    const branchMap = {
      [TaskStatus.SUCCESS]: BranchType.SUCCESS,
      [TaskStatus.FAILED]: BranchType.FAILURE,
      [TaskStatus.RECOVERED]: BranchType.RECOVERED,
      [TaskStatus.BLOCKED]: BranchType.BLOCKED,
      [TaskStatus.SKIPPED]: BranchType.SKIPPED
    };

    const branch = branchMap[status];
    if (!branch) return null;

    // Verify the task has a branch target for this type
    const targetId = this._branchTarget(task, branch);
    if (!targetId) return null;

    return { branch, targetId };
  }

  // Return the branch type that was selected for a task.
  branchType(taskId) {
    const task = this.taskMap.get(taskId);
    return task ? task.branchType : null;
  }

  // Return why a branch was chosen for a task.
  branchReason(taskId) {
    const task = this.taskMap.get(taskId);
    return task ? task.branchReason : null;
  }

  // Return the next task id for a given branch of a task.
  _branchTarget(task, branch) {
    switch (branch) {
      case BranchType.SUCCESS: return task.successNext;
      case BranchType.FAILURE: return task.failureNext;
      case BranchType.RECOVERED: return task.recoveredNext;
      case BranchType.BLOCKED: return task.blockedNext;
      case BranchType.SKIPPED: return task.skipNext;
      default: return null;
    }
  }

  // Phase 4.7: After a task completes, evaluate branches and SKIP alternative paths.
  _evaluateAndApplyBranch(taskId) {
    const task = this.taskMap.get(taskId);
    if (!task) return;

    // Collect all branch targets defined on this task
    const allBranches = {};
    if (task.successNext) allBranches[BranchType.SUCCESS] = task.successNext;
    if (task.failureNext) allBranches[BranchType.FAILURE] = task.failureNext;
    if (task.recoveredNext) allBranches[BranchType.RECOVERED] = task.recoveredNext;
    if (task.blockedNext) allBranches[BranchType.BLOCKED] = task.blockedNext;
    if (task.skipNext) allBranches[BranchType.SKIPPED] = task.skipNext;

    const branchKeys = Object.keys(allBranches);
    if (branchKeys.length === 0) return; // No branches defined

    const statusToBranch = {
      [TaskStatus.SUCCESS]: BranchType.SUCCESS,
      [TaskStatus.FAILED]: BranchType.FAILURE,
      [TaskStatus.RECOVERED]: BranchType.RECOVERED,
      [TaskStatus.BLOCKED]: BranchType.BLOCKED,
      [TaskStatus.SKIPPED]: BranchType.SKIPPED
    };

    const firingBranch = statusToBranch[task.status];
    if (!firingBranch) return; // Not a terminal status

    const selectedTarget = allBranches[firingBranch];

    // Record branch decision on the task
    task.branchType = firingBranch;
    task.branchReason = `Task ${taskId} completed with status ${task.status}; selected branch ${firingBranch}`;
    task.touch();

    console.log('[PLANNER_BRANCH_EVALUATION]', {
      taskId: task.id,
      status: task.status,
      firingBranch,
      selectedTarget,
      allBranches
    });

    if (selectedTarget) {
      console.log('[PLANNER_BRANCH_SELECTED]', {
        taskId: task.id,
        branch: firingBranch,
        nextTaskId: selectedTarget
      });
    }

    // Emit PLANNER_BRANCH_SKIPPED for every non-selected branch type, including undefined ones
    const ALL_BRANCH_TYPES = [BranchType.SUCCESS, BranchType.FAILURE, BranchType.RECOVERED, BranchType.BLOCKED, BranchType.SKIPPED];
    for (const branchType of ALL_BRANCH_TYPES) {
      if (branchType === firingBranch) continue;
      const targetId = allBranches[branchType] || null;
      console.log('[PLANNER_BRANCH_SKIPPED]', {
        taskId: task.id,
        branch: branchType,
        skippedTaskId: targetId
      });
      if (targetId) {
        const target = this.taskMap.get(targetId);
        if (target && (target.status === TaskStatus.PENDING || target.status === TaskStatus.READY || target.status === TaskStatus.BLOCKED)) {
          this._skipRecursive(targetId);
        }
      }
    }

    // Activate the selected branch target — override BLOCKED/PENDING to READY
    if (selectedTarget) {
      const targetNode = this.taskMap.get(selectedTarget);
      if (targetNode && targetNode.status !== TaskStatus.SKIPPED && targetNode.status !== TaskStatus.SUCCESS && targetNode.status !== TaskStatus.FAILED) {
        targetNode.status = TaskStatus.READY;
        targetNode.touch();
        console.log('[PLANNER_BRANCH_ACTIVATED]', { taskId: task.id, branchTarget: selectedTarget });
      }
    }

    console.log('[PLANNER_BRANCH_COMPLETED]', {
      taskId: task.id,
      selectedBranch: firingBranch,
      selectedTarget: selectedTarget || null
    });
  }

  // Recursively skip a task and all its descendants (dead branch path).
  _skipRecursive(taskId) {
    const task = this.taskMap.get(taskId);
    if (!task) return;
    if (task.status === TaskStatus.SKIPPED || task.status === TaskStatus.SUCCESS || task.status === TaskStatus.FAILED) return;

    console.log('[PLANNER_BRANCH_SKIPPED_RECURSIVE]', { taskId: task.id, kind: task.kind });
    task.status = TaskStatus.SKIPPED;
    task.reason = 'Alternative branch not taken';
    task.branchType = BranchType.SKIPPED;
    task.branchReason = `Task ${taskId} skipped because sibling branch was selected`;
    task.touch();

    for (const childId of task.children) {
      this._skipRecursive(childId);
    }
  }

  // Phase 4.8: Parallel Planner — Conflict Detection, Scheduler, Worker Model

  // Detect conflicts between two tasks for parallel execution
  _detectConflicts(a, b) {
    if (!a.tool || !b.tool) return false;

    // Same terminal commands always conflict
    if (a.tool === 'RUN_TERMINAL' && b.tool === 'RUN_TERMINAL') {
      console.log('[PLANNER_CONFLICT]', {
        taskA: a.id, taskB: b.id,
        reason: 'Same terminal command'
      });
      return true;
    }

    // WRITE_FILE + WRITE_FILE on same path
    if (a.tool === 'WRITE_FILE' && b.tool === 'WRITE_FILE') {
      const same = a.toolArgs?.path === b.toolArgs?.path;
      if (same) {
        console.log('[PLANNER_CONFLICT]', {
          taskA: a.id, taskB: b.id,
          reason: `Same write target: ${a.toolArgs?.path}`
        });
      }
      return same;
    }

    // APPLY_PATCH + APPLY_PATCH on same file
    if (a.tool === 'APPLY_PATCH' && b.tool === 'APPLY_PATCH') {
      const same = a.toolArgs?.file === b.toolArgs?.file;
      if (same) {
        console.log('[PLANNER_CONFLICT]', {
          taskA: a.id, taskB: b.id,
          reason: `Same patch target: ${a.toolArgs?.file}`
        });
      }
      return same;
    }

    // WRITE_FILE + APPLY_PATCH on same path/file
    if ((a.tool === 'WRITE_FILE' && b.tool === 'APPLY_PATCH') ||
        (a.tool === 'APPLY_PATCH' && b.tool === 'WRITE_FILE')) {
      const aPath = a.toolArgs?.path || a.toolArgs?.file;
      const bPath = b.toolArgs?.path || b.toolArgs?.file;
      const same = aPath && bPath && aPath === bPath;
      if (same) {
        console.log('[PLANNER_CONFLICT]', {
          taskA: a.id, taskB: b.id,
          reason: `Same resource target: ${aPath}`
        });
      }
      return same;
    }

    // WRITE_FILE + READ_FILE on same path
    if ((a.tool === 'WRITE_FILE' && b.tool === 'READ_FILE') ||
        (a.tool === 'READ_FILE' && b.tool === 'WRITE_FILE')) {
      const same = a.toolArgs?.path === b.toolArgs?.path;
      if (same) {
        console.log('[PLANNER_CONFLICT]', {
          taskA: a.id, taskB: b.id,
          reason: `Read-write conflict: ${a.toolArgs?.path}`
        });
      }
      return same;
    }

    return false;
  }

  // Group ready tasks into non-conflicting parallel groups
  _buildParallelGroups(readyTasks) {
    const groups = [];
    for (const task of readyTasks) {
      let added = false;
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const hasConflict = group.some(t => this._detectConflicts(task, t));
        if (!hasConflict) {
          group.push(task);
          added = true;
          break;
        }
      }
      if (!added) {
        groups.push([task]);
      }
    }
    return groups;
  }

  // Find all parallel-ready task groups from current READY tasks
  findParallelReadyTasks() {
    this._updateReadyStates();
    let ready = this.graph.allNodes().filter(n => n.status === TaskStatus.READY);
    if (ready.length === 0) return [];

    // Phase 4.10: Sort by priority descending so high-priority tasks get into early groups
    ready = sortReadyTasksByPriority(ready);

    const groups = this._buildParallelGroups(ready);
    this.parallelGroups = groups;
    this.currentParallelGroupIndex = -1;
    this.parallelMode = true;

    for (let i = 0; i < groups.length; i++) {
      const groupCost = groups[i].reduce((sum, t) => sum + (t.estimatedCost || 7), 0);
      const priorities = groups[i].map(t => getTaskPriority(t));
      console.log('[PLANNER_PARALLEL_GROUP]', {
        groupIndex: i,
        taskCount: groups[i].length,
        totalCost: groupCost,
        tasks: groups[i].map(t => ({ id: t.id, tool: t.tool, estimatedCost: t.estimatedCost, goal: (t.goal || '').substring(0, 60) }))
      });
      if (i === 0) {
        console.log('[PlannerPriority]', `batch=${groups.length} topPriorities=${priorities.slice(0, 3).join(',')}`);
      }
    }

    return groups;
  }

  // Get the next parallel group to execute (starts its execution)
  nextParallelGroup() {
    let nextIndex = this.currentParallelGroupIndex + 1;

    // If all groups consumed, recompute from newly READY tasks (e.g., after merge)
    if (nextIndex >= this.parallelGroups.length) {
      const groups = this.findParallelReadyTasks();
      if (groups.length === 0) return null;
      nextIndex = this.currentParallelGroupIndex + 1;
    }

    if (nextIndex >= this.parallelGroups.length) return null;
    this.currentParallelGroupIndex = nextIndex;
    const group = this.parallelGroups[nextIndex];

    this.parallelGroupCost();

    console.log('[PLANNER_PARALLEL_START]', {
      groupIndex: nextIndex,
      taskCount: group.length,
      tasks: group.map(t => ({ id: t.id, tool: t.tool }))
    });

    for (const task of group) {
      console.log('[PLANNER_PARALLEL_TASK]', {
        groupIndex: nextIndex,
        taskId: task.id,
        tool: task.tool,
        goal: (task.goal || '').substring(0, 60)
      });
    }

    return group;
  }

  // Check if the current parallel group is complete (all tasks terminal)
  isParallelGroupComplete() {
    if (this.currentParallelGroupIndex < 0 || this.currentParallelGroupIndex >= this.parallelGroups.length) return true;
    const group = this.parallelGroups[this.currentParallelGroupIndex];
    if (!group) return true;

    return group.every(t =>
      t.status === TaskStatus.SUCCESS ||
      t.status === TaskStatus.FAILED ||
      t.status === TaskStatus.SKIPPED ||
      t.status === TaskStatus.BLOCKED ||
      t.status === TaskStatus.RECOVERED ||
      t.status === TaskStatus.RECOVERY_FAILED ||
      t.status === TaskStatus.RECOVERING
    );
  }

  // Wait for the current parallel group to complete
  waitParallelGroup() {
    if (this.currentParallelGroupIndex < 0) return;
    console.log('[PLANNER_PARALLEL_WAIT]', {
      groupIndex: this.currentParallelGroupIndex
    });
  }

  // Merge results of the current parallel group
  mergeParallelGroup() {
    if (this.currentParallelGroupIndex < 0 || this.currentParallelGroupIndex >= this.parallelGroups.length) return;
    const group = this.parallelGroups[this.currentParallelGroupIndex];
    if (!group) return;

    const succeeded = group.filter(t => t.status === TaskStatus.SUCCESS).length;
    const failed = group.filter(t => t.status === TaskStatus.FAILED).length;
    const skipped = group.filter(t => t.status === TaskStatus.SKIPPED).length;
    const blocked = group.filter(t => t.status === TaskStatus.BLOCKED).length;
    const recovered = group.filter(t => t.status === TaskStatus.RECOVERED).length;

    console.log('[PLANNER_PARALLEL_COMPLETE]', {
      groupIndex: this.currentParallelGroupIndex,
      total: group.length,
      succeeded,
      failed,
      skipped,
      blocked,
      recovered
    });

    console.log('[PLANNER_PARALLEL_MERGE]', {
      groupIndex: this.currentParallelGroupIndex
    });

    if (blocked > 0) {
      console.log('[PLANNER_PARALLEL_BLOCKED]', {
        groupIndex: this.currentParallelGroupIndex,
        tasks: group.filter(t => t.status === TaskStatus.BLOCKED).map(t => ({ id: t.id, reason: t.reason }))
      });
    }

    this._updateReadyStates();
    this._logCompletion();
  }
}
