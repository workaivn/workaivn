import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { listWorkspaceFiles } from "../../agent/workspace.js";
import { buildRouteMappings } from "./routeResolver.js";
import { saveComponentTree } from "./serializer.js";
import { buildRelationshipGraph, createAnalysisRecord, createWorkspaceIndex } from "./relationship.js";
import { COMPONENT_LOG_EVENTS, COMPONENT_TREE_VERSION, DEFAULT_COMPONENT_TREE_FILE } from "./types.js";
import { validateComponentTree } from "./validator.js";
import { normalizePath, unique } from "./resolver.js";

const workspaceCaches = new Map();
const astCaches = new Map();

function logEvent(eventName, payload = {}) {
  console.log(`[${eventName}]`, payload);
}

function sha1(content = "") {
  return createHash("sha1").update(String(content || ""), "utf8").digest("hex");
}

function isTextCandidate(file = "", outputPath = "") {
  const normalized = normalizePath(file).toLowerCase();
  const skipped = new Set([
    DEFAULT_COMPONENT_TREE_FILE.toLowerCase(),
    "ui-plan.json",
    normalizePath(outputPath || "").toLowerCase()
  ].filter(Boolean));
  if (skipped.has(normalized)) return false;
  return /\.(?:js|jsx|ts|tsx|mjs|cjs|mts|cts|vue|svelte|astro|php|phtml|blade\.php|twig|cshtml|aspx|jsp|jspx|html?|md|txt|json|yml|yaml|css|scss|sass|xml|ini|env)$/i.test(normalized) ||
    /(^|\/)(?:package\.json|composer\.json|pyproject\.toml|requirements\.txt|pubspec\.yaml|tsconfig\.json|next\.config\.[cm]?[jt]s)$/i.test(normalized) ||
    /(^|\/)(?:views|templates|pages|app|components|layouts|widgets|shared|common|ui|modules|packages|plugins|extensions|theme)(?:\/|$)/i.test(normalized);
}

function isProbablyText(content = "") {
  const text = String(content || "");
  if (!text) return true;
  if (text.includes("\u0000")) return false;
  return [...text.slice(0, 2048)].filter(ch => ch.charCodeAt(0) >= 9).length > 0;
}

function buildComponentId(file = "", content = "") {
  return sha1(`${normalizePath(file)}::${sha1(content)}`).slice(0, 12);
}

function choosePrimaryParent(node, nodeMap) {
  const priorities = [
    childId => nodeMap.get(childId)?.layout === true,
    childId => nodeMap.get(childId)?.route,
    childId => nodeMap.get(childId)?.type === "layout",
    childId => nodeMap.get(childId)?.type === "page",
    childId => nodeMap.get(childId)?.type === "component"
  ];

  const candidates = [...new Set([...(node.parents || []), ...(node.dependents || [])])].filter(id => nodeMap.has(id));
  if (candidates.length === 0) return null;
  for (const predicate of priorities) {
    const match = candidates.find(predicate);
    if (match) return match;
  }
  return candidates[0];
}

function attachHierarchy(nodes) {
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  for (const node of nodes) {
    const parentId = choosePrimaryParent(node, nodeMap);
    node.parent = parentId || null;
    node.children = unique(node.children || []).filter(childId => childId !== node.id && nodeMap.has(childId));
    node.parents = unique([...(node.parents || []), ...(parentId ? [parentId] : [])]).filter(id => nodeMap.has(id) && id !== node.id);
  }
  return nodeMap;
}

function markSharedUnusedAndCircular(nodes) {
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const visited = new Set();
  const inStack = new Set();
  const cycleNodes = new Set();

  function dfs(nodeId, stack = []) {
    if (inStack.has(nodeId)) {
      const cycleStart = stack.indexOf(nodeId);
      for (const id of stack.slice(cycleStart)) cycleNodes.add(id);
      cycleNodes.add(nodeId);
      return;
    }
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    inStack.add(nodeId);
    stack.push(nodeId);
    const node = nodeMap.get(nodeId);
    for (const childId of node?.children || []) {
      if (nodeMap.has(childId)) dfs(childId, stack);
    }
    stack.pop();
    inStack.delete(nodeId);
  }

  for (const node of nodes) dfs(node.id, []);

  for (const node of nodes) {
    node.circular = cycleNodes.has(node.id);
    node.shared = (node.usageCount || 0) >= 2 || (node.dependents || []).length >= 2;
    node.unused = !node.route && !node.circular && (node.usageCount || 0) === 0 && (node.dependents || []).length === 0;
  }

  return { cycleNodes };
}

function buildHierarchyTree(nodes) {
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const roots = [];
  const seen = new Set();

  function toTree(node, pathTrail = new Set()) {
    if (!node || pathTrail.has(node.id)) {
      return {
        id: node?.id || null,
        name: node?.name || null,
        path: node?.path || null,
        circular: true,
        children: []
      };
    }
    const nextTrail = new Set(pathTrail);
    nextTrail.add(node.id);
    const children = (node.children || [])
      .map(childId => nodeMap.get(childId))
      .filter(Boolean)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(child => toTree(child, nextTrail));
    return {
      id: node.id,
      name: node.name,
      path: node.path,
      framework: node.framework,
      type: node.type,
      route: node.route,
      layout: node.layout,
      dynamic: node.dynamic,
      shared: node.shared,
      unused: node.unused,
      circular: node.circular,
      children
    };
  }

  for (const node of nodes.filter(item => !item.parent || !nodeMap.has(item.parent))) {
    roots.push(toTree(node));
    seen.add(node.id);
  }

  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    if (!node.parent) roots.push(toTree(node));
  }

  return roots.sort((left, right) => left.name.localeCompare(right.name));
}

function serializeNode(node) {
  return {
    id: node.id,
    name: node.name,
    path: node.path,
    framework: node.framework,
    type: node.type,
    parent: node.parent,
    children: node.children,
    parents: node.parents,
    imports: node.imports,
    exports: node.exports,
    props: node.props,
    hooks: node.hooks,
    context: node.context,
    provider: node.provider,
    consumer: node.consumer,
    lazy: node.lazy,
    dynamic: node.dynamic,
    route: node.route,
    routes: node.routes,
    layout: node.layout,
    shared: node.shared,
    usageCount: node.usageCount,
    unused: node.unused,
    circular: node.circular,
    dependencies: node.dependencies,
    dependents: node.dependents,
    lastModified: node.lastModified,
    hash: node.hash
  };
}

function attachFrameworkHints(nodes) {
  for (const node of nodes) {
    if (node.layout) node.type = node.type === "unknown" ? "layout" : node.type;
    if (node.route && node.type === "unknown") node.type = "page";
    if (node.shared && node.type === "unknown") node.type = "shared";
    if (node.provider && node.type === "unknown") node.type = "provider";
    if (node.consumer && node.type === "unknown") node.type = "consumer";
    if (node.dynamic && node.type === "unknown") node.type = "component";
  }
}

export async function buildComponentTree(workspaceRoot, options = {}) {
  const root = path.resolve(String(workspaceRoot || "."));
  const outputPath = options.outputPath || null;
  const limit = options.limit || 10000;
  const useCache = options.useCache !== false;
  const cacheKey = `${root}::${outputPath || "default"}`;
  const previous = useCache ? workspaceCaches.get(cacheKey) || { fileCache: new Map(), tree: null } : { fileCache: new Map(), tree: null };

  logEvent(COMPONENT_LOG_EVENTS.START, { workspaceRoot: root });

  const files = unique(await listWorkspaceFiles(root, { limit }).catch(() => []));
  const index = createWorkspaceIndex(files);
  const fileCache = new Map();
  const contents = new Map();
  const analyses = [];
  let reused = 0;

  for (const file of files) {
    if (!isTextCandidate(file, outputPath)) continue;
    const absolute = path.resolve(root, file);
    const content = await fs.readFile(absolute, "utf8").catch(() => null);
    if (content == null || !isProbablyText(content)) continue;
    const hash = sha1(content);
    const cached = previous.fileCache.get(file);
    let analysis = cached && cached.hash === hash ? cached.analysis : null;
    if (analysis) {
      reused += 1;
    } else {
      analysis = createAnalysisRecord(file, content, index, files);
    }
    if (!analysis) continue;
    analysis.lastModified = await fs.stat(absolute).then(stat => stat.mtimeMs).catch(() => null);
    analysis.hash = hash;
    analysis.content = content;
    contents.set(normalizePath(file), content);
    fileCache.set(file, { hash, analysis });
    analyses.push(analysis);
  }

  const routeMappings = buildRouteMappings(analyses);
  const { nodesByPath } = buildRelationshipGraph(analyses, index);
  const nodes = analyses.map(node => serializeNode(node));
  attachFrameworkHints(nodes);
  const nodeMap = attachHierarchy(nodes);
  const { cycleNodes } = markSharedUnusedAndCircular(nodes);

  for (const mapping of routeMappings) {
    const node = nodeMap.get(mapping.componentId);
    if (node) {
      node.route = node.route || mapping.route;
    }
  }

  for (const node of nodes) {
    if (node.route) logEvent(COMPONENT_LOG_EVENTS.ROUTE, { name: node.name, path: node.path, route: node.route, framework: node.framework });
    if (node.layout) logEvent(COMPONENT_LOG_EVENTS.LAYOUT, { name: node.name, path: node.path, framework: node.framework });
    if (node.shared) logEvent(COMPONENT_LOG_EVENTS.SHARED, { name: node.name, path: node.path, usageCount: node.usageCount });
    if (node.unused) logEvent(COMPONENT_LOG_EVENTS.UNUSED, { name: node.name, path: node.path });
    if (node.circular) logEvent(COMPONENT_LOG_EVENTS.CYCLE, { name: node.name, path: node.path });
    logEvent(COMPONENT_LOG_EVENTS.FOUND, { name: node.name, path: node.path, framework: node.framework, type: node.type });
  }

  const tree = {
    version: COMPONENT_TREE_VERSION,
    workspaceRoot: root,
    generatedAt: new Date().toISOString(),
    filesScanned: files.length,
    components: nodes,
    routes: routeMappings,
    root: buildHierarchyTree(nodes),
    summary: {
      componentCount: nodes.length,
      sharedCount: nodes.filter(node => node.shared).length,
      unusedCount: nodes.filter(node => node.unused).length,
      circularCount: cycleNodes.size,
      reusedCount: reused
    },
    validation: validateComponentTree({ components: nodes })
  };

  await saveComponentTree(root, tree, { outputPath });
  workspaceCaches.set(cacheKey, {
    fileCache,
    tree,
    files,
    nodesByPath
  });

  logEvent(COMPONENT_LOG_EVENTS.COMPLETE, {
    workspaceRoot: root,
    componentCount: nodes.length,
    reusedCount: reused,
    circularCount: cycleNodes.size
  });

  return tree;
}

export function getComponentTreeCache(workspaceRoot, options = {}) {
  const root = path.resolve(String(workspaceRoot || "."));
  const outputPath = options.outputPath || null;
  return workspaceCaches.get(`${root}::${outputPath || "default"}`) || null;
}

export { buildComponentId };
