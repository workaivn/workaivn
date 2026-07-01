import { EXECUTION_DECISIONS } from './ExecutionDecision.js';
import { logStrategy } from './StrategyLogger.js';

export function resolveRecoveryStrategy({
  failureClassification = null,
  capability = null,
  constraints = {},
  frameworkStrategy = null,
  packageStrategy = null,
  commandStrategy = null
} = {}) {
  const classification = String(failureClassification?.classification || failureClassification || 'UNKNOWN');
  const plannerRecoveryKinds = new Set(['PLANNER_STATE', 'COORDINATOR_STATE', 'QUALITY_GATE']);
  const modelRetryKinds = new Set(['MODEL_GENERATION', 'MODEL_FORMAT', 'MODEL_SYNTAX', 'MODEL_IMPORT_EXPORT', 'MODEL_REFERENCE', 'MODEL_TEST_BODY', 'MODEL_PATCH', 'TEST_FAILURE']);

  let decision = EXECUTION_DECISIONS.BLOCK;
  let owner = 'PLANNER';
  let recoveryRequired = false;
  let reason = 'No recovery strategy available';

  if (plannerRecoveryKinds.has(classification)) {
    decision = EXECUTION_DECISIONS.PLANNER_RECOVERY;
    owner = 'PLANNER';
    recoveryRequired = true;
    reason = 'Planner recovery required';
    logStrategy('PLANNER_RECOVERY_SELECTED', { classification, reason });
  } else if (frameworkStrategy?.setupRequired) {
    decision = EXECUTION_DECISIONS.SETUP_FRAMEWORK;
    owner = 'PLANNER';
    recoveryRequired = true;
    reason = frameworkStrategy.reason || 'Framework setup required';
    logStrategy('FRAMEWORK_SETUP_REQUIRED', { classification, reason });
  } else if (packageStrategy?.setupRequired) {
    decision = EXECUTION_DECISIONS.INSTALL_DEPENDENCY;
    owner = 'PLANNER';
    recoveryRequired = true;
    reason = packageStrategy.reason || 'Package setup required';
    logStrategy('PACKAGE_SETUP_REQUIRED', { classification, reason });
  } else if (commandStrategy?.commandRequired) {
    decision = EXECUTION_DECISIONS.DERIVE_COMMAND;
    owner = 'PLANNER';
    recoveryRequired = true;
    reason = commandStrategy.reason || 'Command derivation required';
    logStrategy('COMMAND_DERIVED', { classification, reason });
  } else if (modelRetryKinds.has(classification) && capability?.canModelRepair === true) {
    decision = EXECUTION_DECISIONS.RETRY_MODEL;
    owner = 'MODEL';
    recoveryRequired = false;
    reason = 'Model retry allowed';
    logStrategy('MODEL_RECOVERY_SELECTED', { classification, reason });
  } else if (classification === 'VALIDATION_COMMAND_MISSING') {
    decision = EXECUTION_DECISIONS.DERIVE_COMMAND;
    owner = 'PLANNER';
    recoveryRequired = true;
    reason = 'Validation command missing';
    logStrategy('COMMAND_DERIVED', { classification, reason });
  }

  return {
    decision,
    owner,
    recoveryRequired,
    reason,
    confidence: capability?.confidence || 'low'
  };
}
