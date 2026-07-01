import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { listWorkspaceFiles } from "../../agent/workspace.js";
import { loadComponentTree } from "../componentTree/serializer.js";
import { loadUIPlan } from "../uiPlanner/serializer.js";
import { loadBlueprint } from "../../planning/featureBlueprint/serializer.js";
import { buildFileNode, extractRawDependencies, normalizePath, resolveDependencyTarget, unique } from "./fileGraph.js";
import { buildPackageNodes } from "./moduleGraph.js";
import { buildComponentDependencyEdges } from "./componentGraph.js";
import { buildServiceDependencyEdges } from "./serviceGraph.js";
import { buildApiDependencyEdges } from "./apiGraph.js";
import { buildDatabaseDependencyEdges } from "./databaseGraph.js";
import { buildRuntimeDependencyEdges } from "./runtimeGraph.js";
import { analyzeImpact, buildImpactChain } from "./impactAnalyzer.js";
import { detectCycles } from "./cycleDetector.js";
import { saveDependencyGraph } from "./serializer.js";
import { DEPENDENCY_GRAPH_FILE, DEPENDENCY_GRAPH_VERSION, DEPENDENCY_LOG_EVENTS } from "./types.js";
import { validateDependencyGraph } from "./validator.js";

const workspaceCaches = new Map();
const logDedupe = new Set();

function logEvent(eventName, payload = {}, dedupeKey = null) {
  const key = dedupeKey || `${eventName}::${JSON.stringify(payload || {})}`;
  if (logDedupe.has(key)) return false;
  logDedupe.add(key);
  console.log(`[${eventName}]`, payload);
  return true;
}

function sha1(content = "") {
  return crypto.createHash("sha1").update(String(content || ""), "utf8").digest("hex");
}

function isTextCandidate(file = "") {
  const normalized = normalizePath(file).toLowerCase();
  if (!normalized) return false;
  return /\.(?:js|jsx|ts|tsx|mjs|cjs|mts|cts|py|pyw|rb|vue|svelte|astro|php|phtml|blade\.php|twig|cshtml|aspx|jsp|jspx|html?|md|txt|json|yml|yaml|css|scss|sass|less|xml|ini|env)$/i.test(normalized) ||
    /(^|\/)(?:package\.json|composer\.json|pom\.xml|build\.gradle|cargo\.toml|go\.mod|requirements\.txt|pubspec\.yaml|tsconfig\.json|next\.config\.[cm]?[jt]s|vite\.config\.[cm]?[jt]s|dockerfile|makefile|taskfile)(?:$|\/)/i.test(normalized);
}

function isProbablyText(content = "") {
  const text = String(content || "");
  if (!text) return true;
  if (text.includes("\u0000")) return false;
  return [...text.slice(0, 2048)].some(ch => ch.charCodeAt(0) >= 9);
}

async function loadOptionalGraph(workspaceRoot, loader) {
  if (!workspaceRoot) return null;
  try {
    return await loader(workspaceRoot);
  } catch {
    return null;
  }
}

function ensureNode(nodeMap, node) {
  if (!node?.id) return null;
  const current = nodeMap.get(node.id);
  if (current) {
    const existingFramework = current.framework;
    const existingRoute = current.route;
    const existingType = current.type;
    const existingDependencies = Array.isArray(current.dependencies) ? [...current.dependencies] : [];
    const existingDependents = Array.isArray(current.dependents) ? [...current.dependents] : [];
    Object.assign(current, node);
    if (existingFramework && (current.framework == null || current.framework === "")) current.framework = existingFramework;
    if (existingRoute && (current.route == null || current.route === "")) current.route = existingRoute;
    if (existingType && (current.type == null || current.type === "")) current.type = existingType;
    current.dependencies = unique([...(existingDependencies || []), ...(Array.isArray(current.dependencies) ? current.dependencies : [])]);
    current.dependents = unique([...(existingDependents || []), ...(Array.isArray(current.dependents) ? current.dependents : [])]);
    return current;
  }
  const created = {
    dependencyCount: 0,
    dependentCount: 0,
    fanIn: 0,
    fanOut: 0,
    criticalScore: 0,
    impactScore: 0,
    reuseScore: 0,
    changeFrequency: 0,
    unused: false,
    circular: false,
    dependencies: [],
    dependents: [],
    ...node
  };
  nodeMap.set(created.id, created);
  return created;
}

function edgeKey(edge = {}) {
  return [edge.from || "", edge.to || "", edge.type || "", edge.reason || ""].join("::");
}

function addEdge(edges, edgeSet, edge) {
  if (!edge?.from || !edge?.to) return false;
  const key = edgeKey(edge);
  if (edgeSet.has(key)) return false;
  edgeSet.add(key);
  edges.push({
    from: normalizePath(edge.from),
    to: normalizePath(edge.to),
    type: edge.type || "file",
    reason: edge.reason || "",
    raw: edge.raw || null
  });
  return true;
}

function normalizeLookupNode(node, fallbackId = "") {
  if (!node) {
    return { id: fallbackId, name: fallbackId, path: fallbackId, type: "unknown" };
  }
  if (node.type === "package") {
    return { ...node, path: node.id || node.path || fallbackId };
  }
  return node;
}

function readPackageJsons(files = [], contents = new Map()) {
  const packages = new Map();
  for (const file of files) {
    if (!/package\.json$/i.test(path.posix.basename(normalizePath(file)))) continue;
    const text = contents.get(normalizePath(file)) || "";
    try {
      packages.set(normalizePath(file), JSON.parse(text));
    } catch {
      packages.set(normalizePath(file), {});
    }
  }
  return packages;
}

function buildNodeFromPackage(file, pkg = {}) {
  const id = `package:${pkg.name || path.posix.dirname(normalizePath(file)) || "workspace"}`;
  return {
    id,
    name: pkg.name || path.posix.basename(path.posix.dirname(normalizePath(file))) || "workspace",
    path: normalizePath(file),
    framework: "package",
    type: "package",
    packageName: pkg.name || null,
    dependencies: [],
    dependents: [],
    dependencyCount: 0,
    dependentCount: 0,
    fanIn: 0,
    fanOut: 0,
    criticalScore: 0,
    impactScore: 0,
    reuseScore: 0,
    changeFrequency: 0,
    unused: false,
    circular: false
  };
}

function extractStateSignals(text = "", file = "") {
  const source = `${file}\n${text}`.toLowerCase();
  return /redux|vuex|pinia|ngrx|mobx|context|store|atom|signal|zustand|recoil|cache|localstorage|sessionstorage|cookie/.test(source);
}

function collectRuntimeSignals(text = "", file = "") {
  const source = `${file}\n${text}`.toLowerCase();
  return /worker|cron|queue|job|scheduler|event|message queue|pubsub|socket|realtime|background task/.test(source);
}

function buildGraphFromFileNodes(files, contents, context = {}) {
  const nodes = [];
  const edges = [];
  const nodeMap = new Map();
  const edgeSet = new Set();
  const packageJsonByFile = readPackageJsons(files, contents);

  for (const [file, pkg] of packageJsonByFile.entries()) {
    const pkgNode = buildNodeFromPackage(file, pkg);
    ensureNode(nodeMap, pkgNode);
  }

  for (const file of files) {
    const content = contents.get(file) || "";
    const node = buildFileNode(file, content, context);
    node.state = node.state || extractStateSignals(content, file);
    node.runtime = node.runtime || collectRuntimeSignals(content, file);
    ensureNode(nodeMap, node);

    if (/package\.json$/i.test(path.posix.basename(file))) {
      const pkg = packageJsonByFile.get(file) || {};
      const pkgNode = nodeMap.get(`package:${pkg.name || path.posix.dirname(file) || "workspace"}`);
      if (pkgNode) {
        addEdge(edges, edgeSet, { from: file, to: pkgNode.id, type: "module", reason: "package-manifest" });
        pkgNode.dependents.push(file);
      }
      for (const dep of unique([
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.devDependencies || {}),
        ...Object.keys(pkg.peerDependencies || {})
      ])) {
        const depNodeId = `package:${dep}`;
        ensureNode(nodeMap, {
          id: depNodeId,
          name: dep,
          path: null,
          framework: "package",
          type: "package",
          packageName: dep,
          dependencies: [],
          dependents: [],
          dependencyCount: 0,
          dependentCount: 0,
          fanIn: 0,
          fanOut: 0,
          criticalScore: 0,
          impactScore: 0,
          reuseScore: 0,
          changeFrequency: 0,
          unused: false,
          circular: false
        });
        addEdge(edges, edgeSet, { from: file, to: depNodeId, type: "module", reason: "package-dependency", raw: dep });
      }
      const scripts = Object.keys(pkg.scripts || {});
      if (scripts.length > 0) {
        logEvent(DEPENDENCY_LOG_EVENTS.BUILD, { file, scripts }, `build::${file}`);
      }
    }

    const refs = extractRawDependencies(file, content);
    if (refs.length > 0) {
      logEvent(DEPENDENCY_LOG_EVENTS.FILE, { file, dependencyCount: refs.length }, `file::${file}`);
    }
    for (const ref of refs) {
      const target = resolveDependencyTarget(ref, file, context);
      if (!target) continue;
      const kind = String(target).startsWith("package:") ? "module" : String(target).startsWith("asset:") ? "asset" : "file";
      if (kind === "module") logEvent(DEPENDENCY_LOG_EVENTS.MODULE, { file, dependency: ref, target }, `module::${file}::${ref}`);
      if (kind === "asset") logEvent(DEPENDENCY_LOG_EVENTS.BUILD, { file, dependency: ref, target }, `asset::${file}::${ref}`);
      addEdge(edges, edgeSet, { from: file, to: target, type: kind, reason: ref, raw: ref });
      if (!target.startsWith("package:") && !target.startsWith("asset:")) {
        const targetNode = nodeMap.get(target);
        if (targetNode) targetNode.dependents.push(file);
      }
    }

    const componentTags = [...String(content || "").matchAll(/<\s*([A-Z][A-Za-z0-9_]*)\b/g)].map(match => match[1]);
    if (componentTags.length > 0) {
      logEvent(DEPENDENCY_LOG_EVENTS.COMPONENT, { file, components: componentTags.slice(0, 5) }, `component::${file}`);
    }
    if (node.type === "api") logEvent(DEPENDENCY_LOG_EVENTS.API, { file, route: node.route || null }, `api::${file}`);
    if (node.type === "database") logEvent(DEPENDENCY_LOG_EVENTS.DATABASE, { file }, `database::${file}`);
    if (node.state) logEvent(DEPENDENCY_LOG_EVENTS.STATE, { file }, `state::${file}`);
    if (node.runtime) logEvent(DEPENDENCY_LOG_EVENTS.RUNTIME, { file }, `runtime::${file}`);
  }

  const componentTree = context.componentTree || null;
  const componentEdges = buildComponentDependencyEdges(componentTree, files);
  for (const node of componentEdges.nodes || []) ensureNode(nodeMap, node);
  for (const edge of componentEdges.edges || []) addEdge(edges, edgeSet, edge);

  for (const file of files) {
    const content = contents.get(file) || "";
    const fileDependencies = extractRawDependencies(file, content);
    const serviceEdges = buildServiceDependencyEdges(file, content, { fileDependencies });
    for (const node of serviceEdges.nodes || []) ensureNode(nodeMap, node);
    for (const edge of serviceEdges.edges || []) {
      const resolved = resolveDependencyTarget(edge.to, file, { workspaceFiles: files });
      if (resolved) addEdge(edges, edgeSet, { ...edge, to: resolved });
    }

    const apiEdges = buildApiDependencyEdges(file, content, { fileDependencies });
    for (const node of apiEdges.nodes || []) ensureNode(nodeMap, node);
    for (const edge of apiEdges.edges || []) {
      const resolved = resolveDependencyTarget(edge.to, file, { workspaceFiles: files });
      if (resolved) addEdge(edges, edgeSet, { ...edge, to: resolved });
    }

    const databaseEdges = buildDatabaseDependencyEdges(file, content, { fileDependencies });
    for (const node of databaseEdges.nodes || []) ensureNode(nodeMap, node);
    for (const edge of databaseEdges.edges || []) {
      const resolved = resolveDependencyTarget(edge.to, file, { workspaceFiles: files });
      if (resolved) addEdge(edges, edgeSet, { ...edge, to: resolved });
    }

    const runtimeEdges = buildRuntimeDependencyEdges(file, content, { fileDependencies });
    for (const node of runtimeEdges.nodes || []) ensureNode(nodeMap, node);
    for (const edge of runtimeEdges.edges || []) {
      const resolved = resolveDependencyTarget(edge.to, file, { workspaceFiles: files });
      if (resolved) addEdge(edges, edgeSet, { ...edge, to: resolved });
    }
  }

  for (const node of nodeMap.values()) {
    node.dependencies = unique(node.dependencies || []);
    node.dependents = unique(node.dependents || []);
  }

  return { nodes: [...nodeMap.values()], edges };
}

async function readWorkspaceTextFiles(workspaceRoot, files) {
  const contents = new Map();
  for (const file of files) {
    if (!isTextCandidate(file)) continue;
    const absolute = path.resolve(workspaceRoot, file);
    const text = await fs.readFile(absolute, "utf8").catch(() => null);
    if (text == null || !isProbablyText(text)) continue;
    contents.set(normalizePath(file), text);
  }
  return contents;
}

async function resolveContextGraphs(workspaceRoot, context = {}) {
  const resolved = { ...context };
  if (!resolved.componentTree && workspaceRoot) {
    resolved.componentTree = await loadOptionalGraph(workspaceRoot, loadComponentTree);
  }
  if (!resolved.uiPlan && workspaceRoot) {
    resolved.uiPlan = await loadOptionalGraph(workspaceRoot, loadUIPlan);
  }
  if (!resolved.featureBlueprint && workspaceRoot) {
    resolved.featureBlueprint = await loadOptionalGraph(workspaceRoot, loadBlueprint);
  }
  return resolved;
}

function shouldIncludeFile(root, file, outputPath = null) {
  const relative = normalizePath(path.relative(root, path.resolve(root, file)));
  if (!relative || relative.startsWith("..")) return true;
  const generatedRelative = normalizePath(path.relative(root, path.resolve(root, outputPath || DEPENDENCY_GRAPH_FILE)));
  return relative !== generatedRelative;
}

export async function buildDependencyGraph(workspaceRoot, options = {}) {
  const root = path.resolve(String(workspaceRoot || "."));
  const outputPath = options.outputPath || null;
  const useCache = options.useCache !== false;
  const cacheKey = `${root}::${outputPath || "default"}`;
  const previous = useCache ? workspaceCaches.get(cacheKey) || { fileCache: new Map(), graph: null } : { fileCache: new Map(), graph: null };
  const limit = options.limit || 20000;
  const files = unique(await listWorkspaceFiles(root, { limit }).catch(() => [])).filter(file => shouldIncludeFile(root, file, outputPath));
  const context = await resolveContextGraphs(root, options);
  context.workspaceFiles = files;
  const contents = await readWorkspaceTextFiles(root, files);
  const fileHashes = new Map();
  let reusedFiles = 0;

  for (const [file, content] of contents.entries()) {
    const hash = sha1(content);
    fileHashes.set(file, hash);
    const cached = previous.fileCache.get(file);
    if (cached?.hash === hash) reusedFiles += 1;
  }

  logEvent(DEPENDENCY_LOG_EVENTS.START, { workspaceRoot: root, fileCount: files.length });

  const graphData = buildGraphFromFileNodes(files, contents, context);
  const cycles = detectCycles(graphData.nodes, graphData.edges);
  if (cycles.cycles.length > 0) {
    for (const cycle of cycles.cycles.slice(0, 20)) {
      logEvent(DEPENDENCY_LOG_EVENTS.CYCLE, { cycle }, `cycle::${cycle.join("->")}`);
    }
  }

  for (const node of graphData.nodes) {
    node.circular = cycles.cycleNodes.includes(node.id) || node.circular;
  }

  analyzeImpact(graphData.nodes, graphData.edges);

  const validation = validateDependencyGraph({ nodes: graphData.nodes, edges: graphData.edges });
  const summary = {
    nodeCount: graphData.nodes.length,
    edgeCount: graphData.edges.length,
    cycleCount: cycles.cycles.length,
    criticalCount: graphData.nodes.filter(node => node.criticalScore >= 6).length,
    impactCount: graphData.nodes.filter(node => node.impactScore > 0).length,
    reusedFiles,
    packageCount: graphData.nodes.filter(node => node.type === "package").length,
    runtimeCount: graphData.nodes.filter(node => node.type === "runtime").length,
    databaseCount: graphData.nodes.filter(node => node.type === "database").length
  };

  logEvent(DEPENDENCY_LOG_EVENTS.IMPACT, { criticalCount: summary.criticalCount, impactCount: summary.impactCount }, `impact::${root}`);
  logEvent(DEPENDENCY_LOG_EVENTS.COMPLETE, { workspaceRoot: root, nodeCount: summary.nodeCount, edgeCount: summary.edgeCount, cycleCount: summary.cycleCount }, `complete::${root}`);

  const graph = {
    version: DEPENDENCY_GRAPH_VERSION,
    workspaceRoot: root,
    nodes: graphData.nodes,
    edges: graphData.edges,
    cycles: cycles.cycles,
    summary,
    validation,
    componentTreeSummary: context.componentTree?.summary || null,
    uiPlanSummary: context.uiPlan?.summary || null,
    featureBlueprintSummary: context.featureBlueprint?.metadata || null
  };

  if (useCache) {
    workspaceCaches.set(cacheKey, {
      fileCache: new Map([...fileHashes.entries()].map(([file, hash]) => [file, { hash }])),
      graph
    });
  }

  if (options.save !== false) {
    await saveDependencyGraph(root, graph, { outputPath }).catch(() => null);
  }

  return graph;
}

export function getDependencyGraphCache() {
  return workspaceCaches;
}

export function findDependencies(graph = null, query = "") {
  const needle = String(query || "").toLowerCase();
  if (!graph || !needle) return [];
  const node = (Array.isArray(graph.nodes) ? graph.nodes : []).find(item =>
    String(item.id || "").toLowerCase() === needle ||
    String(item.name || "").toLowerCase() === needle ||
    String(item.path || "").toLowerCase() === needle
  );
  if (!node) return [];
  const nodeMap = new Map((Array.isArray(graph.nodes) ? graph.nodes : []).map(item => [item.id, item]));
  const edgeTargets = new Set((Array.isArray(graph.edges) ? graph.edges : [])
    .filter(edge => edge.from === node.id)
    .map(edge => edge.to));
  for (const dependency of Array.isArray(node.dependencies) ? node.dependencies : []) edgeTargets.add(dependency);
  return [...edgeTargets].map(id => normalizeLookupNode(nodeMap.get(id), id)).filter(Boolean);
}

export function findDependents(graph = null, query = "") {
  const needle = String(query || "").toLowerCase();
  if (!graph || !needle) return [];
  const node = (Array.isArray(graph.nodes) ? graph.nodes : []).find(item =>
    String(item.id || "").toLowerCase() === needle ||
    String(item.name || "").toLowerCase() === needle ||
    String(item.path || "").toLowerCase() === needle
  );
  if (!node) return [];
  const nodeMap = new Map((Array.isArray(graph.nodes) ? graph.nodes : []).map(item => [item.id, item]));
  const edgeSources = new Set((Array.isArray(graph.edges) ? graph.edges : [])
    .filter(edge => edge.to === node.id)
    .map(edge => edge.from));
  for (const dependent of Array.isArray(node.dependents) ? node.dependents : []) edgeSources.add(dependent);
  return [...edgeSources].map(id => normalizeLookupNode(nodeMap.get(id), id)).filter(Boolean);
}

export function findCircular(graph = null) {
  return (Array.isArray(graph?.nodes) ? graph.nodes : []).filter(node => node.circular);
}

export function findUnused(graph = null) {
  return (Array.isArray(graph?.nodes) ? graph.nodes : []).filter(node => node.unused);
}

export function findCriticalNodes(graph = null, limit = 20) {
  return (Array.isArray(graph?.nodes) ? graph.nodes : [])
    .slice()
    .sort((left, right) => right.criticalScore - left.criticalScore || right.impactScore - left.impactScore)
    .slice(0, limit);
}

export function findImpact(graph = null, query = "") {
  const needle = String(query || "").toLowerCase();
  if (!graph || !needle) return [];
  const node = (Array.isArray(graph.nodes) ? graph.nodes : []).find(item =>
    String(item.id || "").toLowerCase() === needle ||
    String(item.name || "").toLowerCase() === needle ||
    String(item.path || "").toLowerCase() === needle
  );
  if (!node) return [];
  return buildImpactChain(graph.nodes, node.id);
}

export function findRuntimeChain(graph = null, query = "") {
  const chain = findImpact(graph, query);
  return chain.filter(node => node.type === "runtime" || node.runtime);
}

export function findDatabaseChain(graph = null, query = "") {
  const chain = findImpact(graph, query);
  return chain.filter(node => node.type === "database" || node.database);
}

export function searchDependency(graph = null, query = "") {
  const needle = String(query || "").toLowerCase();
  if (!graph || !needle) return [];
  return (Array.isArray(graph.nodes) ? graph.nodes : []).filter(node =>
    String(node.id || "").toLowerCase().includes(needle) ||
    String(node.name || "").toLowerCase().includes(needle) ||
    String(node.path || "").toLowerCase().includes(needle) ||
    String(node.type || "").toLowerCase().includes(needle) ||
    (Array.isArray(node.dependencies) && node.dependencies.some(dep => String(dep || "").toLowerCase().includes(needle)))
  );
}
