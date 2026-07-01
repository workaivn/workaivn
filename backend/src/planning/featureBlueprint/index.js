import path from "node:path";
import { buildComponentTree, loadComponentTree } from "../../analysis/componentTree/index.js";
import { buildDependencyGraph, loadDependencyGraph } from "../../analysis/dependencyGraph/index.js";
import { buildUIPlan, loadUIPlan } from "../../analysis/uiPlanner/index.js";
import { buildKnowledgeGraph } from "../../agent/projectIntelligence/knowledgeGraph.js";
import { detectProjectIntent, detectWorkspaceState, resolveBootstrapProfile } from "../../agent/projectIntelligence/index.js";
import { buildFilePlan, buildScaffoldPlan } from "./scaffoldPlanner.js";
import { detectIntent } from "./intentClassifier.js";
import { detectProductType } from "./productTypeDetector.js";
import { planApis } from "./apiPlanner.js";
import { planComponents } from "./componentPlanner.js";
import { planDataModels } from "./dataModelPlanner.js";
import { planLayouts } from "./layoutPlanner.js";
import { planPages } from "./pagePlanner.js";
import { planRoutes } from "./routePlanner.js";
import { planTests } from "./testPlanner.js";
import { validateBlueprint } from "./blueprintValidator.js";
import { loadBlueprint, serializeBlueprint } from "./serializer.js";
import { FEATURE_BLUEPRINT_FILE, FEATURE_BLUEPRINT_LOG_EVENTS, FEATURE_BLUEPRINT_VERSION, PRODUCT_TYPES, STACKS } from "./types.js";

const blueprintCache = new Map();

function logEvent(eventName, payload = {}) {
  console.log(`[${eventName}]`, payload);
}

function normalize(value = "") {
  return String(value || "").replace(/\\/g, "/").trim();
}

function detectExistingSignals(workspaceContext = {}) {
  const existingFiles = Array.isArray(workspaceContext?.workspaceState?.existingFiles) ? workspaceContext.workspaceState.existingFiles : [];
  const normalized = new Set(existingFiles.map(file => normalize(file).toLowerCase()));
  return {
    hasPackageJson: normalized.has("package.json"),
    hasAppRouter: [...normalized].some(file => /(^|\/)app\/page\.(?:tsx?|jsx?)$/.test(file)),
    hasPagesRouter: [...normalized].some(file => /(^|\/)pages\/index\.(?:tsx?|jsx?)$/.test(file)),
    hasBladeViews: [...normalized].some(file => /\.blade\.php$/.test(file)),
    hasHtml: normalized.has("index.html") || normalized.has("public/index.html")
  };
}

function createMetadata({ prompt, productType, intent, stack, workspaceContext, uiPlan = null, componentTree = null, knowledgeGraph = null, dependencyGraph = null }) {
  return {
    prompt,
    productType,
    intentType: intent.intentType,
    requestedFramework: intent.requestedFramework || null,
    stack,
    bootstrapSupported: stack?.canBootstrap !== false,
    workspaceRoot: workspaceContext?.workspaceRoot || workspaceContext?.workspaceState?.workspaceRoot || "",
    existingFramework: workspaceContext?.workspaceState?.scan?.projectType || null,
    existingSignals: detectExistingSignals(workspaceContext),
    knowledgeGraphSummary: knowledgeGraph ? {
      conceptCount: Array.isArray(knowledgeGraph.concepts) ? knowledgeGraph.concepts.length : 0,
      surfaceCount: knowledgeGraph.surfaces ? Object.keys(knowledgeGraph.surfaces).length : 0
    } : null,
    uiPlanSummary: uiPlan ? {
      pageCount: Array.isArray(uiPlan.pages) ? uiPlan.pages.length : 0,
      layoutCount: Array.isArray(uiPlan.layouts) ? uiPlan.layouts.length : 0,
      widgetCount: Array.isArray(uiPlan.widgets) ? uiPlan.widgets.length : 0
    } : null,
    componentTreeSummary: componentTree ? {
      componentCount: Array.isArray(componentTree.components) ? componentTree.components.length : 0,
      routeCount: Array.isArray(componentTree.routes) ? componentTree.routes.length : 0
    } : null,
    dependencyGraphSummary: dependencyGraph ? {
      nodeCount: Array.isArray(dependencyGraph.nodes) ? dependencyGraph.nodes.length : 0,
      edgeCount: Array.isArray(dependencyGraph.edges) ? dependencyGraph.edges.length : 0
    } : null,
    seo: {
      title: "",
      description: "",
      openGraph: true
    },
    accessibility: {
      labels: true,
      keyboardNavigation: true,
      semanticHtml: true
    },
    responsive: true,
    i18n: /[\u00C0-\u024F\u1E00-\u1EFF]/.test(prompt) ? "vi" : "auto"
  };
}

async function resolveWorkspaceContext(prompt = "", workspaceContext = {}) {
  const ctx = { ...workspaceContext };
  if (!ctx.workspaceState && ctx.workspaceRoot) {
    ctx.workspaceState = await detectWorkspaceState(ctx.workspaceRoot).catch(() => null);
  }

  if (ctx.workspaceRoot && !ctx.uiPlan) {
    ctx.uiPlan = await loadUIPlan(ctx.workspaceRoot).catch(() => null);
  }

  if (ctx.workspaceRoot && !ctx.componentTree) {
    ctx.componentTree = await loadComponentTree(ctx.workspaceRoot).catch(() => null);
  }

  if (ctx.workspaceRoot && !ctx.dependencyGraph) {
    ctx.dependencyGraph = await loadDependencyGraph(ctx.workspaceRoot).catch(() => null);
  }

  if (!ctx.componentTree && ctx.uiPlan?.componentTree?.componentCount) {
    ctx.componentTree = { components: [], routes: [], root: [], summary: ctx.uiPlan.componentTree };
  }

  return ctx;
}

function buildValidationChecks(stack = {}, resolvedContext = {}) {
  const targetFiles = Array.isArray(stack.targetFiles) ? stack.targetFiles : [];
  if (stack.framework === "generic-static-html" || stack.surfaceType === "static-html") {
    return [
      { type: "file-existence", files: targetFiles },
      { type: "local-asset-references", files: targetFiles }
    ];
  }
  if (stack.framework === "php-plain") {
    return [{ type: "file-existence", files: targetFiles }];
  }
  return [{ type: "file-existence", files: targetFiles }];
}

export async function buildFeatureBlueprint(prompt, workspaceContext = {}) {
  const normalizedPrompt = String(prompt || "").trim();
  const cacheKey = JSON.stringify({
    prompt: normalizedPrompt,
    workspaceRoot: normalize(workspaceContext?.workspaceRoot || workspaceContext?.workspaceState?.workspaceRoot || ""),
    existingFiles: (workspaceContext?.workspaceState?.existingFiles || []).slice(0, 200)
  });
  if (blueprintCache.has(cacheKey)) return blueprintCache.get(cacheKey);

  logEvent(FEATURE_BLUEPRINT_LOG_EVENTS.START, { prompt: normalizedPrompt.slice(0, 200) });

  const resolvedContext = await resolveWorkspaceContext(normalizedPrompt, workspaceContext);
  const intent = detectIntent(normalizedPrompt);
  const projectIntent = detectProjectIntent(normalizedPrompt, { objective: normalizedPrompt });
  const productType = detectProductType(normalizedPrompt, intent, resolvedContext.workspaceState || {});
  const resolvedProfile = resolveBootstrapProfile(projectIntent, resolvedContext.workspaceState || {});
  const knowledgeGraph = buildKnowledgeGraph({
    prompt: normalizedPrompt,
    workspaceState: resolvedContext.workspaceState || {},
    projectIntent,
    uiPlan: resolvedContext.uiPlan || null,
    componentTree: resolvedContext.componentTree || null,
    dependencyGraph: resolvedContext.dependencyGraph || null
  });
  const uiPlan = resolvedContext.uiPlan || null;
  const componentTree = resolvedContext.componentTree || null;
  const dependencyGraph = resolvedContext.dependencyGraph || null;

  logEvent(FEATURE_BLUEPRINT_LOG_EVENTS.INTENT, { intentType: intent.intentType, requestedFramework: intent.requestedFramework || null });
  logEvent(FEATURE_BLUEPRINT_LOG_EVENTS.PRODUCT, { productType });
  logEvent(FEATURE_BLUEPRINT_LOG_EVENTS.TEMPLATE, { stack: resolvedProfile.framework || resolvedProfile.id, source: resolvedProfile.source || resolvedProfile.resolvedBy });

  const planningContext = {
    prompt: normalizedPrompt,
    workspaceState: resolvedContext.workspaceState || {},
    uiPlan,
    componentTree,
    dependencyGraph,
    knowledgeGraph
  };

  const pages = planPages(productType, normalizedPrompt, planningContext, intent);
  const layouts = planLayouts(productType, planningContext, pages);
  const components = planComponents(productType, pages, planningContext);
  const dataModels = planDataModels(productType, normalizedPrompt);
  const apis = planApis(productType, dataModels, normalizedPrompt);
  const routes = planRoutes(productType, pages, planningContext);
  const tests = planTests(productType, pages, planningContext);

  for (const page of pages) logEvent(FEATURE_BLUEPRINT_LOG_EVENTS.PAGE, { page });
  for (const component of components) logEvent(FEATURE_BLUEPRINT_LOG_EVENTS.COMPONENT, { component });
  for (const model of dataModels) logEvent(FEATURE_BLUEPRINT_LOG_EVENTS.MODEL, { model });
  for (const api of apis) logEvent(FEATURE_BLUEPRINT_LOG_EVENTS.API, { api });

  const metadata = createMetadata({
    prompt: normalizedPrompt,
    productType,
    intent,
    stack: resolvedProfile,
    workspaceContext: resolvedContext,
    uiPlan,
    componentTree,
    knowledgeGraph,
    dependencyGraph
  });

  const blueprint = {
    version: FEATURE_BLUEPRINT_VERSION,
    prompt: normalizedPrompt,
    intent,
    projectIntent,
    productType,
    stack: resolvedProfile,
    bootstrapProfile: resolvedProfile,
    knowledgeGraph,
    pages,
    layouts,
    components,
    dataModels,
    apis,
    routes,
    tests,
    seedData: dataModels.slice(0, 3).map(name => ({
      model: name,
      records: 3,
      purpose: `Demo data for ${name}`
    })),
    metadata
  };

  const validationCommand = resolvedProfile.validationCommands?.[0] || resolvedProfile.buildCommands?.[0] || "";
  const validationChecks = buildValidationChecks(resolvedProfile, resolvedContext);
  const validationStrategy = validationCommand && validationChecks.length > 0 ? "hybrid" : validationCommand ? "command" : "file-existence";

  blueprint.scaffoldPlan = buildScaffoldPlan({ ...blueprint, validationCommand, workspaceContext: resolvedContext });
  blueprint.filePlan = buildFilePlan(blueprint.scaffoldPlan, resolvedContext);
  blueprint.validation = {
    command: validationCommand,
    checks: validationChecks,
    strategy: validationStrategy,
    ...validateBlueprint({ ...blueprint, validation: { command: validationCommand, checks: validationChecks } }, resolvedContext)
  };
  blueprint.metadata.validationCommand = blueprint.validation.command;
  blueprint.metadata.validationStrategy = blueprint.validation.strategy;
  blueprint.metadata.routeCount = blueprint.routes.length;
  blueprint.metadata.pageCount = blueprint.pages.length;
  blueprint.metadata.componentCount = blueprint.components.length;

  logEvent(FEATURE_BLUEPRINT_LOG_EVENTS.SCAFFOLD, { scaffoldCount: blueprint.scaffoldPlan.length });
  logEvent(FEATURE_BLUEPRINT_LOG_EVENTS.FILE, { fileCount: blueprint.filePlan.length });
  logEvent(FEATURE_BLUEPRINT_LOG_EVENTS.VALIDATED, { ok: blueprint.validation.ok, issues: blueprint.validation.issues.length });
  logEvent(FEATURE_BLUEPRINT_LOG_EVENTS.COMPLETE, {
    productType,
    pageCount: blueprint.pages.length,
    componentCount: blueprint.components.length,
    modelCount: blueprint.dataModels.length
  });

  blueprintCache.set(cacheKey, blueprint);
  return blueprint;
}

export function detectIntentType(prompt) {
  return detectIntent(prompt);
}

export { detectProductType } from "./productTypeDetector.js";
export { planPages } from "./pagePlanner.js";
export { planComponents } from "./componentPlanner.js";
export { planDataModels } from "./dataModelPlanner.js";
export { planApis } from "./apiPlanner.js";
export { buildScaffoldPlan, buildFilePlan } from "./scaffoldPlanner.js";
export { validateBlueprint } from "./blueprintValidator.js";
export { serializeBlueprint, loadBlueprint } from "./serializer.js";
export { FEATURE_BLUEPRINT_FILE, FEATURE_BLUEPRINT_LOG_EVENTS, FEATURE_BLUEPRINT_VERSION, PRODUCT_TYPES, STACKS } from "./types.js";
