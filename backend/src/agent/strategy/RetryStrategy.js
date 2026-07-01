import { logStrategy } from './StrategyLogger.js';

export function resolveRetryStrategy({
  failureClassification = null,
  capability = null,
  constraints = {},
  validationStrategy = null,
  frameworkStrategy = null,
  packageStrategy = null,
  commandStrategy = null,
  recoveryStrategy = null
} = {}) {
  const classification = String(failureClassification?.classification || failureClassification || 'UNKNOWN');
  const canRetry = capability?.canModelRepair === true &&
    constraints.workspaceReadonly !== true &&
    constraints.terminalAvailable !== false &&
    !['FRAMEWORK_UNAVAILABLE', 'PACKAGE_CONFIGURATION', 'PACKAGE_DEPENDENCY', 'VALIDATION_COMMAND_MISSING', 'PLANNER_STATE', 'COORDINATOR_STATE', 'PERMISSION'].includes(classification);
  const retryAllowed = canRetry && (frameworkStrategy?.blocked !== true) && (packageStrategy?.blocked !== true) && (commandStrategy?.commandRequired !== true);
  const reason = retryAllowed ? 'Model retry allowed' : `Model retry rejected for ${classification}`;

  logStrategy(retryAllowed ? 'RETRY_ALLOWED' : 'RETRY_REJECTED', {
    classification,
    reason,
    canRetry,
    frameworkBlocked: frameworkStrategy?.blocked === true,
    packageBlocked: packageStrategy?.blocked === true,
    commandRequired: commandStrategy?.commandRequired === true
  });

  return {
    retryAllowed,
    reason,
    classification
  };
}
