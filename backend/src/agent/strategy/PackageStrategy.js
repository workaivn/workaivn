import { logStrategy } from './StrategyLogger.js';

export function resolvePackageStrategy({
  failureClassification = null,
  constraints = {},
  workspaceMetadata = {},
  projectScan = {}
} = {}) {
  const scanFacts = projectScan?.facts || projectScan || {};
  const classification = String(failureClassification?.classification || failureClassification || 'UNKNOWN');
  const packageManagerAvailable = constraints.packageManagerAvailable !== false;
  const packageEditable = constraints.packageEditable !== false;
  const dependencyInstallationAllowed = constraints.dependencyInstallationAllowed !== false;
  const packageProblem = classification === 'PACKAGE_CONFIGURATION' || classification === 'PACKAGE_DEPENDENCY';
  const installRequired = classification === 'PACKAGE_DEPENDENCY';
  const setupRequired = packageProblem && installRequired && dependencyInstallationAllowed;
  const blocked = packageProblem && (!dependencyInstallationAllowed || !packageManagerAvailable || !packageEditable);
  const decision = installRequired
    ? (setupRequired ? 'InstallDependency' : 'Block')
    : (classification === 'PACKAGE_CONFIGURATION' ? 'Block' : 'Continue');
  const reason = installRequired
    ? (setupRequired ? 'Dependency installation required' : 'Package dependency change not allowed')
    : (classification === 'PACKAGE_CONFIGURATION' ? 'Package configuration requires planner intervention' : 'Package strategy not required');

  logStrategy('PACKAGE_SETUP_REQUIRED', {
    classification,
    setupRequired,
    blocked,
    packageManagerAvailable,
    packageEditable,
    dependencyInstallationAllowed,
    packageJsonFound: scanFacts.packageJsonFound === true
  });

  return {
    decision,
    setupRequired,
    blocked,
    packageRequired: packageProblem,
    reason
  };
}
