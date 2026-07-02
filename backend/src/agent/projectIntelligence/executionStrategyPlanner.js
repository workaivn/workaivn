import { getProfileKnowledge, getValidationKnowledge, getRepairKnowledge, GOAL_TYPES } from "./planningKnowledgeRegistry.js";
import { unique } from "./inference.js";

function orderedCommands(commands = []) {
  return unique((Array.isArray(commands) ? commands : []).map(command => String(command || "").trim()).filter(Boolean));
}

export function planExecutionStrategy({
  goalType = GOAL_TYPES.UNKNOWN,
  bootstrapProfile = {},
  projectStructure = {},
  featurePlan = {},
  uiPlan = {},
  componentPlan = {},
  workspaceState = {},
  projectScan = {},
  toolAvailability = {},
  failure = null
} = {}) {
  const profileId = String(bootstrapProfile?.id || bootstrapProfile?.framework || "").trim();
  const validationKnowledge = getValidationKnowledge({ profileId, workspaceState, toolAvailability, goalType });
  const repairKnowledge = getRepairKnowledge({ failure, goalType, profileId });

  const installCommands = orderedCommands(Array.isArray(projectScan?.installCommands) ? projectScan.installCommands : []);
  const buildCommands = orderedCommands(Array.isArray(projectScan?.buildCommands) ? projectScan.buildCommands : []);
  const runCommands = orderedCommands(Array.isArray(projectScan?.runCommands) ? projectScan.runCommands : []);
  const validationCommands = orderedCommands([
    ...validationKnowledge.commands,
    ...(Array.isArray(projectScan?.testCommands) ? projectScan.testCommands : [])
  ]);

  const validationStrategy = {
    type: validationCommands.length > 0 ? "command" : "file-existence",
    source: validationCommands.length > 0 ? "workspace-evidence" : "workspace-files",
    commands: validationCommands,
    checks: validationKnowledge.checks,
    skipped: validationKnowledge.skipped
  };

  const executionOrder = [
    "ANALYZE_WORKSPACE",
    "RESOLVE_BOOTSTRAP_PROFILE",
    "BOOTSTRAP_PROJECT",
    ...(installCommands.length > 0 ? ["INSTALL_DEPENDENCIES"] : []),
    "GENERATE_BASE_FILES",
    "GENERATE_FEATURE_MODULES",
    ...(buildCommands.length > 0 ? ["VALIDATE_BUILD"] : []),
    ...(repairKnowledge.repairType !== "none" ? ["REPAIR_FAILURES", "REVALIDATE"] : ["VALIDATE_BUILD"]),
    "FINALIZE"
  ];

  return {
    goalType,
    profileId,
    installCommands,
    buildCommands,
    runCommands,
    validationCommands,
    validationStrategy,
    executionOrder: unique(executionOrder),
    repairKnowledge
  };
}
