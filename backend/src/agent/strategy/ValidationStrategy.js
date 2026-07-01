import { logStrategy } from './StrategyLogger.js';

function hasCommand(commands = [], needle = '') {
  const normalizedNeedle = String(needle || '').trim().toLowerCase();
  return (Array.isArray(commands) ? commands : []).some(command => String(command || '').trim().toLowerCase() === normalizedNeedle);
}

export function resolveValidationStrategy({
  failureClassification = null,
  plannerMetadata = {},
  workspaceMetadata = {},
  projectScan = {},
  requiredCommands = []
} = {}) {
  const classification = String(failureClassification?.classification || failureClassification || 'UNKNOWN');
  const commands = Array.isArray(requiredCommands) ? requiredCommands.filter(Boolean) : [];
  let strategy = 'blocked';
  let command = null;
  let reason = 'No validation strategy available';

  if (hasCommand(commands, 'npm test')) {
    strategy = 'existing_test_command';
    command = 'npm test';
    reason = 'Use existing test command';
  } else if (hasCommand(commands, 'npm run build')) {
    strategy = 'existing_build_command';
    command = 'npm run build';
    reason = 'Use existing build command';
  } else if (/syntax|reference|import|model_/i.test(classification)) {
    strategy = 'syntax_validation';
    command = null;
    reason = 'Use syntax validation or framework checks';
  } else if (classification === 'VALIDATION_COMMAND_MISSING') {
    strategy = 'blocked';
    reason = 'Validation command missing';
  }

  const validationStrategy = { strategy, command, reason };
  logStrategy('VALIDATION_STRATEGY_SELECTED', {
    classification,
    strategy,
    command,
    reason
  });
  if (command) {
    logStrategy('VALIDATION_COMMAND_ADDED', { command, reason });
  }
  if (strategy === 'blocked' && classification === 'VALIDATION_COMMAND_MISSING') {
    logStrategy('VALIDATION_SKIPPED', { reason });
  }
  return validationStrategy;
}
