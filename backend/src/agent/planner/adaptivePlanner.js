import { getTaskPriority } from './priorityQueue.js';
import { ExecutionMemoryStatus } from './executionMemory.js';
import { TaskStatus } from './plannerTypes.js';

const COST_SCALE = Object.freeze({
  LOW: 1,
  MEDIUM: 3,
  HIGH: 7,
  VERY_HIGH: 11
});

const METRIC_SCALE = Object.freeze({
  LOW: 1,
  MEDIUM: 3,
  HIGH: 7,
  VERY_HIGH: 11
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function categoryValue(value, fallback = 0) {
  if (value == null) return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const key = String(value).toUpperCase();
  return METRIC_SCALE[key] ?? COST_SCALE[key] ?? fallback;
}

function estimateDuration(task) {
  if (!task) return 0;
  if (task.estimatedTime != null) {
    return categoryValue(task.estimatedTime, 0) || toNumber(task.estimatedTime, 0);
  }
  if (task.estimatedCost != null) {
    return Math.max(1, Math.round(toNumber(task.estimatedCost, 0) / 2));
  }
  return categoryValue(task.estimatedCategory, 3);
}

function estimateLoad(task, field, fallback = 0) {
  if (!task) return fallback;
  const value = task[field];
  if (value == null) return fallback;
  return categoryValue(value, fallback) || toNumber(value, fallback);
}

function collectNodes(planner) {
  return typeof planner?.graph?.allNodes === 'function' ? planner.graph.allNodes() : [];
}

function getDependencyDepth(node, nodeMap, memo = new Map()) {
  if (!node) return 0;
  if (memo.has(node.id)) return memo.get(node.id);
  const deps = [...(node.dependencies || [])].map(depId => nodeMap.get(depId)).filter(Boolean);
  if (deps.length === 0) {
    memo.set(node.id, 0);
    return 0;
  }
  let depth = 0;
  for (const dep of deps) {
    depth = Math.max(depth, 1 + getDependencyDepth(dep, nodeMap, memo));
  }
  memo.set(node.id, depth);
  return depth;
}

function getCacheDecision(planner, task, context = {}) {
  const lookup = planner?.executionMemory?.lookup?.(task, context) || {
    status: ExecutionMemoryStatus.NOT_EXECUTED,
    record: null
  };
  const skipReason = planner?.executionHistory?.skipReason?.(task?.tool, task?.toolArgs || {}) || null;
  const hit = Boolean(
    lookup.status === ExecutionMemoryStatus.SUCCEEDED ||
    lookup.status === ExecutionMemoryStatus.SKIPPED ||
    lookup.status === ExecutionMemoryStatus.RECOVERED ||
    skipReason
  );
  const probability = hit ? 1 : (lookup.status === ExecutionMemoryStatus.RUNNING ? 0.5 : 0);
  return {
    hit,
    probability,
    reason: skipReason || lookup.status || 'MISS',
    lookupStatus: lookup.status,
    lookupRecord: lookup.record || null,
    skipReason
  };
}

function getRetryRisk(task) {
  const attempts = Math.max(0, toNumber(task?.attempts, 0));
  const retryCount = Math.max(0, toNumber(task?.retryCount, 0));
  const stallCount = Math.max(0, toNumber(task?.stallCount, 0));
  const maxAttempts = Math.max(1, toNumber(task?.maxAttempts, 3));
  const observed = attempts + retryCount + stallCount;
  const ratio = clamp(observed / maxAttempts, 0, 1);
  return {
    attempts,
    retryCount,
    stallCount,
    maxAttempts,
    ratio,
    remainingBudget: Math.max(0, maxAttempts - observed)
  };
}

function analyzeTask(planner, task, context = {}) {
  const basePriority = task?.priority != null ? Number(task.priority) : getTaskPriority(task);
  const cacheDecision = getCacheDecision(planner, task, context);
  const nodeMap = new Map(collectNodes(planner).map(node => [node.id, node]));
  const dependencyDepth = getDependencyDepth(task, nodeMap);
  const retryRisk = getRetryRisk(task);
  const estimatedCost = toNumber(task?.estimatedCost, 0);
  const estimatedDuration = estimateDuration(task);
  const estimatedIO = estimateLoad(task, 'estimatedIO', 0);
  const estimatedCPU = estimateLoad(task, 'estimatedCPU', 0);
  const estimatedMemory = estimateLoad(task, 'estimatedMemory', 0);
  const estimatedRisk = estimateLoad(task, 'estimatedRisk', 0);
  const costBias = estimatedCost > 0 ? clamp(Math.round((11 - Math.min(estimatedCost, 11)) / 2), -2, 3) : 0;
  const cacheBonus = cacheDecision.hit ? 12 : Math.round(cacheDecision.probability * 6);
  const historyBonus = (planner?.executionHistory?.completedTools?.length || 0) > 0 && task?.tool ? 1 : 0;
  const depthBonus = clamp(dependencyDepth, 0, 5);
  const retryPenalty = clamp(Math.round(retryRisk.ratio * 10), 0, 10);
  const adaptivePriority = clamp(
    Math.round(basePriority + costBias + cacheBonus + historyBonus + depthBonus - retryPenalty),
    0,
    100
  );
  const parallelSafe = task?.status !== TaskStatus.BLOCKED && task?.status !== TaskStatus.FAILED;

  return {
    taskId: task?.id || null,
    tool: task?.tool || null,
    kind: task?.kind || null,
    status: task?.status || null,
    createdAt: task?.createdAt ?? null,
    sourceIndex: context?.sourceIndex ?? null,
    basePriority,
    adaptivePriority,
    estimatedCost,
    estimatedDuration,
    estimatedIO,
    estimatedCPU,
    estimatedMemory,
    estimatedRisk,
    dependencyDepth,
    cacheDecision: {
      hit: cacheDecision.hit,
      probability: cacheDecision.probability,
      reason: cacheDecision.reason
    },
    retryAnalysis: retryRisk,
    parallelSafe
  };
}

function sortAnalyzedTasks(items = []) {
  return [...items].sort((a, b) => {
    if (b.adaptivePriority !== a.adaptivePriority) return b.adaptivePriority - a.adaptivePriority;
    if (b.basePriority !== a.basePriority) return b.basePriority - a.basePriority;
    if (b.estimatedCost !== a.estimatedCost) return a.estimatedCost - b.estimatedCost;
    if (b.dependencyDepth !== a.dependencyDepth) return b.dependencyDepth - a.dependencyDepth;
    if (a.sourceIndex != null || b.sourceIndex != null) {
      const aIndex = a.sourceIndex ?? 0;
      const bIndex = b.sourceIndex ?? 0;
      if (aIndex !== bIndex) return aIndex - bIndex;
    }
    if (a.createdAt != null || b.createdAt != null) {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (aTime !== bTime) return aTime - bTime;
    }
    return String(a.taskId || '').localeCompare(String(b.taskId || ''));
  });
}

function buildParallelGroups(planner, tasks, context = {}) {
  const groups = [];
  if (!Array.isArray(tasks) || tasks.length === 0) return groups;

  const ordered = sortAnalyzedTasks(tasks.map((task, index) => analyzeTask(planner, task, { ...context, sourceIndex: index })));
  const taskById = new Map(collectNodes(planner).map(node => [node.id, node]));

  for (const analyzed of ordered) {
    const task = taskById.get(analyzed.taskId) || null;
    if (!task) continue;
    let placed = false;
    for (const group of groups) {
      const conflict = group.some(existingId => {
        const existingTask = taskById.get(existingId);
        return Boolean(existingTask && typeof planner?._detectConflicts === 'function' && planner._detectConflicts(task, existingTask));
      });
      if (!conflict) {
        group.push(task.id);
        placed = true;
        break;
      }
    }
    if (!placed) {
      groups.push([task.id]);
    }
  }
  return groups;
}

function buildCriticalPath(planner, context = {}) {
  const nodes = collectNodes(planner);
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const memo = new Map();
  const analyze = (node) => {
    if (!node) return { duration: 0, path: [] };
    if (memo.has(node.id)) return memo.get(node.id);
    const deps = [...(node.dependencies || [])].map(depId => nodeMap.get(depId)).filter(Boolean);
    const currentDuration = estimateDuration(node);
    if (deps.length === 0) {
      const result = { duration: currentDuration, path: [node.id] };
      memo.set(node.id, result);
      return result;
    }
    let best = { duration: 0, path: [] };
    for (const dep of deps) {
      const candidate = analyze(dep);
      if (candidate.duration > best.duration) best = candidate;
    }
    const result = {
      duration: best.duration + currentDuration,
      path: [...best.path, node.id]
    };
    memo.set(node.id, result);
    return result;
  };

  let best = { duration: 0, path: [] };
  for (const node of nodes) {
    const candidate = analyze(node);
    if (candidate.duration > best.duration) best = candidate;
  }
  return {
    duration: best.duration,
    path: best.path,
    taskCount: best.path.length
  };
}

function summarizeBottlenecks(analysisList, criticalPath) {
  const longestTask = [...analysisList].sort((a, b) => {
    if (b.estimatedDuration !== a.estimatedDuration) return b.estimatedDuration - a.estimatedDuration;
    return b.adaptivePriority - a.adaptivePriority;
  })[0] || null;

  const mostExpensiveTask = [...analysisList].sort((a, b) => {
    if (b.estimatedCost !== a.estimatedCost) return b.estimatedCost - a.estimatedCost;
    return b.adaptivePriority - a.adaptivePriority;
  })[0] || null;

  const dependencyBottleneck = [...analysisList].sort((a, b) => {
    if (b.dependencyDepth !== a.dependencyDepth) return b.dependencyDepth - a.dependencyDepth;
    return b.estimatedDuration - a.estimatedDuration;
  })[0] || null;

  const cacheMissHotspot = [...analysisList].filter(item => !item.cacheDecision.hit).sort((a, b) => {
    if (b.estimatedCost !== a.estimatedCost) return b.estimatedCost - a.estimatedCost;
    return b.dependencyDepth - a.dependencyDepth;
  })[0] || null;

  const retryHotspot = [...analysisList].sort((a, b) => {
    if (b.retryAnalysis.ratio !== a.retryAnalysis.ratio) return b.retryAnalysis.ratio - a.retryAnalysis.ratio;
    return b.retryAnalysis.attempts - a.retryAnalysis.attempts;
  })[0] || null;

  return {
    longestTask,
    mostExpensiveTask,
    dependencyBottleneck,
    cacheMissHotspot,
    retryHotspot,
    criticalPathTaskIds: [...(criticalPath?.path || [])]
  };
}

function summarizeMetrics(analysisList, criticalPath, parallelGroups) {
  const totalSequentialDuration = analysisList.reduce((sum, item) => sum + item.estimatedDuration, 0);
  const totalIO = analysisList.reduce((sum, item) => sum + item.estimatedIO, 0);
  const totalCPU = analysisList.reduce((sum, item) => sum + item.estimatedCPU, 0);
  const totalMemory = analysisList.reduce((sum, item) => sum + item.estimatedMemory, 0);
  const totalRisk = analysisList.reduce((sum, item) => sum + item.estimatedRisk, 0);
  const cacheHits = analysisList.filter(item => item.cacheDecision.hit).length;
  const cacheable = analysisList.filter(item => item.tool === 'READ_FILE' || item.tool === 'RUN_TERMINAL').length;
  const retryPenalty = analysisList.reduce((sum, item) => sum + Math.round(item.retryAnalysis.ratio * item.estimatedDuration), 0);
  const criticalDuration = criticalPath?.duration || 0;
  const parallelEfficiency = totalSequentialDuration > 0
    ? clamp(1 - (criticalDuration / totalSequentialDuration), 0, 1)
    : 0;
  const cacheUtilization = cacheable > 0 ? cacheHits / cacheable : 0;
  const retryEfficiency = totalSequentialDuration > 0
    ? clamp(1 - (retryPenalty / totalSequentialDuration), 0, 1)
    : 1;
  const plannerEfficiency = clamp((parallelEfficiency + cacheUtilization + retryEfficiency) / 3, 0, 1);
  const executionThroughput = totalSequentialDuration > 0 ? analysisList.length / totalSequentialDuration : 0;
  const expectedRuntime = Math.max(criticalDuration, Math.round(totalSequentialDuration - (parallelEfficiency * totalSequentialDuration) + retryPenalty * 0.25));

  return {
    parallelEfficiency,
    cacheUtilization,
    plannerEfficiency,
    retryEfficiency,
    executionThroughput,
    criticalPathDuration: criticalDuration,
    expectedRuntime,
    expectedIO: totalIO,
    expectedCPU: totalCPU,
    expectedMemory: totalMemory,
    expectedRisk: totalRisk,
    parallelGroupCount: Array.isArray(parallelGroups) ? parallelGroups.length : 0
  };
}

function summarizePrediction(analysisList, criticalPath, metrics) {
  return {
    expectedTotalRuntime: metrics.expectedRuntime,
    criticalPath: {
      duration: criticalPath.duration,
      taskIds: [...criticalPath.path]
    },
    parallelEfficiency: metrics.parallelEfficiency,
    expectedCompletionTime: metrics.expectedRuntime + Math.round(analysisList.reduce((sum, item) => sum + item.retryAnalysis.ratio, 0)),
    expectedIO: metrics.expectedIO,
    expectedCPU: metrics.expectedCPU,
    expectedMemory: metrics.expectedMemory,
    expectedRisk: metrics.expectedRisk
  };
}

export function createAdaptivePlanner(planner) {
  function analyze(context = {}) {
    const nodes = collectNodes(planner);
    const analysis = nodes.map(node => analyzeTask(planner, node, context));
    const sorted = sortAnalyzedTasks(analysis);
    const criticalPath = buildCriticalPath(planner, context);
    const parallelGroups = buildParallelGroups(planner, nodes.filter(node => node.status === TaskStatus.READY), context);
    const metrics = summarizeMetrics(analysis, criticalPath, parallelGroups);
    const prediction = summarizePrediction(analysis, criticalPath, metrics);
    const bottlenecks = summarizeBottlenecks(analysis, criticalPath);
    const priorityAdjustments = analysis.map(item => ({
      taskId: item.taskId,
      basePriority: item.basePriority,
      adaptivePriority: item.adaptivePriority,
      adjustment: item.adaptivePriority - item.basePriority,
      dependencyDepth: item.dependencyDepth,
      cacheProbability: item.cacheDecision.probability,
      retryRisk: item.retryAnalysis.ratio
    }));

    return {
      priorityAdjustments: sortAnalyzedTasks(priorityAdjustments),
      costEvolution: analysis.map(item => ({
        taskId: item.taskId,
        tool: item.tool,
        basePriority: item.basePriority,
        estimatedCost: item.estimatedCost,
        estimatedDuration: item.estimatedDuration,
        estimatedIO: item.estimatedIO,
        estimatedCPU: item.estimatedCPU,
        estimatedMemory: item.estimatedMemory,
        estimatedRisk: item.estimatedRisk
      })),
      parallelOptimization: {
        readyTasks: analysis.filter(item => item.status === TaskStatus.READY).map(item => item.taskId),
        groups: parallelGroups,
        groupCount: parallelGroups.length
      },
      criticalPath,
      cacheDecisions: analysis.map(item => ({
        taskId: item.taskId,
        tool: item.tool,
        hit: item.cacheDecision.hit,
        probability: item.cacheDecision.probability,
        reason: item.cacheDecision.reason
      })),
      retryAnalysis: analysis.map(item => ({
        taskId: item.taskId,
        tool: item.tool,
        attempts: item.retryAnalysis.attempts,
        retryCount: item.retryAnalysis.retryCount,
        stallCount: item.retryAnalysis.stallCount,
        maxAttempts: item.retryAnalysis.maxAttempts,
        remainingBudget: item.retryAnalysis.remainingBudget,
        ratio: item.retryAnalysis.ratio
      })),
      bottlenecks,
      metrics,
      prediction
    };
  }

  return {
    analyze,
    sortReadyTasks(tasks = [], context = {}) {
      const analyzed = tasks.map((task, index) => analyzeTask(planner, task, { ...context, sourceIndex: index }));
      const ordered = sortAnalyzedTasks(analyzed);
      const taskMap = new Map(tasks.map(task => [task.id, task]));
      return ordered.map(item => taskMap.get(item.taskId)).filter(Boolean);
    },
    getPriority(task, context = {}) {
      return analyzeTask(planner, task, context).adaptivePriority;
    },
    buildSnapshot(context = {}) {
      return analyze(context);
    }
  };
}

export {
  analyzeTask,
  buildCriticalPath,
  buildParallelGroups,
  getCacheDecision,
  getRetryRisk
};
