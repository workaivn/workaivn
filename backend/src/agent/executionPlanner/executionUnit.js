import crypto from 'node:crypto';

export const EXECUTION_UNIT_TYPES = Object.freeze({
  READ: 'READ',
  ANALYZE: 'ANALYZE',
  WRITE: 'WRITE',
  PATCH: 'PATCH',
  DELETE: 'DELETE',
  MOVE: 'MOVE',
  RENAME: 'RENAME',
  RUN_TERMINAL: 'RUN_TERMINAL',
  VALIDATE: 'VALIDATE',
  VERIFY: 'VERIFY'
});

export class ExecutionUnit {
  constructor({
    id,
    type,
    description,
    targetFiles = [],
    requiredReads = [],
    requiredWrites = [],
    dependencies = [],
    inputs = {},
    outputs = {},
    acceptanceCriteria = [],
    completionPredicate = null,
    retryPolicy = {},
    verificationPolicy = {},
    metadata = {},
    authoritySource = null,
    authorityState = 'candidate',
    approvalId = null,
    approvedByFirewall = false,
    requestedKind = null
  } = {}) {
    this.id = id || crypto.randomUUID();
    this.type = String(type || '').toUpperCase();
    this.description = String(description || '').trim();
    this.targetFiles = Array.isArray(targetFiles) ? [...targetFiles] : [];
    this.requiredReads = Array.isArray(requiredReads) ? [...requiredReads] : [];
    this.requiredWrites = Array.isArray(requiredWrites) ? [...requiredWrites] : [];
    this.dependencies = Array.isArray(dependencies) ? [...dependencies] : [];
    this.inputs = inputs && typeof inputs === 'object' ? { ...inputs } : {};
    this.outputs = outputs && typeof outputs === 'object' ? { ...outputs } : {};
    this.acceptanceCriteria = Array.isArray(acceptanceCriteria) ? [...acceptanceCriteria] : [];
    this.completionPredicate = completionPredicate;
    this.retryPolicy = retryPolicy && typeof retryPolicy === 'object' ? { ...retryPolicy } : {};
    this.verificationPolicy = verificationPolicy && typeof verificationPolicy === 'object' ? { ...verificationPolicy } : {};
    this.metadata = metadata && typeof metadata === 'object' ? { ...metadata } : {};
    this.authoritySource = authoritySource || this.metadata.authoritySource || null;
    this.authorityState = authorityState || this.metadata.authorityState || 'candidate';
    this.approvalId = approvalId || this.metadata.approvalId || null;
    this.approvedByFirewall = approvedByFirewall === true || this.metadata.approvedByFirewall === true;
    this.requestedKind = requestedKind || this.metadata.requestedKind || null;
  }
}

export function createExecutionUnit(input = {}) {
  return new ExecutionUnit(input);
}
