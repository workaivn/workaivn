import { buildProjectStructure } from "./projectStructurePlanner.js";
import { planFeatures } from "./featurePlanner.js";
import { planUI } from "./uiPlanner.js";
import { planComponents } from "./componentPlanner.js";
import { planExecutionStrategy } from "./executionStrategyPlanner.js";
import { buildBootstrapTaskGraphFromArchitecture } from "./architectureInference.js";
import {
  GOAL_TYPES,
  getGoalKnowledge,
  getProfileKnowledge,
  getRepairKnowledge,
  getValidationKnowledge,
  inferGoalType,
  isBootstrapCapableProfile,
  isReactProfile,
} from "./planningKnowledgeRegistry.js";
import { unique } from "./inference.js";

function logEvent(eventName, payload = {}) {
  console.log(`[${eventName}]`, payload);
}

function resolveRuntimeProfile({
  goalType = GOAL_TYPES.UNKNOWN,
  workspaceState = {},
  bootstrapProfile = {},
  projectIntent = {}
} = {}) {
  if (bootstrapProfile && (bootstrapProfile.id || bootstrapProfile.framework)) {
    return bootstrapProfile;
  }

  const intentText = String(projectIntent?.prompt || projectIntent?.objective || "").toLowerCase();
  const requestedFramework = String(projectIntent?.requestedFramework || "").toLowerCase();
  if (workspaceState?.hasIndexPhp || workspaceState?.hasLaravel) {
    return { ...getProfileKnowledge("php-plain"), id: "php-plain", label: "Plain PHP", framework: "PHP", packageManager: "none", canBootstrap: true, resolvedBy: "workspace" };
  }
  if (workspaceState?.hasCsproj) {
    return { ...getProfileKnowledge("aspnet-core"), id: "aspnet-core", label: "ASP.NET Core", framework: ".NET", packageManager: "dotnet", canBootstrap: false, resolvedBy: "workspace" };
  }
  if (workspaceState?.hasNodeExpress) {
    return { ...getProfileKnowledge("node-express"), id: "node-express", label: "Node + Express", framework: "Express", packageManager: "npm", canBootstrap: true, resolvedBy: "workspace" };
  }
  if (requestedFramework === "php-plain" || requestedFramework === "php" || /\bphp\b/.test(intentText)) {
    return { ...getProfileKnowledge("php-plain"), id: "php-plain", label: "Plain PHP", framework: "PHP", packageManager: "none", canBootstrap: true, resolvedBy: "intent" };
  }
  if (requestedFramework === "generic-static-html" || requestedFramework === "static-html" || /\b(?:static html|plain html|without framework)\b/.test(intentText)) {
    return { ...getProfileKnowledge("generic-static-html"), id: "generic-static-html", label: "Generic Static HTML", framework: "Static", packageManager: "none", canBootstrap: true, resolvedBy: "intent" };
  }
  if (workspaceState?.hasReactVite || goalType === GOAL_TYPES.SAAS_APP || goalType === GOAL_TYPES.DASHBOARD || goalType === GOAL_TYPES.ADMIN_PANEL || goalType === GOAL_TYPES.LANDING_PAGE || goalType === GOAL_TYPES.FULLSTACK_APP) {
    return { ...getProfileKnowledge("react-vite-ts"), id: "react-vite-ts", label: "React + Vite + TypeScript", framework: "React/Vite", packageManager: "npm", canBootstrap: true, resolvedBy: "goal" };
  }
  if (goalType === GOAL_TYPES.API_SERVER) {
    return { ...getProfileKnowledge("node-express"), id: "node-express", label: "Node + Express", framework: "Express", packageManager: "npm", canBootstrap: true, resolvedBy: "goal" };
  }
  if (goalType === GOAL_TYPES.READ_ONLY) {
    return { ...getProfileKnowledge("generic-static-html"), id: "generic-static-html", label: "Generic Static HTML", framework: "Static", packageManager: "none", canBootstrap: true, resolvedBy: "goal" };
  }
  if (/php/i.test(String(projectIntent?.requestedFramework || "")) || /\bphp\b/i.test(String(projectIntent?.prompt || projectIntent?.objective || ""))) {
    return { ...getProfileKnowledge("php-plain"), id: "php-plain", label: "Plain PHP", framework: "PHP", packageManager: "none", canBootstrap: true, resolvedBy: "intent" };
  }
  return { ...getProfileKnowledge("generic-static-html"), id: "generic-static-html", label: "Generic Static HTML", framework: "Static", packageManager: "none", canBootstrap: true, resolvedBy: "fallback" };
}

function normalizeFilePlan(structure = {}, goalType = GOAL_TYPES.UNKNOWN, profileId = "") {
  const featureMap = new Map();
  for (const feature of Array.isArray(structure?.goalKnowledge?.features) ? structure.goalKnowledge.features : []) {
    featureMap.set(feature, feature);
  }
  const files = [];
  for (const record of Array.isArray(structure?.files) ? structure.files : []) {
    const path = String(record.path || record.file || "").replace(/\\/g, "/").trim();
    if (!path) continue;
    const lower = path.toLowerCase();
    const phase = String(record.phase || "").trim() || (/\bpackage\.json$/.test(lower) ? "BOOTSTRAP_PROJECT" : "GENERATE_BASE_FILES");
    const isManifest = /package\.json$|composer\.json$|requirements\.txt$|pyproject\.toml$|pubspec\.yaml$/i.test(path);
    files.push({
      ...record,
      path,
      file: path,
      operation: String(record.operation || (isManifest ? "WRITE_FILE" : "WRITE_FILE")).toUpperCase(),
      phase,
      feature: record.feature || (featureMap.size > 0 ? [...featureMap.keys()][0] : goalType),
      reason: record.reason || `${phase} for ${path}`,
      dependsOn: unique((Array.isArray(record.dependsOn) ? record.dependsOn : []).map(value => String(value || "").trim()).filter(Boolean)),
      priority: Number.isFinite(Number(record.priority)) ? Number(record.priority) : 50
    });
  }
  return files;
}

function buildTargetProfileMetadata(profile = {}) {
  const family = profile.family || getProfileKnowledge(profile.id || profile.framework || "").family || null;
  return {
    id: profile.id || profile.framework || null,
    label: profile.label || profile.id || null,
    family,
    framework: profile.framework || null,
    language: profile.language || null,
    packageManager: profile.packageManager || null,
    canBootstrap: profile.canBootstrap !== false,
    resolvedBy: profile.resolvedBy || profile.source || "fallback",
    source: profile.source || profile.resolvedBy || "inference"
  };
}

export function createRuntimePlan({
  prompt = "",
  projectScan = {},
  workspaceState = {},
  projectIntent = {},
  bootstrapProfile = null,
  toolAvailability = {},
  failure = null
} = {}) {
  const normalizedPrompt = String(prompt || projectIntent?.prompt || projectIntent?.objective || "").trim();
  const goalType = inferGoalType(normalizedPrompt, projectIntent);
  if (goalType === GOAL_TYPES.READ_ONLY) {
    const targetProfile = buildTargetProfileMetadata({
      id: "read-only",
      label: "Read Only",
      framework: null,
      language: null,
      packageManager: "none",
      canBootstrap: false,
      resolvedBy: "goal",
      source: "goal"
    });
    const projectStructure = {
      goalType,
      profileId: "read-only",
      frameworkFamily: "read-only",
      directories: [],
      files: [],
      targetFiles: [],
      entryFiles: [],
      featureFiles: [],
      componentKnowledge: { goalType, family: "read-only", components: [], sharedComponents: [], layoutComponents: [], routeComponents: [], validationHints: ["file-existence"], directories: [] },
      goalKnowledge: getGoalKnowledge(goalType),
      validationHints: ["file-existence"]
    };
    const featurePlan = {
      goalType,
      profileId: "read-only",
      family: "read-only",
      features: getGoalKnowledge(goalType).features.map((name, index) => ({
        id: name,
        name,
        description: `${name} inspection`,
        priority: 100 - index,
        files: [],
        components: [],
        route: null,
        goal: name.toUpperCase()
      })),
      featureOrder: getGoalKnowledge(goalType).features,
      conceptSeeds: [],
      intentSummary: {
        prompt: normalizedPrompt,
        workspaceFiles: Array.isArray(workspaceState?.existingFiles) ? workspaceState.existingFiles.length : 0
      }
    };
    const uiPlan = { pages: [], layouts: [], widgets: [], navigation: [], flows: [], routes: [], responsive: [], summary: { pageCount: 0, layoutCount: 0, widgetCount: 0, routeCount: 0 }, intentSummary: { prompt: normalizedPrompt, workspaceFiles: Array.isArray(workspaceState?.existingFiles) ? workspaceState.existingFiles.length : 0 } };
    const componentPlan = { components: [], root: [], shared: [], unused: [], circular: [], summary: { componentCount: 0, sharedCount: 0 } };
    const executionPlan = {
      goalType,
      profileId: "read-only",
      installCommands: [],
      buildCommands: [],
      runCommands: [],
      validationCommands: [],
      validationStrategy: { type: "none", source: "read-only", commands: [], checks: [{ type: "file-existence", files: Array.isArray(projectIntent?.requestedFiles) ? projectIntent.requestedFiles : [] }], skipped: [] },
      executionOrder: ["ANALYZE_WORKSPACE", "FINALIZE"],
      repairKnowledge: { repairType: "none", confidence: 0.25, action: "defer_until_failure", tool: null, args: {}, retryCommand: null }
    };
    const validationPlan = { commands: [], checks: [{ type: "file-existence", files: Array.isArray(projectIntent?.requestedFiles) ? projectIntent.requestedFiles : [] }], skipped: [], strategy: "file-existence", source: "read-only" };
    const repairPlan = { repairType: "none", confidence: 0.25, action: "defer_until_failure", tool: null, args: {}, retryCommand: null, goalType, profileId: "read-only", fallbackCommand: null };
    const filePlan = [];
    const logs = [
      { event: "PROJECT_STRUCTURE_PLAN_CREATED", goalType },
      { event: "FEATURE_PLAN_CREATED", goalType },
      { event: "UI_PLAN_CREATED", goalType },
      { event: "COMPONENT_KNOWLEDGE_RESOLVED", goalType },
      { event: "FILE_PLAN_CREATED", goalType },
      { event: "EXECUTION_STRATEGY_CREATED", goalType },
      { event: "VALIDATION_STRATEGY_SELECTED", goalType },
      { event: "REPAIR_STRATEGY_CREATED", goalType }
    ];
    logEvent("PROJECT_STRUCTURE_PLAN_CREATED", { goalType, profileId: "read-only", fileCount: 0, directoryCount: 0 });
    logEvent("FEATURE_PLAN_CREATED", { goalType, featureCount: featurePlan.features.length, featureOrder: featurePlan.featureOrder });
    logEvent("UI_PLAN_CREATED", { goalType, pageCount: 0, layoutCount: 0, widgetCount: 0 });
    logEvent("COMPONENT_KNOWLEDGE_RESOLVED", { goalType, sharedCount: 0, componentCount: 0 });
    logEvent("FILE_PLAN_CREATED", { goalType, fileCount: 0, targetFiles: [] });
    logEvent("EXECUTION_STRATEGY_CREATED", { goalType, installCommands: [], buildCommands: [], runCommands: [] });
    logEvent("VALIDATION_STRATEGY_SELECTED", { goalType, strategy: "file-existence", commands: [], skipped: [] });
    logEvent("REPAIR_STRATEGY_CREATED", { goalType, repairType: "none", action: "defer_until_failure", retryCommand: null });
    return {
      goalType,
      targetProfile,
      projectStructure,
      featurePlan,
      uiPlan,
      componentPlan,
      filePlan,
      executionPlan,
      validationPlan,
      repairPlan,
      logs,
      targetFiles: [],
      validationCommands: [],
      installCommands: [],
      buildCommands: [],
      runCommands: [],
      canBootstrap: false,
      source: "read-only"
    };
  }
  const targetProfile = resolveRuntimeProfile({ goalType, workspaceState, bootstrapProfile: bootstrapProfile || {}, projectIntent });
  const normalizedTargetProfile = buildTargetProfileMetadata(targetProfile);
  const projectStructure = buildProjectStructure({
    goalType,
    bootstrapProfile: normalizedTargetProfile,
    projectIntent: { ...projectIntent, prompt: normalizedPrompt, objective: normalizedPrompt },
    workspaceState,
    projectScan
  });
  const featurePlan = planFeatures({
    goalType,
    projectStructure,
    bootstrapProfile: normalizedTargetProfile,
    projectIntent: { ...projectIntent, prompt: normalizedPrompt, objective: normalizedPrompt },
    workspaceState
  });
  const uiPlan = planUI({
    goalType,
    features: featurePlan.features,
    projectStructure,
    bootstrapProfile: normalizedTargetProfile,
    projectIntent: { ...projectIntent, prompt: normalizedPrompt, objective: normalizedPrompt },
    workspaceState
  });
  const componentPlan = planComponents({
    goalType,
    uiPlan,
    projectStructure,
    bootstrapProfile: normalizedTargetProfile,
    featurePlan
  });
  const executionPlan = planExecutionStrategy({
    goalType,
    bootstrapProfile: normalizedTargetProfile,
    projectStructure,
    featurePlan,
    uiPlan,
    componentPlan,
    workspaceState,
    projectScan,
    toolAvailability,
    failure
  });
  const validationPlan = {
    commands: executionPlan.validationCommands,
    checks: executionPlan.validationStrategy.checks,
    skipped: executionPlan.validationStrategy.skipped,
    strategy: executionPlan.validationStrategy.type,
    source: executionPlan.validationStrategy.source
  };
  const repairPlan = {
    ...executionPlan.repairKnowledge,
    goalType,
    profileId: targetProfile?.id || null,
    fallbackCommand: executionPlan.validationCommands[0] || null
  };
  const filePlan = normalizeFilePlan(projectStructure, goalType, targetProfile?.id || "");

  logEvent("PROJECT_STRUCTURE_PLAN_CREATED", {
    goalType,
    profileId: targetProfile?.id || null,
    fileCount: filePlan.length,
    directoryCount: Array.isArray(projectStructure.directories) ? projectStructure.directories.length : 0
  });
  logEvent("FEATURE_PLAN_CREATED", {
    goalType,
    featureCount: featurePlan.features.length,
    featureOrder: featurePlan.featureOrder
  });
  logEvent("UI_PLAN_CREATED", {
    goalType,
    pageCount: uiPlan.pages.length,
    layoutCount: uiPlan.layouts.length,
    widgetCount: uiPlan.widgets.length
  });
  logEvent("COMPONENT_KNOWLEDGE_RESOLVED", {
    goalType,
    sharedCount: componentPlan.shared.length,
    componentCount: componentPlan.components.length
  });
  logEvent("FILE_PLAN_CREATED", {
    goalType,
    fileCount: filePlan.length,
    targetFiles: filePlan.map(record => record.path)
  });
  logEvent("EXECUTION_STRATEGY_CREATED", {
    goalType,
    installCommands: executionPlan.installCommands,
    buildCommands: executionPlan.buildCommands,
    runCommands: executionPlan.runCommands
  });
  logEvent("VALIDATION_STRATEGY_SELECTED", {
    goalType,
    strategy: validationPlan.strategy,
    commands: validationPlan.commands,
    skipped: validationPlan.skipped
  });
  logEvent("REPAIR_STRATEGY_CREATED", {
    goalType,
    repairType: repairPlan.repairType,
    action: repairPlan.action,
    retryCommand: repairPlan.retryCommand
  });

  const logs = [
    { event: "PROJECT_STRUCTURE_PLAN_CREATED", goalType },
    { event: "FEATURE_PLAN_CREATED", goalType },
    { event: "UI_PLAN_CREATED", goalType },
    { event: "COMPONENT_KNOWLEDGE_RESOLVED", goalType },
    { event: "FILE_PLAN_CREATED", goalType },
    { event: "EXECUTION_STRATEGY_CREATED", goalType },
    { event: "VALIDATION_STRATEGY_SELECTED", goalType },
    { event: "REPAIR_STRATEGY_CREATED", goalType }
  ];

  return {
    goalType,
    targetProfile: normalizedTargetProfile,
    projectStructure,
    featurePlan,
    uiPlan,
    componentPlan,
    filePlan,
    executionPlan,
    validationPlan,
    repairPlan,
    logs,
    targetFiles: filePlan.map(record => record.path),
    validationCommands: validationPlan.commands,
    installCommands: executionPlan.installCommands,
    buildCommands: executionPlan.buildCommands,
    runCommands: executionPlan.runCommands,
    canBootstrap: targetProfile?.canBootstrap !== false,
    source: targetProfile?.resolvedBy || targetProfile?.source || "inference"
  };
}

export function buildRuntimeTaskGraph(runtimePlan = {}, {
  objective = "",
  projectIntent = {},
  workspaceState = {},
  criteria = {}
} = {}) {
  const buildCommands = Array.isArray(runtimePlan?.buildCommands) ? runtimePlan.buildCommands : [];
  const installCommands = Array.isArray(runtimePlan?.installCommands) ? runtimePlan.installCommands : [];
  const validationCommands = (Array.isArray(runtimePlan?.validationCommands) ? runtimePlan.validationCommands : [])
    .filter(command => !buildCommands.includes(command) && !installCommands.includes(command));
  const bootstrapGraph = buildBootstrapTaskGraphFromArchitecture({
    framework: runtimePlan?.targetProfile?.framework || runtimePlan?.targetProfile?.id || null,
    label: runtimePlan?.targetProfile?.label || null,
    id: runtimePlan?.targetProfile?.id || null,
    language: runtimePlan?.targetProfile?.language || null,
    packageManager: runtimePlan?.targetProfile?.packageManager || null,
    canBootstrap: runtimePlan?.canBootstrap !== false,
    concepts: Array.isArray(runtimePlan?.featurePlan?.featureOrder) ? runtimePlan.featurePlan.featureOrder : [],
    targetFiles: Array.isArray(runtimePlan?.targetFiles) ? runtimePlan.targetFiles : [],
    validationCommands,
    installCommands,
    buildCommands,
    runCommands: Array.isArray(runtimePlan?.runCommands) ? runtimePlan.runCommands : [],
    validationPlan: runtimePlan?.validationPlan || null
  }, {
    objective,
    projectIntent,
    workspaceState,
    criteria
  });

  if (!bootstrapGraph?.tasks?.length && !runtimePlan?.targetProfile?.canBootstrap) {
    return {
      profileId: runtimePlan?.targetProfile?.id || null,
      intent: projectIntent,
      objective,
      tasks: [],
      validationSkipped: Array.isArray(runtimePlan?.validationPlan?.skipped) ? runtimePlan.validationPlan.skipped : []
    };
  }

  const tasks = Array.isArray(bootstrapGraph.tasks) ? [...bootstrapGraph.tasks] : [];
  const writeTaskIds = tasks.filter(task => task.tool === "WRITE_FILE").map(task => task.id);
  const analysisTaskId = `analyze:${runtimePlan?.targetProfile?.id || "workspace"}`;
  tasks.unshift({
    id: analysisTaskId,
    kind: "CODING",
    goal: "ANALYZE_WORKSPACE",
    tool: "LIST_FILES",
    toolArgs: { path: "." },
    dependencies: [],
    priority: 100,
    stage: "ANALYZE_WORKSPACE"
  });
  for (const task of tasks) {
    if (task.id === analysisTaskId) continue;
    const deps = Array.isArray(task.dependencies) ? task.dependencies : [];
    if (!deps.includes(analysisTaskId)) {
      task.dependencies = [analysisTaskId, ...deps];
    }
  }
  for (const task of tasks) {
    if (task.tool === "RUN_TERMINAL") {
      const command = String(task.toolArgs?.command || "");
      if (/install/i.test(command)) {
        task.stage = "INSTALL_DEPENDENCIES";
        task.dependencies = [analysisTaskId, ...writeTaskIds];
      } else if (/build|check|test|analy[sz]e|lint|compile|php -l|dotnet build|node --check/i.test(command)) {
        task.stage = /build/i.test(command) ? "VALIDATE_BUILD" : "VALIDATE_BUILD";
        task.dependencies = [analysisTaskId, ...writeTaskIds, ...tasks.filter(item => item.tool === "RUN_TERMINAL" && /install/i.test(String(item.toolArgs?.command || ""))).map(item => item.id)];
      }
    }
  }

  return {
    profileId: runtimePlan?.targetProfile?.id || null,
    intent: projectIntent,
    objective,
    tasks,
    validationSkipped: Array.isArray(bootstrapGraph.validationSkipped) ? bootstrapGraph.validationSkipped : Array.isArray(runtimePlan?.validationPlan?.skipped) ? runtimePlan.validationPlan.skipped : [],
    runtimePlan
  };
}
