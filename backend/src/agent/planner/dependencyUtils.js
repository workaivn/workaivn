import { TaskStatus } from './plannerTypes.js';

export function canRun(node, nodesMap) {
  if (!node) return false;
  if (node.status !== TaskStatus.PENDING && node.status !== TaskStatus.READY) return false;

  for (const depId of node.dependencies) {
    const dep = nodesMap.get(depId);
    if (!dep) return false;
    if (dep.status !== TaskStatus.SUCCESS && dep.status !== TaskStatus.SKIPPED && dep.status !== TaskStatus.RECOVERED) return false;
  }
  return true;
}

export function dependencySatisfied(depId, nodesMap) {
  const dep = nodesMap.get(depId);
  if (!dep) return false;
  return dep.status === TaskStatus.SUCCESS || dep.status === TaskStatus.SKIPPED || dep.status === TaskStatus.RECOVERED;
}

export function getUnsatisfiedDependencies(node, nodesMap) {
  if (!node) return [];
  const unsatisfied = [];
  for (const depId of node.dependencies) {
    const dep = nodesMap.get(depId);
    if (!dep) {
      unsatisfied.push({ id: depId, reason: 'MISSING' });
    } else if (
      dep.status !== TaskStatus.SUCCESS &&
      dep.status !== TaskStatus.SKIPPED &&
      dep.status !== TaskStatus.FAILED &&
      dep.status !== TaskStatus.BLOCKED
    ) {
      unsatisfied.push({ id: depId, status: dep.status, reason: dep.reason || null });
    }
  }
  return unsatisfied;
}

export function getFailedDependencies(node, nodesMap) {
  if (!node) return [];
  const failed = [];
  for (const depId of node.dependencies) {
    const dep = nodesMap.get(depId);
    if (dep && dep.status === TaskStatus.FAILED) {
      failed.push({ id: depId, reason: dep.reason || 'Unknown failure' });
    }
  }
  return failed;
}

export function getBlockedDependencies(node, nodesMap) {
  if (!node) return [];
  const blocked = [];
  for (const depId of node.dependencies) {
    const dep = nodesMap.get(depId);
    if (dep && dep.status === TaskStatus.BLOCKED) {
      blocked.push({ id: depId, reason: dep.reason || 'Unknown block' });
    }
  }
  return blocked;
}

export function allDependenciesSatisfied(node, nodesMap) {
  if (!node || node.dependencies.size === 0) return true;
  for (const depId of node.dependencies) {
    if (!dependencySatisfied(depId, nodesMap)) return false;
  }
  return true;
}

export function anyDependencyFailedOrBlocked(node, nodesMap) {
  if (!node) return false;
  for (const depId of node.dependencies) {
    const dep = nodesMap.get(depId);
    if (dep && (dep.status === TaskStatus.FAILED || dep.status === TaskStatus.BLOCKED || dep.status === TaskStatus.RECOVERY_FAILED)) {
      return true;
    }
  }
  return false;
}

export function hasRecoveringDependency(node, nodesMap) {
  if (!node) return false;
  for (const depId of node.dependencies) {
    const dep = nodesMap.get(depId);
    if (dep && dep.status === TaskStatus.RECOVERING) return true;
  }
  return false;
}
