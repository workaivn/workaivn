import { TaskNode } from './taskNode.js';
import { TaskStatus } from './plannerTypes.js';
import { getGraphValidationErrors } from './graphUtils.js';

export class TaskGraph {
  constructor() {
    this._nodes = new Map();
  }

  create() {
    this._nodes = new Map();
    console.log('[TASK_GRAPH_CREATED]', { nodes: 0 });
  }

  addNode(node) {
    if (!(node instanceof TaskNode)) {
      throw new Error('addNode requires a TaskNode instance');
    }
    if (this._nodes.has(node.id)) {
      throw new Error(`TaskNode with id "${node.id}" already exists`);
    }
    this._nodes.set(node.id, node);
    const deps = [...node.dependencies];
    for (const depId of deps) {
      const depNode = this._nodes.get(depId);
      if (depNode) {
        depNode.children.add(node.id);
        node.parents.add(depId);
      }
    }
    console.log('[TASK_NODE_ADDED]', {
      id: node.id,
      kind: node.kind,
      goal: (node.goal || '').substring(0, 80),
      dependencies: deps
    });
  }

  getNode(id) {
    return this._nodes.get(id) || null;
  }

  removeNode(id) {
    const node = this._nodes.get(id);
    if (!node) return false;

    for (const parentId of node.parents) {
      const parent = this._nodes.get(parentId);
      if (parent) parent.children.delete(id);
    }

    for (const childId of node.children) {
      const child = this._nodes.get(childId);
      if (child) {
        child.parents.delete(id);
        child.dependencies.delete(id);
      }
    }

    this._nodes.delete(id);
    return true;
  }

  connect(parentId, childId) {
    const parent = this._nodes.get(parentId);
    const child = this._nodes.get(childId);
    if (!parent) throw new Error(`Parent node "${parentId}" not found`);
    if (!child) throw new Error(`Child node "${childId}" not found`);
    if (parentId === childId) throw new Error('Cannot connect a node to itself');

    parent.children.add(childId);
    child.parents.add(parentId);
    child.dependencies.add(parentId);

    console.log('[TASK_EDGE_ADDED]', { from: parentId, to: childId });
  }

  disconnect(parentId, childId) {
    const parent = this._nodes.get(parentId);
    const child = this._nodes.get(childId);
    if (!parent || !child) return false;

    parent.children.delete(childId);
    child.parents.delete(parentId);
    child.dependencies.delete(parentId);
    return true;
  }

  roots() {
    return [...this._nodes.values()].filter(n => n.parents.size === 0);
  }

  leaves() {
    return [...this._nodes.values()].filter(n => n.children.size === 0);
  }

  allNodes() {
    return [...this._nodes.values()];
  }

  readyTasks() {
    const ready = [];
    for (const node of this._nodes.values()) {
      if (node.status === TaskStatus.READY) {
        ready.push(node);
        continue;
      }
      if (node.status !== TaskStatus.PENDING) continue;

      const depsMet = [...node.dependencies].every(depId => {
        const dep = this._nodes.get(depId);
        return dep && dep.status === TaskStatus.SUCCESS;
      });

      if (depsMet) {
        node.status = TaskStatus.READY;
        node.touch();
        console.log('[TASK_READY]', { id: node.id, kind: node.kind });
        ready.push(node);
      }
    }
    return ready;
  }

  blockedTasks() {
    return [...this._nodes.values()].filter(n => n.status === TaskStatus.BLOCKED);
  }

  failedTasks() {
    return [...this._nodes.values()].filter(n => n.status === TaskStatus.FAILED);
  }

  completedTasks() {
    return [...this._nodes.values()].filter(n =>
      n.status === TaskStatus.SUCCESS ||
      n.status === TaskStatus.FAILED ||
      n.status === TaskStatus.SKIPPED
    );
  }

  validate() {
    const errors = getGraphValidationErrors(this._nodes);
    if (errors.length === 0) {
      console.log('[GRAPH_VALIDATION_OK]', { nodes: this._nodes.size });
      return { valid: true, errors: [] };
    }
    console.log('[GRAPH_VALIDATION_FAILED]', { errors });
    return { valid: false, errors };
  }
}
