export const PLANNER_POLICIES = Object.freeze({
  ALLOW_PROJECT_BOOTSTRAP: 'ALLOW_PROJECT_BOOTSTRAP',
  ALLOW_NEW_PROJECT_INITIALIZATION: 'ALLOW_NEW_PROJECT_INITIALIZATION',
  ALLOW_PACKAGE_CREATION: 'ALLOW_PACKAGE_CREATION',
  ALLOW_VALIDATION_DERIVATION: 'ALLOW_VALIDATION_DERIVATION',
  ALLOW_INSTALL_COMMAND: 'ALLOW_INSTALL_COMMAND',
  ALLOW_BUILD_COMMAND: 'ALLOW_BUILD_COMMAND'
});

export function resolvePlannerPolicies({
  workspaceState = {},
  projectScan = {},
  projectIntent = {},
  validatedAssumptions = []
} = {}) {
  const facts = projectScan?.facts || projectScan || {};
  const existingFiles = workspaceState.existingFiles || [];
  const packageJsonFound = facts.packageJsonFound === true || workspaceState.packageJsonFound === true;
  const hasAnyFiles = existingFiles.length > 0;
  const goalType = (projectIntent.goalType || '').toUpperCase();

  const hasPackageCreationIntent = validatedAssumptions.some(a =>
    a.path && (a.path.endsWith('/package.json') || a.path === 'package.json') && a.source === 'explicit_user_request'
  );
  const promptText = String(projectIntent.prompt || projectIntent.objective || '').toLowerCase();
  const requestedFramework = String(projectIntent.requestedFramework || '').toLowerCase();
  const explicitNewProject = /\b(?:new\s+react|react\s+project|new\s+project|starter\s+app|create\s+new\s+app|initialize\s+a\s+new\s+app)\b/.test(promptText) || requestedFramework === 'react-vite-ts';
  const allowBootstrap = !hasAnyFiles && explicitNewProject;

  return {
    [PLANNER_POLICIES.ALLOW_PROJECT_BOOTSTRAP]: allowBootstrap,
    [PLANNER_POLICIES.ALLOW_NEW_PROJECT_INITIALIZATION]: allowBootstrap,
    [PLANNER_POLICIES.ALLOW_PACKAGE_CREATION]: !packageJsonFound && hasPackageCreationIntent,
    [PLANNER_POLICIES.ALLOW_VALIDATION_DERIVATION]: packageJsonFound || facts.testCommands?.length > 0 || facts.buildCommands?.length > 0,
    [PLANNER_POLICIES.ALLOW_INSTALL_COMMAND]: packageJsonFound,
    [PLANNER_POLICIES.ALLOW_BUILD_COMMAND]: packageJsonFound || facts.buildCommands?.length > 0
  };
}
