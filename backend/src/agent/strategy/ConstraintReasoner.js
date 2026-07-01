import { logStrategy } from './StrategyLogger.js';

export function resolveExecutionConstraints({
  plannerMetadata = {},
  workspaceMetadata = {},
  projectScan = {},
  failedTask = null
} = {}) {
  const workspaceReadonly = workspaceMetadata.readOnly === true || plannerMetadata.readOnly === true;
  const packageManagerAvailable = workspaceMetadata.packageManagerAvailable !== false;
  const frameworkRunnable = workspaceMetadata.frameworkRunnable !== false && projectScan?.framework?.runnable !== false;
  const terminalAvailable = workspaceMetadata.terminalAvailable !== false;
  const validationRequired = workspaceMetadata.validationRequired !== false;
  const parallelAllowed = plannerMetadata.parallelAllowed !== false;
  const internetAllowed = workspaceMetadata.internetAllowed === true;
  const dependencyInstallationAllowed = !workspaceReadonly && packageManagerAvailable;
  const packageEditable = !workspaceReadonly && workspaceMetadata.packageEditable !== false;
  const writeAllowed = !workspaceReadonly;

  const constraints = {
    writeAllowed,
    workspaceReadonly,
    frameworkRunnable,
    terminalAvailable,
    validationRequired,
    parallelAllowed,
    internetAllowed,
    packageManagerAvailable,
    dependencyInstallationAllowed,
    packageEditable
  };

  logStrategy('CONSTRAINTS_RESOLVED', {
    failedTool: failedTask?.tool || null,
    ...constraints
  });

  return constraints;
}
