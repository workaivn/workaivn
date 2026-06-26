import { TaskStatus } from './plannerTypes.js';
import {
  canRun as utilCanRun,
  dependencySatisfied as utilDepSatisfied,
  getUnsatisfiedDependencies as utilUnsatisfied,
  getFailedDependencies as utilFailed,
  getBlockedDependencies as utilBlocked,
  allDependenciesSatisfied,
  anyDependencyFailedOrBlocked
} from './dependencyUtils.js';

export function canRun(graph, taskId) {
  const node = graph.getNode(taskId);
  return utilCanRun(node, graph._nodes);
}

export function dependencySatisfied(graph, taskId) {
  const node = graph.getNode(taskId);
  if (!node) return false;
  if (node.dependencies.size === 0) return true;
  for (const depId of node.dependencies) {
    if (!utilDepSatisfied(depId, graph._nodes)) return false;
  }
  return true;
}

export function getUnsatisfiedDependencies(graph, taskId) {
  const node = graph.getNode(taskId);
  return utilUnsatisfied(node, graph._nodes);
}

export function getFailedDependencies(graph, taskId) {
  const node = graph.getNode(taskId);
  return utilFailed(node, graph._nodes);
}

export function unlockChildren(graph, taskId) {
  const task = graph.getNode(taskId);
  if (!task) return;

  for (const childId of task.children) {
    const child = graph.getNode(childId);
    if (!child) continue;
    if (child.status !== TaskStatus.PENDING) continue;

    if (allDependenciesSatisfied(child, graph._nodes)) {
      child.status = TaskStatus.READY;
      child.touch();
      console.log('[DEPENDENCY_RELEASED]', { id: childId, kind: child.kind, goal: (child.goal || '').substring(0, 80) });
    }
  }
}

export function blockChildren(graph, taskId, reason) {
  const task = graph.getNode(taskId);
  if (!task) return;

  const queue = [...task.children];
  const visited = new Set();

  while (queue.length > 0) {
    const childId = queue.shift();
    if (visited.has(childId)) continue;
    visited.add(childId);

    const child = graph.getNode(childId);
    if (!child) continue;
    if (child.status === TaskStatus.SUCCESS || child.status === TaskStatus.SKIPPED) continue;

    if (child.status !== TaskStatus.BLOCKED) {
      child.status = TaskStatus.BLOCKED;
      child.reason = `Parent dependency failed: ${reason}`;
      child.touch();
      console.log('[DEPENDENCY_BLOCKED]', { id: childId, kind: child.kind, reason: child.reason });
    }

    for (const grandchildId of child.children) {
      queue.push(grandchildId);
    }
  }
}

export function updateReadyStates(graph) {
  const transitions = { ready: 0, blocked: 0 };

  for (const node of graph.allNodes()) {
    if (node.status !== TaskStatus.PENDING) continue;

    if (anyDependencyFailedOrBlocked(node, graph._nodes)) {
      node.status = TaskStatus.BLOCKED;
      const failed = utilFailed(node, graph._nodes);
      const blocked = utilBlocked(node, graph._nodes);
      const causes = [];
      if (failed.length > 0) causes.push(`failed: ${failed[0].id} - ${failed[0].reason}`);
      if (blocked.length > 0) causes.push(`blocked: ${blocked[0].id} - ${blocked[0].reason}`);
      node.reason = `Dependency ${causes.join('; ')}`;
      node.touch();
      console.log('[DEPENDENCY_BLOCKED]', { id: node.id, kind: node.kind, reason: node.reason });
      transitions.blocked++;
      continue;
    }

    if (allDependenciesSatisfied(node, graph._nodes)) {
      node.status = TaskStatus.READY;
      node.touch();
      console.log('[DEPENDENCY_READY]', { id: node.id, kind: node.kind, goal: (node.goal || '').substring(0, 80) });
      transitions.ready++;
    }
  }

  if (transitions.ready > 0 || transitions.blocked > 0) {
    console.log('[PLANNER_DEPENDENCY_STATUS]', { ready: transitions.ready, blocked: transitions.blocked });
  }
}

export function explainBlocked(graph, taskId) {
  const task = graph.getNode(taskId);
  if (!task) return { blocked: false, reasons: [] };

  const reasons = [];

  for (const depId of task.dependencies) {
    const dep = graph.getNode(depId);
    if (!dep) {
      reasons.push({ dependency: depId, status: 'MISSING', reason: 'Dependency node does not exist' });
    } else if (dep.status === TaskStatus.FAILED) {
      reasons.push({ dependency: depId, status: 'FAILED', reason: dep.reason || 'Unknown failure' });
    } else if (dep.status === TaskStatus.BLOCKED) {
      const sub = explainBlocked(graph, depId);
      reasons.push({ dependency: depId, status: 'BLOCKED', reason: dep.reason || 'Unknown block', causes: sub.reasons });
    } else if (dep.status !== TaskStatus.SUCCESS && dep.status !== TaskStatus.SKIPPED) {
      reasons.push({ dependency: depId, status: dep.status, reason: 'Not yet completed' });
    }
  }

  return { blocked: task.status === TaskStatus.BLOCKED, reasons };
}
