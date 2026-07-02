import { EXECUTION_DECISIONS } from './ExecutionDecision.js';
import { logStrategy } from './StrategyLogger.js';

const REPLAN_CLASSIFICATIONS = new Set([
  'INVALID_PREREQUISITE',
  'PATH_RESOLUTION_ERROR',
  'WORKSPACE_DISCOVERY_ERROR',
  'INVALID_BOOTSTRAP_ASSUMPTION',
  'PLANNING_ERROR'
]);

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
  const modelRetryKinds = new Set([
    'MODEL_GENERATION',
    'MODEL_FORMAT',
    'MODEL_FORMAT_ERROR',
    'MODEL_SCHEMA_ERROR',
    'MODEL_PARTIAL_OUTPUT',
    'MODEL_PROTOCOL_ERROR',
    'MODEL_SYNTAX',
    'MODEL_IMPORT_EXPORT',
    'MODEL_REFERENCE',
    'MODEL_TEST_BODY',
    'MODEL_PATCH',
    'TEST_FAILURE'
  ]);

  let decision = EXECUTION_DECISIONS.BLOCK;
  let owner = 'PLANNER';
  let recoveryRequired = false;
  let reason = 'No recovery strategy available';

  if (failureClassification?.classification === 'USER_REQUESTED_MISSING_FILE') {
    decision = EXECUTION_DECISIONS.BLOCK;
    owner = 'PLANNER';
    recoveryRequired = false;
    reason = 'User requested missing file — not a planning error';
    logStrategy('USER_REQUESTED_MISSING_FILE', { classification, reason });
  } else if (failureClassification?.classification === 'MISSING_OPTIONAL_PREREQUISITE') {
    decision = EXECUTION_DECISIONS.SKIP_VALIDATION;
    owner = 'PLANNER';
    recoveryRequired = false;
    reason = 'Optional prerequisite missing — skip and continue';
    logStrategy('MISSING_OPTIONAL_PREREQUISITE_SKIPPED', { classification, reason });
  } else if (REPLAN_CLASSIFICATIONS.has(classification)) {
    decision = EXECUTION_DECISIONS.REPLAN;
    owner = 'PLANNER';
    recoveryRequired = true;
    reason = `Replan required for ${classification}`;
    logStrategy('EXECUTION_DECISION_REPLAN', {
      classification,
      reason,
      failedPath: failureClassification?.failedPath || null,
      assumptionSource: failureClassification?.assumptionSource || null
    });
  } else if (plannerRecoveryKinds.has(classification)) {
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
    confidence: capability?.confidence || 'low',
    replanRecommended: REPLAN_CLASSIFICATIONS.has(classification) || null
  };
}
