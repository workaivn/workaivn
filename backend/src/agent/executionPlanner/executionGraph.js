import crypto from 'node:crypto';
import { ExecutionUnit } from './executionUnit.js';
import { verifyExecutionUnit, verifyExecutionCompletion } from './executionVerifier.js';

function unique(list = []) {
  return [...new Set((Array.isArray(list) ? list : []).map(value => String(value || '').trim()).filter(Boolean))];
}

export class ExecutionGraph {
  constructor(units = []) {
    this.id = crypto.randomUUID();
    this.nodes = new Map();
    this.createdAt = new Date().toISOString();
    this.finished = false;
    this.validationErrors = [];
    for (const unit of Array.isArray(units) ? units : []) {
      this.addUnit(unit);
    }
    this.rebuildLinks();
  }

  addUnit(unit) {
    const normalized = unit instanceof ExecutionUnit ? unit : new ExecutionUnit(unit);
    if (!normalized.id) {
      throw new Error('ExecutionUnit requires an id');
    }
    if (this.nodes.has(normalized.id)) {
      throw new Error(`ExecutionUnit with id "${normalized.id}" already exists`);
    }
    this.nodes.set(normalized.id, {
      ...normalized,
      prerequisites: unique(normalized.dependencies),
      dependents: [],
      completionCondition: normalized.completionPredicate || (() => true),
      status: 'PENDING',
      completed: false,
      failed: false,
      result: null,
      error: null,
      completedAt: null,
      failedAt: null
    });
    return this.nodes.get(normalized.id);
  }

  rebuildLinks() {
    for (const unit of this.nodes.values()) {
      unit.dependents = [];
    }
    for (const unit of this.nodes.values()) {
      for (const depId of unit.prerequisites) {
        const dep = this.nodes.get(depId);
        if (dep && !dep.dependents.includes(unit.id)) {
          dep.dependents.push(unit.id);
        }
      }
    }
  }

  connect(fromId, toId) {
    const from = this.nodes.get(fromId);
    const to = this.nodes.get(toId);
    if (!from) throw new Error(`ExecutionUnit "${fromId}" not found`);
    if (!to) throw new Error(`ExecutionUnit "${toId}" not found`);
    if (!to.prerequisites.includes(fromId)) to.prerequisites.push(fromId);
    if (!from.dependents.includes(toId)) from.dependents.push(toId);
  }

  getUnit(id) {
    return this.nodes.get(id) || null;
  }

  allUnits() {
    return [...this.nodes.values()];
  }

  readyUnits() {
    const ready = [];
    for (const unit of this.nodes.values()) {
      if (unit.completed || unit.failed) continue;
      if (unit.status === 'READY') {
        ready.push(unit);
        continue;
      }
      const depsMet = unit.prerequisites.every(depId => this.nodes.get(depId)?.completed === true);
      if (depsMet) {
        unit.status = 'READY';
        console.log('[EXECUTION_UNIT_READY]', {
          id: unit.id,
          type: unit.type,
          dependencies: [...unit.prerequisites]
        });
        ready.push(unit);
      }
    }
    return ready;
  }

  completeUnit(id, result = null) {
    const unit = this.nodes.get(id);
    if (!unit) return false;
    const verification = verifyExecutionUnit(unit, result || {});
    if (!verification.valid) {
      unit.failed = true;
      unit.completed = false;
      unit.status = 'FAILED';
      unit.error = verification.errors.join('; ');
      unit.failedAt = new Date().toISOString();
      console.log('[EXECUTION_UNIT_FAILED]', {
        id: unit.id,
        type: unit.type,
        error: String(unit.error || '').slice(0, 200)
      });
      return false;
    }
    unit.completed = true;
    unit.failed = false;
    unit.status = 'COMPLETED';
    unit.result = result;
    unit.completedAt = new Date().toISOString();
    console.log('[EXECUTION_UNIT_COMPLETED]', {
      id: unit.id,
      type: unit.type,
      outputs: unit.outputs || {}
    });
    if (verifyExecutionCompletion(this).valid === true) {
      this.finish();
    }
    return true;
  }

  failUnit(id, error = null) {
    const unit = this.nodes.get(id);
    if (!unit) return false;
    unit.failed = true;
    unit.status = 'FAILED';
    unit.error = error;
    unit.failedAt = new Date().toISOString();
    console.log('[EXECUTION_UNIT_FAILED]', {
      id: unit.id,
      type: unit.type,
      error: String(error || '').slice(0, 200)
    });
    return true;
  }

  retryUnit(id) {
    const unit = this.nodes.get(id);
    if (!unit) return false;
    unit.retryCount = (Number(unit.retryCount) || 0) + 1;
    unit.failed = false;
    unit.completed = false;
    unit.error = null;
    unit.result = null;
    unit.status = 'PENDING';
    unit.failedAt = null;
    unit.completedAt = null;
    console.log('[EXECUTION_UNIT_RETRY]', {
      id: unit.id,
      type: unit.type,
      retryCount: unit.retryCount
    });
    console.log('[EXECUTION_UNIT_RETRIED]', {
      id: unit.id,
      type: unit.type,
      retryCount: unit.retryCount
    });
    return true;
  }

  startUnit(id) {
    const unit = this.nodes.get(id);
    if (!unit) return false;
    unit.status = 'RUNNING';
    unit.startedAt = unit.startedAt || new Date().toISOString();
    console.log('[EXECUTION_UNIT_STARTED]', {
      id: unit.id,
      type: unit.type,
      dependencies: [...unit.prerequisites]
    });
    return true;
  }

  validate() {
    const ids = new Set(this.nodes.keys());
    const errors = [];
    for (const unit of this.nodes.values()) {
      for (const dep of unit.prerequisites) {
        if (!ids.has(dep)) {
          errors.push(`Missing dependency "${dep}" for "${unit.id}"`);
        }
      }
    }
    const visiting = new Set();
    const visited = new Set();
    const walk = (id, stack = []) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        errors.push(`Dependency cycle detected: ${[...stack, id].join(' -> ')}`);
        return;
      }
      visiting.add(id);
      const unit = this.nodes.get(id);
      if (unit) {
        for (const dep of unit.prerequisites) {
          walk(dep, [...stack, id]);
        }
      }
      visiting.delete(id);
      visited.add(id);
    };
    for (const id of this.nodes.keys()) walk(id);
    this.validationErrors = errors;
    return { valid: errors.length === 0, errors };
  }

  finish() {
    this.finished = true;
    console.log('[EXECUTION_GRAPH_COMPLETED]', {
      graphId: this.id,
      unitCount: this.nodes.size
    });
    console.log('[EXECUTION_GRAPH_FINISHED]', {
      graphId: this.id,
      unitCount: this.nodes.size
    });
  }
}

export function createExecutionGraph(units = []) {
  return new ExecutionGraph(units);
}
