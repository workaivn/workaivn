import fs from "node:fs/promises";
import path from "node:path";
import { listWorkspaceFiles } from "../../agent/workspace.js";
import { buildComponentTree } from "../componentTree/index.js";
import { UI_LOG_EVENTS, UI_PLAN_VERSION, UI_PLAN_FILE, COMPONENT_TREE_FILE } from "./types.js";
import {
  analyzeSourceFile,
  hashContent,
  isTextCandidate,
  makeId,
  normalizePath,
  unique
} from "./shared.js";
import { buildPages } from "./pageBuilder.js";
import { analyzeLayouts } from "./layoutAnalyzer.js";
import { analyzeNavigation } from "./navigationAnalyzer.js";
import { analyzeWidgets } from "./widgetAnalyzer.js";
import { analyzeResponsive } from "./responsiveAnalyzer.js";
import { analyzeForms } from "./formAnalyzer.js";
import { analyzeFlows } from "./flowAnalyzer.js";
import { loadUIPlan, saveUIPlan } from "./serializer.js";
import { validateUIPlan } from "./validator.js";

const uiPlanCaches = new Map();

function logEvent(eventName, payload = {}) {
  console.log(`[${eventName}]`, payload);
}

function buildUiTree(pages = []) {
  return pages.map(page => ({
    id: page.id,
    title: page.title,
    route: page.route,
    layout: page.layout,
    children: unique([
      ...(page.navigation || []),
      ...(page.widgets || []),
      ...(page.forms || []),
      ...(page.tables || []),
      ...(page.charts || []),
      ...(page.dialogs || []),
      ...(page.drawers || []),
      ...(page.tabs || [])
    ]).map(name => ({ name, children: [] }))
  }));
}

function buildImpacts({ componentTree = null, pages = [] } = {}) {
  const nodes = Array.isArray(componentTree?.components) ? componentTree.components : [];
  const byId = new Map(nodes.map(node => [node.id, node]));
  const impacts = [];

  for (const node of nodes) {
    const affectedPages = new Set();
    const visited = new Set();
    const stack = [node.id];
    while (stack.length > 0) {
      const currentId = stack.pop();
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      const current = byId.get(currentId);
      if (!current) continue;
      if (current.route || current.type === "page") {
        const match = pages.find(page => page.route === current.route || page.path === current.path || page.title === current.name);
        if (match) affectedPages.add(match.route || match.path || match.title);
      }
      for (const dependentId of current.dependents || []) stack.push(dependentId);
    }
    if (affectedPages.size > 0) {
      impacts.push({
        id: node.id,
        name: node.name,
        path: node.path,
        affectedPages: affectedPages.size,
        affectedRoutes: [...affectedPages].sort(),
        reason: node.layout ? "layout_change" : node.shared ? "shared_widget_change" : "component_change"
      });
    }
  }

  return impacts.sort((left, right) => right.affectedPages - left.affectedPages || left.name.localeCompare(right.name));
}

function summarizeComponentTree(componentTree = null) {
  return {
    version: componentTree?.version || null,
    componentCount: Array.isArray(componentTree?.components) ? componentTree.components.length : 0,
    routeCount: Array.isArray(componentTree?.routes) ? componentTree.routes.length : 0,
    rootCount: Array.isArray(componentTree?.root) ? componentTree.root.length : 0,
    treeFile: COMPONENT_TREE_FILE
  };
}

async function readUiTextFiles(workspaceRoot, files, outputFiles = []) {
  const analyses = [];
  for (const file of files) {
    if (!isTextCandidate(file, outputFiles)) continue;
    const absolute = path.resolve(workspaceRoot, file);
    const content = await fs.readFile(absolute, "utf8").catch(() => null);
    if (content == null) continue;
    const analysis = analyzeSourceFile(file, content);
    analysis.hash = hashContent(content);
    analyses.push(analysis);
  }
  return analyses;
}

export async function buildUIPlan(workspaceRoot, options = {}) {
  const root = path.resolve(String(workspaceRoot || "."));
  const limit = options.limit || 12000;
  const outputPath = options.outputPath || null;
  const componentTreeOutputPath = options.componentTreeOutputPath || COMPONENT_TREE_FILE;
  const cacheKey = `${root}::${outputPath || UI_PLAN_FILE}::${componentTreeOutputPath}`;
  const useCache = options.useCache !== false;
  const previous = useCache ? uiPlanCaches.get(cacheKey) || { fileCache: new Map() } : { fileCache: new Map() };

  logEvent(UI_LOG_EVENTS.START, { workspaceRoot: root });

  const files = unique(await listWorkspaceFiles(root, { limit }).catch(() => []));
  const outputFiles = [outputPath || UI_PLAN_FILE, componentTreeOutputPath || COMPONENT_TREE_FILE].filter(Boolean);
  const analyses = await readUiTextFiles(root, files, outputFiles);
  const fileCache = new Map();
  let reused = 0;

  for (const analysis of analyses) {
    const cached = previous.fileCache.get(analysis.file);
    if (cached && cached.hash === analysis.hash) reused += 1;
    fileCache.set(analysis.file, { hash: analysis.hash, analysis });
  }

  const componentTree = await buildComponentTree(root, {
    limit,
    outputPath: componentTreeOutputPath,
    useCache
  }).catch(() => null);

  const layouts = analyzeLayouts({ analyses, componentTree });
  const navigation = analyzeNavigation({ analyses, componentTree });
  const widgets = analyzeWidgets({ analyses, componentTree });
  const responsive = analyzeResponsive({ analyses, componentTree });
  const forms = analyzeForms({ analyses, componentTree });
  const flows = analyzeFlows({ analyses, componentTree });
  const pages = buildPages({ analyses, componentTree, summary: { reusedFiles: reused } });
  const impacts = buildImpacts({ componentTree, pages });

  for (const page of pages) {
    logEvent(UI_LOG_EVENTS.PAGE, { title: page.title, path: page.path, route: page.route, layout: page.layout });
  }
  for (const layout of layouts) logEvent(UI_LOG_EVENTS.LAYOUT, { name: layout.name, path: layout.path });
  for (const widget of widgets) logEvent(UI_LOG_EVENTS.WIDGET, { name: widget.name, path: widget.path, kind: widget.kind, usageCount: widget.usageCount });
  for (const form of forms) logEvent(UI_LOG_EVENTS.FORM, { name: form.name, path: form.path });
  for (const nav of navigation) logEvent(UI_LOG_EVENTS.NAVIGATION, { name: nav.name, path: nav.path, labels: nav.labels });
  for (const flow of flows) logEvent(UI_LOG_EVENTS.FLOW, { name: flow.name, path: flow.path, labels: flow.labels });
  for (const item of responsive) logEvent(UI_LOG_EVENTS.RESPONSIVE, { path: item.path, labels: item.labels });
  for (const impact of impacts) logEvent(UI_LOG_EVENTS.IMPACT, { name: impact.name, path: impact.path, affectedPages: impact.affectedPages });

  const plan = {
    version: UI_PLAN_VERSION,
    workspaceRoot: root,
    generatedAt: new Date().toISOString(),
    pages,
    layouts,
    navigation,
    widgets,
    responsive,
    forms,
    flows,
    impacts,
    tree: buildUiTree(pages),
    componentTree: summarizeComponentTree(componentTree),
    summary: {
      pageCount: pages.length,
      layoutCount: layouts.length,
      widgetCount: widgets.length,
      navigationCount: navigation.length,
      formCount: forms.length,
      flowCount: flows.length,
      impactCount: impacts.length,
      reusedFiles: reused,
      filesScanned: analyses.length
    },
    validation: validateUIPlan({ pages })
  };

  await saveUIPlan(root, plan, { outputPath });
  uiPlanCaches.set(cacheKey, { fileCache, plan, componentTree });

  logEvent(UI_LOG_EVENTS.COMPLETE, {
    workspaceRoot: root,
    pageCount: pages.length,
    impactCount: impacts.length,
    reusedFiles: reused
  });

  return plan;
}

export function getUIPlanCache(workspaceRoot, options = {}) {
  const root = path.resolve(String(workspaceRoot || "."));
  const outputPath = options.outputPath || UI_PLAN_FILE;
  const componentTreeOutputPath = options.componentTreeOutputPath || COMPONENT_TREE_FILE;
  return uiPlanCaches.get(`${root}::${outputPath}::${componentTreeOutputPath}`) || null;
}

export { buildUiTree, buildImpacts, loadUIPlan };

