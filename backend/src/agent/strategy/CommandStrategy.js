import { logStrategy } from './StrategyLogger.js';

export function resolveCommandStrategy({
  failureClassification = null,
  validationStrategy = null,
  workspaceMetadata = {},
  projectScan = {}
} = {}) {
  const command = validationStrategy?.command || projectScan?.validationCommand || null;
  const commandRequired = !command && String(failureClassification?.classification || failureClassification || '').toUpperCase() === 'VALIDATION_COMMAND_MISSING';
  const decision = command ? 'UseCommand' : (commandRequired ? 'Block' : 'Continue');
  const reason = command
    ? 'Derived validation command'
    : commandRequired
      ? 'Validation command missing'
      : 'No command derivation needed';

  logStrategy('COMMAND_DERIVED', {
    command,
    decision,
    reason
  });

  return {
    decision,
    command,
    commandRequired,
    reason
  };
}
