export const VALIDATOR_STATUS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  INCOMPLETE: 'INCOMPLETE',
  BLOCKED: 'BLOCKED'
});

export const TASK_STATUSES = Object.freeze({
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

const CRITICAL_TASK_KINDS = new Set(['CODING', 'WRITE_FILE', 'APPLY_PATCH', 'REASONING', 'GENERATE_CONTENT']);

export function isCriticalTask(task) {
  if (!task) return false;
  return CRITICAL_TASK_KINDS.has(task.kind) || task.tool === 'WRITE_FILE' || task.tool === 'APPLY_PATCH';
}

export const VALIDATOR_LOG_EVENTS = Object.freeze([
  'VALIDATOR_START',
  'VALIDATOR_PLAN_CHECK',
  'VALIDATOR_FILE_CHECK',
  'VALIDATOR_SYNTAX_CHECK',
  'VALIDATOR_IMPORT_EXPORT_CHECK',
  'VALIDATOR_ENTITY_CHAIN_CHECK',
  'VALIDATOR_TEST_CHECK',
  'VALIDATOR_BUILD_CHECK',
  'VALIDATOR_SCOPE_CHECK',
  'VALIDATOR_FAKE_PASS_DETECTED',
  'VALIDATOR_FINALIZATION_BLOCKED',
  'VALIDATOR_PASS',
  'VALIDATOR_FAIL',
  'VALIDATOR_INCOMPLETE',
  'VALIDATOR_COMPLETE'
]);

export function createEmptyReport() {
  return {
    status: 'INCOMPLETE',
    score: 0,
    passed: [],
    failed: [],
    warnings: [],
    missingTasks: [],
    unexpectedChanges: [],
    requiredFixes: [],
    requiredCommands: [],
    canFinalize: false,
    evidence: [],
    confidence: 0
  };
}
