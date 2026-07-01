export const EXECUTION_DECISIONS = Object.freeze({
  RETRY_MODEL: 'RetryModel',
  PLANNER_RECOVERY: 'PlannerRecovery',
  INSERT_TASK: 'InsertTask',
  BLOCK: 'Block',
  SETUP_FRAMEWORK: 'SetupFramework',
  INSTALL_DEPENDENCY: 'InstallDependency',
  DERIVE_COMMAND: 'DeriveCommand',
  SKIP_VALIDATION: 'SkipValidation',
  ABORT: 'Abort',
  CONTINUE: 'Continue'
});

export function createExecutionDecision(input = {}) {
  return {
    decision: input.decision || EXECUTION_DECISIONS.BLOCK,
    owner: input.owner || 'PLANNER',
    retryAllowed: input.retryAllowed === true,
    setupRequired: input.setupRequired === true,
    packageRequired: input.packageRequired === true,
    commandRequired: input.commandRequired === true,
    recoveryRequired: input.recoveryRequired === true,
    confidence: input.confidence || 'low',
    reason: input.reason || 'No strategy decision available',
    classification: input.classification || null,
    constraints: input.constraints || null,
    capability: input.capability || null,
    validationStrategy: input.validationStrategy || null,
    frameworkStrategy: input.frameworkStrategy || null,
    packageStrategy: input.packageStrategy || null,
    commandStrategy: input.commandStrategy || null,
    recoveryStrategy: input.recoveryStrategy || null
  };
}
