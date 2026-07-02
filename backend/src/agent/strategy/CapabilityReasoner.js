import { EXECUTION_DECISIONS } from './ExecutionDecision.js';
import { logStrategy } from './StrategyLogger.js';

const MODEL_REPAIRABLE = new Set([
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

const NON_MODEL_REPAIRABLE = new Set([
  'FRAMEWORK_UNAVAILABLE',
  'FRAMEWORK_MISMATCH',
  'PACKAGE_CONFIGURATION',
  'PACKAGE_DEPENDENCY',
  'WORKSPACE_CONFIGURATION',
  'VALIDATION_COMMAND_MISSING',
  'TERMINAL_FAILURE',
  'BUILD_FAILURE',
  'TOOL_FAILURE',
  'TIMEOUT',
  'PERMISSION',
  'PLANNER_STATE',
  'COORDINATOR_STATE',
  'QUALITY_GATE',
  'UNKNOWN',
  'PLANNING_ERROR',
  'INVALID_PREREQUISITE',
  'PATH_RESOLUTION_ERROR',
  'WORKSPACE_DISCOVERY_ERROR',
  'INVALID_BOOTSTRAP_ASSUMPTION',
  'USER_REQUESTED_MISSING_FILE',
  'MISSING_OPTIONAL_PREREQUISITE'
]);

export function reasonAboutModelCapability({
  failureClassification = null,
  constraints = {},
  plannerMetadata = {},
  workspaceMetadata = {},
  projectScan = {}
} = {}) {
  const classification = String(failureClassification?.classification || failureClassification || 'UNKNOWN');
  const modelRepairable = MODEL_REPAIRABLE.has(classification);
  const hardNoRetry = NON_MODEL_REPAIRABLE.has(classification);
  const retryAllowed = modelRepairable && constraints.writeAllowed !== false && constraints.terminalAvailable !== false;
  const reason = modelRepairable
    ? 'Failure is model-repairable'
    : hardNoRetry
      ? 'Failure is not model-repairable'
      : 'Insufficient evidence for model repair';

  const capability = {
    canModelRepair: retryAllowed,
    confidence: modelRepairable ? 'high' : hardNoRetry ? 'high' : 'low',
    reason,
    classification,
    modelRepairable,
    hardNoRetry
  };

  logStrategy('MODEL_CAPABILITY', {
    classification,
    canModelRepair: capability.canModelRepair,
    confidence: capability.confidence,
    reason: capability.reason
  });

  return capability;
}
