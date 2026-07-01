import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { listWorkspaceFiles } from "../../agent/workspace.js";
import { loadDependencyGraph } from "../dependencyGraph/serializer.js";
import { loadComponentTree } from "../componentTree/serializer.js";
import { loadUIPlan } from "../uiPlanner/serializer.js";
import { loadBlueprint } from "../../planning/featureBlueprint/serializer.js";
import { loadKnowledgeGraph as loadKg, saveKnowledgeGraph } from "./serializer.js";
import { validateKnowledgeGraph } from "./validator.js";
import {
  extractFileEntities,
  extractRouteEntitiesFromWorkspace,
  extractApiEntitiesFromWorkspace,
  extractDataEntitiesFromWorkspace,
  extractTestEntitiesFromWorkspace,
  extractCommandEntitiesFromWorkspace
} from "./extractors/index.js";
import { KNOWLEDGE_GRAPH_FILE, KNOWLEDGE_GRAPH_VERSION, KG_LOG_EVENTS, CONFIDENCE_SCORES, KG_NODE_TYPES } from "./types.js";

const workspaceCache = new Map();

function sha1(content = "") {
  return crypto.createHash("sha1").update(String(content || ""), "utf8").digest("hex");
}

function logEvent(eventName, payload = {}, dedupeKey = null) {
  const key = dedupeKey || `${eventName}::${JSON.stringify(payload || {})}`;
  console.log(`[${eventName}]`, payload);
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
}

function filterKnowledgeGraphSourceFiles(files = []) {
  return unique(files).filter(file => {
    const normalized = normalizePath(file).toLowerCase();
    if (!normalized) return false;
    if (normalized.startsWith(".codex/")) return false;
    if (normalized.includes("/.codex/")) return false;
    return true;
  });
}

function normalizePath(value = "") {
  return String(value || "").replace(/\\\\/g, "/").trim();
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

async function readWorkspaceFiles(workspaceRoot, files) {
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

async function loadOptionalGraph(workspaceRoot, loader) {
  if (!workspaceRoot) return null;
  try {
    return await loader(workspaceRoot);
  } catch {
    return null;
  }
}

function mergeNodes(existing, incoming) {
  const nodeMap = new Map();
  
  for (const node of existing) {
    nodeMap.set(node.id, { ...node });
  }
  
  for (const node of incoming) {
    const existing = nodeMap.get(node.id);
    if (existing) {
      Object.assign(existing, node);
      existing.updatedAt = new Date().toISOString();
    } else {
      nodeMap.set(node.id, { ...node });
    }
  }
  
  return [...nodeMap.values()];
}

function mergeEdges(existing, incoming) {
  const edgeSet = new Set();
  const edges = [];
  
  for (const edge of [...existing, ...incoming]) {
    const key = `${edge.from}::${edge.to}::${edge.type}`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      edges.push(edge);
    }
  }
  
  return edges;
}

function normalizeNode(node = {}) {
  const evidence = Array.isArray(node.evidence) ? node.evidence.filter(Boolean) : [];
  return {
    id: node.id,
    type: node.type || KG_NODE_TYPES.UNKNOWN,
    name: node.name || node.title || node.label || node.path || node.id || "",
    path: node.path || "",
    source: node.source || "workspace",
    evidence,
    confidence: node.confidence ?? CONFIDENCE_SCORES.MEDIUM,
    discoveredBy: node.discoveredBy || "knowledgeGraph",
    createdAt: node.createdAt || new Date().toISOString(),
    updatedAt: node.updatedAt || node.createdAt || new Date().toISOString(),
    ...node
  };
}

function normalizeEdge(edge = {}, index = 0) {
  const evidence = Array.isArray(edge.evidence) ? edge.evidence.filter(Boolean) : [];
  const from = edge.from || "";
  const to = edge.to || "";
  const type = edge.type || KG_EDGE_TYPES.UNKNOWN;
  return {
    id: edge.id || `${from}->${to}:${type}:${index}`,
    type,
    name: edge.name || `${from} -> ${to}`,
    from,
    to,
    source: edge.source || "workspace",
    evidence,
    confidence: edge.confidence ?? CONFIDENCE_SCORES.MEDIUM,
    discoveredBy: edge.discoveredBy || "knowledgeGraph",
    createdAt: edge.createdAt || new Date().toISOString(),
    updatedAt: edge.updatedAt || edge.createdAt || new Date().toISOString(),
    ...edge
  };
}

export async function buildKnowledgeGraph(workspaceRoot, options = {}) {
  const input = workspaceRoot && typeof workspaceRoot === "object" && !Array.isArray(workspaceRoot)
    ? workspaceRoot
    : { ...options, workspaceRoot };
  const root = path.resolve(String(input.workspaceRoot || "."));
  const useCache = input.useCache !== false;
  const limit = input.limit || 20000;
  const files = filterKnowledgeGraphSourceFiles(await listWorkspaceFiles(root, { limit }).catch(() => []));
  
  logEvent(KG_LOG_EVENTS.START, { workspaceRoot: root, fileCount: files.length });
  
  const dependencyGraph = input.dependencyGraph || await loadOptionalGraph(root, loadDependencyGraph);
  const componentTree = input.componentTree || await loadOptionalGraph(root, loadComponentTree);
  const uiPlan = input.uiPlan || await loadOptionalGraph(root, loadUIPlan);
  const featureBlueprint = input.featureBlueprint || await loadOptionalGraph(root, loadBlueprint);
  
  const contents = await readWorkspaceFiles(root, files);
  
  const allNodes = [];
  const allEdges = [];
  
  const fileResults = extractFileEntities(files, contents);
  allNodes.push(...fileResults.nodes);
  allEdges.push(...fileResults.edges);
  
  const routeResults = extractRouteEntitiesFromWorkspace(files, contents);
  allNodes.push(...routeResults.nodes);
  allEdges.push(...routeResults.edges);
  
  const apiResults = extractApiEntitiesFromWorkspace(files, contents);
  allNodes.push(...apiResults.nodes);
  allEdges.push(...apiResults.edges);
  
  const dataResults = extractDataEntitiesFromWorkspace(files, contents);
  allNodes.push(...dataResults.nodes);
  allEdges.push(...dataResults.edges);
  
  const testResults = extractTestEntitiesFromWorkspace(files, contents);
  allNodes.push(...testResults.nodes);
  allEdges.push(...testResults.edges);
  
  const commandResults = extractCommandEntitiesFromWorkspace(files, contents);
  allNodes.push(...commandResults.nodes);
  allEdges.push(...commandResults.edges);
  
  if (dependencyGraph) {
    for (const node of dependencyGraph.nodes || []) {
      if (!allNodes.find(n => n.id === node.id)) {
        allNodes.push({
          id: node.id,
          type: node.type || KG_NODE_TYPES.FILE,
          name: node.name || "",
          path: node.path || "",
          source: "dependencyGraph",
          evidence: [{ type: "dependency_graph", value: node.id }],
          confidence: CONFIDENCE_SCORES.MEDIUM,
          discoveredBy: "dependencyGraphImport",
          createdAt: new Date().toISOString(),
          ...node
        });
      }
    }
  }
  
  if (componentTree) {
    for (const comp of componentTree.components || []) {
      const nodeId = `ui:${comp.id}`;
      if (!allNodes.find(n => n.id === nodeId)) {
        allNodes.push({
          id: nodeId,
          type: KG_NODE_TYPES.UI,
          name: comp.name || "",
          path: comp.path || "",
          source: "componentTree",
          evidence: [{ type: "component_tree", value: comp.path }],
          confidence: CONFIDENCE_SCORES.MEDIUM,
          discoveredBy: "componentTreeImport",
          createdAt: new Date().toISOString()
        });
      }
    }
  }

  const normalizedNodes = unique(allNodes.map(normalizeNode)).filter(Boolean);
  const normalizedEdges = unique(allEdges.map((edge, index) => normalizeEdge(edge, index)).filter(Boolean));
  
  const projectHash = sha1(JSON.stringify(normalizedNodes.map(n => ({ id: n.id, hash: n.hash || "" }))));
  const nodesById = new Map(normalizedNodes.map(node => [node.id, node]));
  const indexes = {
    byId: Object.fromEntries(normalizedNodes.map(node => [node.id, node.id])),
    byPath: Object.fromEntries(normalizedNodes.filter(node => node.path).map(node => [node.path, node.id])),
    byName: normalizedNodes.reduce((acc, node) => {
      const key = String(node.name || "").toLowerCase();
      if (!key) return acc;
      (acc[key] ||= []).push(node.id);
      return acc;
    }, {}),
    byType: normalizedNodes.reduce((acc, node) => {
      (acc[node.type] ||= []).push(node.id);
      return acc;
    }, {}),
    bySource: normalizedNodes.reduce((acc, node) => {
      (acc[node.source] ||= []).push(node.id);
      return acc;
    }, {})
  };
  
  const graph = {
    graphVersion: KNOWLEDGE_GRAPH_VERSION,
    workspaceId: root,
    projectHash,
    nodes: normalizedNodes,
    edges: normalizedEdges,
    indexes,
    summary: {
      nodeCount: normalizedNodes.length,
      edgeCount: normalizedEdges.length,
      typeDistribution: normalizedNodes.reduce((acc, n) => {
        acc[n.type] = (acc[n.type] || 0) + 1;
        return acc;
      }, {}),
      confidenceDistribution: {
        high: normalizedNodes.filter(n => (n.confidence || 0) >= CONFIDENCE_SCORES.HIGH).length,
        medium: normalizedNodes.filter(n => (n.confidence || 0) >= CONFIDENCE_SCORES.MEDIUM && (n.confidence || 0) < CONFIDENCE_SCORES.HIGH).length,
        low: normalizedNodes.filter(n => (n.confidence || 0) < CONFIDENCE_SCORES.MEDIUM).length
      }
    },
    confidence: {
      overall: normalizedNodes.length > 0 ? normalizedNodes.reduce((sum, n) => sum + (n.confidence || 0), 0) / normalizedNodes.length : 0
    },
    staleNodes: [],
    invalidatedEdges: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  const validation = validateKnowledgeGraph(graph);
  
  if (input.save !== false) {
    await saveKnowledgeGraph(root, graph).catch(() => null);
  }
  
  logEvent(KG_LOG_EVENTS.COMPLETE, { nodeCount: allNodes.length, edgeCount: allEdges.length });
  
  return { ...graph, validation };
}

export async function loadKnowledgeGraph(workspaceRoot, options = {}) {
  return loadKg(workspaceRoot, options);
}

export async function updateKnowledgeGraph(workspaceRoot, options = {}) {
  const input = workspaceRoot && typeof workspaceRoot === "object" && !Array.isArray(workspaceRoot)
    ? workspaceRoot
    : { ...options, workspaceRoot };
  const root = path.resolve(String(input.workspaceRoot || "."));
  const existing = await loadKnowledgeGraph(root, input);
  
  if (!existing) {
    return buildKnowledgeGraph(root, options);
  }
  
  const files = unique(await listWorkspaceFiles(root, { limit: input.limit || 20000 }).catch(() => []));
  const contents = await readWorkspaceFiles(root, files);
  
  const staleNodes = updateStaleNodes(existing.nodes || [], contents);
  const updated = await buildKnowledgeGraph(root, { ...input, skipSave: true, save: false });
  const staleNodeIds = new Set(staleNodes);
  const updatedEdgeIds = new Set((updated.edges || []).map(edge => edge.id));
  const invalidatedEdges = (existing.edges || []).filter(edge =>
    staleNodeIds.has(edge.from) ||
    staleNodeIds.has(edge.to) ||
    !updatedEdgeIds.has(edge.id)
  );
  
  return {
    ...updated,
    staleNodes,
    invalidatedEdges
  };
}

function updateStaleNodes(nodes, contents) {
  const stale = [];
  for (const node of nodes) {
    const fileContent = node.path ? contents.get(node.path) : null;
    const currentHash = fileContent ? sha1(fileContent) : null;
    
    if (node.hash && node.hash !== currentHash) {
      stale.push(node.id);
    }
  }
  return stale;
}

export function queryKnowledgeGraph(graph = null, query = "") {
  if (!graph) return null;
  
  const needle = String(query || "").toLowerCase();
  const matches = (Array.isArray(graph.nodes) ? graph.nodes : []).filter(node =>
    String(node.id || "").toLowerCase().includes(needle) ||
    String(node.name || "").toLowerCase().includes(needle) ||
    String(node.path || "").toLowerCase().includes(needle)
  );
  
  return matches;
}

export function findEntity(graph = null, query = "") {
  if (!graph) return null;
  
  const needle = String(query || "").toLowerCase();
  return (Array.isArray(graph.nodes) ? graph.nodes : []).find(node =>
    String(node.id || "").toLowerCase() === needle ||
    String(node.name || "").toLowerCase() === needle ||
    String(node.path || "").toLowerCase() === needle
  ) || null;
}

export function findRelations(graph = null, query = "") {
  if (!graph) return [];
  
  const needle = String(query || "").toLowerCase();
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  
  const node = nodes.find(n =>
    String(n.id || "").toLowerCase() === needle ||
    String(n.name || "").toLowerCase() === needle
  );
  
  if (!node) return [];
  
  const related = [];
  for (const edge of edges) {
    if (edge.from === node.id || edge.to === node.id) {
      related.push({
        node: nodes.find(n => n.id === (edge.from === node.id ? edge.to : edge.from)),
        edge: {
          type: edge.type,
          direction: edge.from === node.id ? "outgoing" : "incoming"
        }
      });
    }
  }
  
  return related;
}

export function serializeKnowledgeGraph(graph = {}) {
  const cleanGraph = {
    graphVersion: graph.graphVersion,
    workspaceId: graph.workspaceId,
    projectHash: graph.projectHash,
    nodes: graph.nodes || [],
    edges: graph.edges || [],
    indexes: graph.indexes || {},
    summary: graph.summary || {},
    confidence: graph.confidence || {},
    staleNodes: graph.staleNodes || [],
    invalidatedEdges: graph.invalidatedEdges || []
  };
  return JSON.stringify(cleanGraph, null, 2);
}
