import { EXECUTION_DECISIONS, createExecutionDecision } from './ExecutionDecision.js';
import { classifyExecutionFailure } from './FailureClassifier.js';
import { resolveExecutionConstraints } from './ConstraintReasoner.js';
import { reasonAboutModelCapability } from './CapabilityReasoner.js';
import { resolveValidationStrategy } from './ValidationStrategy.js';
import { resolveFrameworkStrategy } from './FrameworkStrategy.js';
import { resolvePackageStrategy } from './PackageStrategy.js';
import { resolveCommandStrategy } from './CommandStrategy.js';
import { resolveRetryStrategy } from './RetryStrategy.js';
import { resolveRecoveryStrategy } from './RecoveryStrategy.js';
import { logStrategy } from './StrategyLogger.js';

export function evaluateExecutionStrategy(input = {}) {
  const projectScanFacts = input.projectScan?.facts || input.projectScan || {};
  const classification = input.failureClassification || classifyExecutionFailure(input);
  const constraints = input.constraints || resolveExecutionConstraints(input);
  const capability = input.capability || reasonAboutModelCapability({
    failureClassification: classification,
    constraints,
    plannerMetadata: input.plannerMetadata || {},
    workspaceMetadata: input.workspaceMetadata || {},
    projectScan: projectScanFacts
  });
  const validationStrategy = input.validationStrategy || resolveValidationStrategy({
    failureClassification: classification,
    plannerMetadata: input.plannerMetadata || {},
    workspaceMetadata: input.workspaceMetadata || {},
    projectScan: projectScanFacts,
    requiredCommands: input.requiredCommands || input.plannerMetadata?.requiredCommands || []
  });
  const frameworkStrategy = input.frameworkStrategy || resolveFrameworkStrategy({
    failureClassification: classification,
    constraints,
    projectScan: projectScanFacts,
    workspaceMetadata: input.workspaceMetadata || {}
  });
  const packageStrategy = input.packageStrategy || resolvePackageStrategy({
    failureClassification: classification,
    constraints,
    workspaceMetadata: input.workspaceMetadata || {},
    projectScan: projectScanFacts
  });
  const commandStrategy = input.commandStrategy || resolveCommandStrategy({
    failureClassification: classification,
    validationStrategy,
    workspaceMetadata: input.workspaceMetadata || {},
    projectScan: projectScanFacts
  });
  const retryStrategy = input.retryStrategy || resolveRetryStrategy({
    failureClassification: classification,
    capability,
    constraints,
    validationStrategy,
    frameworkStrategy,
    packageStrategy,
    commandStrategy
  });
  const recoveryStrategy = input.recoveryStrategy || resolveRecoveryStrategy({
    failureClassification: classification,
    capability,
    constraints,
    frameworkStrategy,
    packageStrategy,
    commandStrategy
  });

  let decision = EXECUTION_DECISIONS.BLOCK;
  let owner = 'PLANNER';
  let retryAllowed = false;
  let setupRequired = false;
  let packageRequired = false;
  let commandRequired = false;
  let recoveryRequired = false;
  let replanRequired = false;
  let suggestion = null;
  let reason = 'No execution strategy available';

  if (constraints.workspaceReadonly) {
    decision = EXECUTION_DECISIONS.BLOCK;
    reason = 'Workspace is read-only';
  } else if (recoveryStrategy.decision === EXECUTION_DECISIONS.REPLAN) {
    decision = EXECUTION_DECISIONS.REPLAN;
    owner = 'PLANNER';
    replanRequired = true;
    recoveryRequired = true;
    reason = recoveryStrategy.reason;
    if (classification?.origin) {
      suggestion = classification.origin.classification === 'PATH_RESOLUTION_ERROR'
        ? 'REPLACE_INVALID_PREREQUISITE'
        : classification.origin.classification === 'INVALID_BOOTSTRAP_ASSUMPTION'
          ? 'REMOVE_INVALID_PREREQUISITE'
          : 'REMOVE_INVALID_PREREQUISITE';
    }
    logStrategy('EXECUTION_DECISION_REPLAN', {
      classification: classification?.classification || null,
      reason,
      suggestedAction: suggestion,
      failedPath: classification?.failedPath || null,
      assumptionSource: classification?.assumptionSource || null
    });
  } else if (recoveryStrategy.decision === EXECUTION_DECISIONS.PLANNER_RECOVERY) {
    decision = EXECUTION_DECISIONS.PLANNER_RECOVERY;
    owner = 'PLANNER';
    recoveryRequired = true;
    reason = recoveryStrategy.reason;
  } else if (frameworkStrategy.setupRequired) {
    decision = EXECUTION_DECISIONS.SETUP_FRAMEWORK;
    owner = 'PLANNER';
    setupRequired = true;
    reason = frameworkStrategy.reason;
  } else if (packageStrategy.setupRequired) {
    decision = EXECUTION_DECISIONS.INSTALL_DEPENDENCY;
    owner = 'PLANNER';
    packageRequired = true;
    reason = packageStrategy.reason;
  } else if (commandStrategy.commandRequired) {
    decision = EXECUTION_DECISIONS.DERIVE_COMMAND;
    owner = 'PLANNER';
    commandRequired = true;
    reason = commandStrategy.reason;
  } else if (retryStrategy.retryAllowed) {
    decision = EXECUTION_DECISIONS.RETRY_MODEL;
    owner = 'MODEL';
    retryAllowed = true;
    reason = retryStrategy.reason;
  } else if (recoveryStrategy.decision === EXECUTION_DECISIONS.RETRY_MODEL) {
    decision = EXECUTION_DECISIONS.RETRY_MODEL;
    owner = 'MODEL';
    retryAllowed = true;
    reason = recoveryStrategy.reason;
  } else {
    reason = recoveryStrategy.reason || retryStrategy.reason || packageStrategy.reason || frameworkStrategy.reason;
  }

  const executionDecision = createExecutionDecision({
    decision,
    owner,
    retryAllowed,
    setupRequired,
    packageRequired: packageRequired || Boolean(packageStrategy.packageRequired),
    commandRequired,
    recoveryRequired,
    replanRequired,
    confidence: classification?.confidence || capability?.confidence || 'low',
    reason,
    classification,
    constraints,
    capability,
    validationStrategy,
    frameworkStrategy,
    packageStrategy,
    commandStrategy,
    recoveryStrategy,
    suggestedAction: suggestion,
    failedPath: classification?.failedPath || null,
    failedTask: classification?.failedTask || null,
    assumptionSource: classification?.assumptionSource || null,
    evidence: classification?.origin?.evidence || classification?.evidence || null
  });

  logStrategy('EXECUTION_STRATEGY', {
    classification: classification?.classification || classification?.failureType || 'UNKNOWN',
    decision: executionDecision.decision,
    owner: executionDecision.owner,
    retryAllowed: executionDecision.retryAllowed,
    setupRequired: executionDecision.setupRequired,
    packageRequired: executionDecision.packageRequired,
    commandRequired: executionDecision.commandRequired,
    recoveryRequired: executionDecision.recoveryRequired,
    replanRequired: executionDecision.replanRequired,
    reason: executionDecision.reason
  });
  logStrategy('EXECUTION_DECISION', executionDecision);

  return executionDecision;
}
