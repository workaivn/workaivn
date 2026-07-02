import { logStrategy } from './StrategyLogger.js';

export function resolveFrameworkStrategy({
  failureClassification = null,
  constraints = {},
  projectScan = {},
  workspaceMetadata = {}
} = {}) {
  const scanFacts = projectScan?.facts || projectScan || {};
  const classification = String(failureClassification?.classification || failureClassification || 'UNKNOWN');
  const frameworkRunnable = constraints.frameworkRunnable !== false;
  const canSetup = workspaceMetadata.frameworkSetupAllowed === true || scanFacts?.canBootstrap === true;
  const frameworkUnavailable = classification === 'FRAMEWORK_UNAVAILABLE';
  const setupRequired = frameworkUnavailable && canSetup;
  const blocked = frameworkUnavailable && !canSetup;
  const decision = setupRequired ? 'SETUP_FRAMEWORK' : (blocked ? 'BLOCK_WITH_REASON' : 'CONTINUE');
  const reason = setupRequired
    ? 'Framework setup required'
    : blocked
      ? 'Framework is unavailable and setup is not allowed'
      : 'Framework strategy not required';

  logStrategy('FRAMEWORK_SETUP_REQUIRED', {
    classification,
    setupRequired,
    blocked,
    frameworkRunnable
  });

  return {
    decision,
    setupRequired,
    blocked,
    reason
  };
}
