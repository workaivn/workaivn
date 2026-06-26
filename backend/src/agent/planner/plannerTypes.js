export { CostCategory } from './costEstimator.js';

export const BranchType = Object.freeze({
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  RECOVERED: 'RECOVERED',
  BLOCKED: 'BLOCKED',
  SKIPPED: 'SKIPPED'
});

export const TaskStatus = Object.freeze({
  PENDING: 'PENDING',
  READY: 'READY',
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  BLOCKED: 'BLOCKED',
  SKIPPED: 'SKIPPED',
  RECOVERING: 'RECOVERING',
  RECOVERED: 'RECOVERED',
  RECOVERY_FAILED: 'RECOVERY_FAILED'
});
