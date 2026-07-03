import { detectProjectInitialization } from './ProjectInitializationDetector.js';

export const PLANNER_POLICIES = Object.freeze({
  ALLOW_PROJECT_BOOTSTRAP: 'ALLOW_PROJECT_BOOTSTRAP',
  ALLOW_NEW_PROJECT_INITIALIZATION: 'ALLOW_NEW_PROJECT_INITIALIZATION',
  ALLOW_PROJECT_INITIALIZATION: 'ALLOW_PROJECT_INITIALIZATION',
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
  const taskIntent = projectIntent?.taskIntent || null;

  const hasPackageCreationIntent = validatedAssumptions.some(a =>
    a.path && (a.path.endsWith('/package.json') || a.path === 'package.json') && a.source === 'explicit_user_request'
  );
  const initialization = detectProjectInitialization({
    workspaceState,
    projectScan,
    projectIntent,
    objective: projectIntent.prompt || projectIntent.objective || ''
  });
  const allowBootstrap = taskIntent ? taskIntent.bootstrapAllowed === true : initialization.initializationMode === 'PROJECT_INITIALIZATION';
  const allowValidation = taskIntent ? taskIntent.validationAllowed === true : (packageJsonFound || facts.testCommands?.length > 0 || facts.buildCommands?.length > 0);

  return {
    [PLANNER_POLICIES.ALLOW_PROJECT_BOOTSTRAP]: allowBootstrap,
    [PLANNER_POLICIES.ALLOW_NEW_PROJECT_INITIALIZATION]: allowBootstrap,
    [PLANNER_POLICIES.ALLOW_PROJECT_INITIALIZATION]: allowBootstrap,
    [PLANNER_POLICIES.ALLOW_PACKAGE_CREATION]: !packageJsonFound && hasPackageCreationIntent,
    [PLANNER_POLICIES.ALLOW_VALIDATION_DERIVATION]: allowValidation,
    [PLANNER_POLICIES.ALLOW_INSTALL_COMMAND]: packageJsonFound,
    [PLANNER_POLICIES.ALLOW_BUILD_COMMAND]: packageJsonFound || facts.buildCommands?.length > 0,
    initializationMode: initialization.initializationMode,
    objectiveAuthorityEligible: initialization.objectiveAuthorityEligible,
    workspaceEmpty: initialization.workspaceEmpty
  };
}
