import { buildBootstrapTaskGraphFromArchitecture } from "./architectureInference.js";
import { buildProjectStructure } from "./projectStructurePlanner.js";
import { planFeatures } from "./featurePlanner.js";
import { planUI } from "./uiPlanner.js";
import { planComponents } from "./componentPlanner.js";
import { planExecutionStrategy } from "./executionStrategyPlanner.js";
import { createProposal, createProposalRegistry } from "../planner/proposals/index.js";
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
import { consumeTaskIntent } from "../planner/taskIntent.js";

function resolveRuntimeProfile({
  goalType = GOAL_TYPES.UNKNOWN,
  workspaceState = {},
  bootstrapProfile = {},
  projectIntent = {}
} = {}) {
  const bootstrapProfileId = String(bootstrapProfile?.id || bootstrapProfile?.framework || "").trim().toLowerCase();
  if (bootstrapProfile && (bootstrapProfile.id || bootstrapProfile.framework) && bootstrapProfileId !== "react-vite-ts") {
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
  if (workspaceState?.hasReactVite || goalType === GOAL_TYPES.DASHBOARD || goalType === GOAL_TYPES.ADMIN_PANEL || goalType === GOAL_TYPES.FULLSTACK_APP || /\b(?:dashboard|admin|frontend)\b/.test(intentText)) {
    return { ...getProfileKnowledge("generic-static-html"), id: "generic-static-html", label: "Generic Static HTML", framework: "Static", packageManager: "none", canBootstrap: true, resolvedBy: "goal" };
  }
  if (goalType === GOAL_TYPES.LANDING_PAGE) {
    return { ...getProfileKnowledge("generic-static-html"), id: "generic-static-html", label: "Generic Static HTML", framework: "Static", packageManager: "none", canBootstrap: false, resolvedBy: "goal" };
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
  const explicitGoalType = String(projectIntent?.taskIntent?.goalType || projectIntent?.goalType || "").trim().toUpperCase();
  const goalType = explicitGoalType && GOAL_TYPES[explicitGoalType]
    ? explicitGoalType
    : inferGoalType(normalizedPrompt, projectIntent).toUpperCase();
  if (projectIntent?.taskIntent) {
    consumeTaskIntent("runtimePlanningIntelligence", projectIntent.taskIntent);
  }
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
      features: (getGoalKnowledge(goalType).features || []).map((name, index) => ({
        id: name,
        name,
        description: `${name} inspection`,
        priority: 100 - index,
        files: [],
        components: [],
        route: null,
        goal: name.toUpperCase()
      })),
      featureOrder: getGoalKnowledge(goalType).features || [],
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
    const recommendationPipeline = {
      projectStructure,
      featurePlan,
      uiPlan,
      componentPlan
    };
    const executionPipeline = {
      filePlan,
      executionPlan,
      validationPlan,
      repairPlan
    };
    return {
      goalType,
      targetProfile,
      projectStructure,
      featurePlan,
      uiPlan,
      componentPlan,
      recommendationPipeline,
      filePlan,
      executionPlan,
      executionPipeline,
      validationPlan,
      repairPlan,
      logs: [],
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
  const recommendationPipeline = {
    projectStructure,
    featurePlan,
    uiPlan,
    componentPlan
  };
  const executionPipeline = {
    filePlan,
    executionPlan,
    validationPlan,
    repairPlan
  };

  return {
    goalType,
    targetProfile: normalizedTargetProfile,
    projectStructure,
    featurePlan,
    uiPlan,
    componentPlan,
    recommendationPipeline,
    filePlan,
    executionPlan,
    executionPipeline,
    validationPlan,
    repairPlan,
    logs: [],
    targetFiles: filePlan.map(record => record.path),
    validationCommands: validationPlan.commands,
    installCommands: executionPlan.installCommands,
    buildCommands: executionPlan.buildCommands,
    runCommands: executionPlan.runCommands,
    canBootstrap: targetProfile?.canBootstrap !== false,
    source: targetProfile?.resolvedBy || targetProfile?.source || "inference"
  };
}

function collectFileTargets(filePlan = []) {
  return unique((Array.isArray(filePlan) ? filePlan : []).map(file => String(file?.path || file?.file || "").replace(/\\/g, "/").trim()).filter(Boolean));
}

function collectCommandTargets(commands = []) {
  return unique((Array.isArray(commands) ? commands : []).map(command => String(command || "").trim()).filter(Boolean));
}

export function buildRuntimeProposalGraph(runtimePlan = {}, {
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

  if (!bootstrapGraph?.proposals?.length && !runtimePlan?.targetProfile?.canBootstrap) {
    return {
      profileId: runtimePlan?.targetProfile?.id || null,
      intent: projectIntent,
      objective,
      proposals: [],
      validationSkipped: Array.isArray(runtimePlan?.validationPlan?.skipped) ? runtimePlan.validationPlan.skipped : []
    };
  }

  const registry = createProposalRegistry();
  const validationSkipped = Array.isArray(bootstrapGraph.validationSkipped) ? bootstrapGraph.validationSkipped : Array.isArray(runtimePlan?.validationPlan?.skipped) ? runtimePlan.validationPlan.skipped : [];

  registry.add(createProposal({
    proposalType: "PROJECT_STRUCTURE",
    source: "runtime-plan",
    proposalSource: "runtime-plan",
    confidence: 0.88,
    required: true,
    description: `Project structure for ${runtimePlan?.goalType || "workspace"}`,
    suggestedFiles: collectFileTargets(runtimePlan?.projectStructure?.files || []),
    verificationStatus: "unverified",
    promotionDecision: "recommendation",
    evidenceRefs: [`goal:${runtimePlan?.goalType || "unknown"}`],
    metadata: {
      goalType: runtimePlan?.goalType || null,
      projectStructure: runtimePlan?.projectStructure || null,
      verificationStatus: "unverified",
      promotionDecision: "recommendation"
    }
  }));

  registry.add(createProposal({
    proposalType: "FEATURE",
    source: "runtime-plan",
    proposalSource: "runtime-plan",
    confidence: 0.82,
    required: true,
    description: `Feature proposal for ${runtimePlan?.goalType || "workspace"}`,
    suggestedFiles: unique((Array.isArray(runtimePlan?.featurePlan?.features) ? runtimePlan.featurePlan.features : []).flatMap(feature => Array.isArray(feature.files) ? feature.files : []).map(file => String(file || "").replace(/\\/g, "/").trim()).filter(Boolean)),
    verificationStatus: "unverified",
    promotionDecision: "recommendation",
    evidenceRefs: [`goal:${runtimePlan?.goalType || "unknown"}`],
    metadata: {
      goalType: runtimePlan?.goalType || null,
      featureOrder: runtimePlan?.featurePlan?.featureOrder || [],
      verificationStatus: "unverified",
      promotionDecision: "recommendation"
    }
  }));

  registry.add(createProposal({
    proposalType: "UI",
    source: "runtime-plan",
    proposalSource: "runtime-plan",
    confidence: 0.8,
    required: true,
    description: `UI proposal for ${runtimePlan?.goalType || "workspace"}`,
    suggestedFiles: unique([
      ...(Array.isArray(runtimePlan?.uiPlan?.pages) ? runtimePlan.uiPlan.pages.map(page => page.path) : []),
      ...(Array.isArray(runtimePlan?.uiPlan?.layouts) ? runtimePlan.uiPlan.layouts.map(layout => layout.path) : []),
      ...(Array.isArray(runtimePlan?.uiPlan?.widgets) ? runtimePlan.uiPlan.widgets.map(widget => widget.path) : [])
    ].map(file => String(file || "").replace(/\\/g, "/").trim()).filter(Boolean)),
    verificationStatus: "unverified",
    promotionDecision: "recommendation",
    evidenceRefs: [`goal:${runtimePlan?.goalType || "unknown"}`],
    metadata: {
      goalType: runtimePlan?.goalType || null,
      uiPlan: runtimePlan?.uiPlan || null,
      verificationStatus: "unverified",
      promotionDecision: "recommendation"
    }
  }));

  registry.add(createProposal({
    proposalType: "COMPONENT",
    source: "runtime-plan",
    proposalSource: "runtime-plan",
    confidence: 0.8,
    required: true,
    description: `Component proposal for ${runtimePlan?.goalType || "workspace"}`,
    suggestedFiles: unique((Array.isArray(runtimePlan?.componentPlan?.components) ? runtimePlan.componentPlan.components : []).map(component => String(component.path || "").replace(/\\/g, "/").trim()).filter(Boolean)),
    verificationStatus: "unverified",
    promotionDecision: "recommendation",
    evidenceRefs: [`goal:${runtimePlan?.goalType || "unknown"}`],
    metadata: {
      goalType: runtimePlan?.goalType || null,
      componentPlan: runtimePlan?.componentPlan || null,
      verificationStatus: "unverified",
      promotionDecision: "recommendation"
    }
  }));

  registry.add(createProposal({
    proposalType: "EXECUTION",
    source: "runtime-plan",
    proposalSource: "runtime-plan",
    confidence: 0.83,
    required: true,
    description: `Execution proposal for ${runtimePlan?.goalType || "workspace"}`,
    suggestedCommands: collectCommandTargets([
      ...(runtimePlan?.installCommands || []),
      ...(runtimePlan?.buildCommands || []),
      ...(runtimePlan?.runCommands || [])
    ]),
    verificationStatus: "unverified",
    promotionDecision: "recommendation",
    evidenceRefs: [`goal:${runtimePlan?.goalType || "unknown"}`],
    metadata: {
      goalType: runtimePlan?.goalType || null,
      executionPlan: runtimePlan?.executionPlan || null,
      verificationStatus: "unverified",
      promotionDecision: "recommendation"
    }
  }));

  registry.add(createProposal({
    proposalType: "VALIDATION",
    source: "runtime-plan",
    proposalSource: "runtime-plan",
    confidence: 0.86,
    required: true,
    description: `Validation proposal for ${runtimePlan?.goalType || "workspace"}`,
    suggestedCommands: collectCommandTargets(runtimePlan?.validationCommands || []),
    suggestedValidation: collectCommandTargets(runtimePlan?.validationCommands || []),
    verificationStatus: "unverified",
    promotionDecision: "recommendation",
    evidenceRefs: [`goal:${runtimePlan?.goalType || "unknown"}`],
    metadata: {
      goalType: runtimePlan?.goalType || null,
      validationPlan: runtimePlan?.validationPlan || null,
      verificationStatus: "unverified",
      promotionDecision: "recommendation"
    }
  }));

  for (const proposal of Array.isArray(bootstrapGraph.proposals) ? bootstrapGraph.proposals : []) {
    registry.add(proposal);
  }

  return {
    profileId: runtimePlan?.targetProfile?.id || null,
    intent: projectIntent,
    objective,
    proposals: registry.list(),
    validationSkipped,
    runtimePlan
  };
}

export const buildRuntimeTaskGraph = buildRuntimeProposalGraph;
