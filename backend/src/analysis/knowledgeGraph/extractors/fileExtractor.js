import path from "node:path";
import crypto from "node:crypto";
import { KG_NODE_TYPES, KG_EDGE_TYPES, CONFIDENCE_SCORES, KG_LOG_EVENTS } from "../types.js";

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

function buildNodeId(prefix, id) {
  return `${prefix}:${String(id || "").toLowerCase().replace(/[^a-z0-9_:.-]/g, "_")}`;
}

function normalizePath(value = "") {
  return String(value || "").replace(/\\/g, "/").trim();
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
}

function extractEntity(source, typeHint = null) {
  if (!source) return null;
  
  const filePath = normalizePath(source.path || "");
  const fileBase = filePath ? path.posix.basename(filePath) : null;
  
  const node = {
    id: buildNodeId("file", filePath),
    type: source.type || typeHint || KG_NODE_TYPES.FILE,
    name: fileBase || source.name || "",
    path: filePath,
    source: "workspace",
    evidence: [],
    confidence: CONFIDENCE_SCORES.MEDIUM,
    discoveredBy: "fileScanner",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  if (source.content) {
    node.hash = sha1(source.content);
    node.evidence.push({
      type: "content_hash",
      value: node.hash.slice(0, 16),
      source: "content"
    });
  }
  
  return node;
}

function detectEntityType(file, content) {
  if (!file || !content) return KG_NODE_TYPES.UNKNOWN;
  
  const normalized = file.toLowerCase();
  const combined = `${file}\n${content}`.toLowerCase();
  
  if (normalized.endsWith(".json") && /(package\.json|composer\.json|tsconfig\.json)/.test(normalized)) {
    return KG_NODE_TYPES.PACKAGE;
  }
  
  if (/\.(md|markdown)$/.test(normalized)) {
    return KG_NODE_TYPES.DOCUMENTATION;
  }
  
  if (/(test|spec)/.test(normalized) || /\.(test\.(js|ts|jsx|tsx)|spec\.(js|ts|jsx|tsx))$/.test(normalized)) {
    return KG_NODE_TYPES.TEST;
  }
  
  if (/(config|env|setting)/.test(normalized) || /\.(config\.(js|ts)|env\.|(?:yml|yaml|toml|ini))$/.test(normalized)) {
    return KG_NODE_TYPES.CONFIG;
  }
  
  if (/\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/.test(normalized)) {
    return KG_NODE_TYPES.ASSET;
  }
  
  if (combined.includes("router") || combined.includes("route") || /routes\.(js|ts)/.test(normalized)) {
    return KG_NODE_TYPES.ROUTE;
  }
  
  if (combined.includes("controller") || combined.includes("endpoint") || combined.includes("api") || /controllers?\//.test(normalized)) {
    return KG_NODE_TYPES.API;
  }
  
  if (combined.includes("model") || combined.includes("schema") || combined.includes("entity") || /models?\//.test(normalized)) {
    return KG_NODE_TYPES.DATA;
  }
  
  if (/<\w+/.test(content) || combined.includes("component") || combined.includes("jsx") || combined.includes("tsx")) {
    return KG_NODE_TYPES.UI;
  }
  
  if (combined.includes("service") || combined.includes("repository") || combined.includes("dao")) {
    return KG_NODE_TYPES.MODULE;
  }
  
  return KG_NODE_TYPES.FILE;
}

function extractRelations(file, content, nodes) {
  const edges = [];
  
  if (!file || !content) return edges;
  
  const importMatches = [...String(content || "").matchAll(/import\s+["']([^"']+)["']/g)];
  const requireMatches = [...String(content || "").matchAll(/(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/g)];
  
  for (const match of [...importMatches, ...requireMatches]) {
    const depPath = match[1];
    if (!depPath) continue;
    
    const normalizedDep = normalizePath(depPath);
    const targetId = buildNodeId("file", normalizedDep);
    
    if (nodes.has(targetId)) {
      edges.push({
        from: buildNodeId("file", file),
        to: targetId,
        type: KG_EDGE_TYPES.IMPORTS,
        evidence: [{ type: "import_statement", value: depPath, source: "ast" }],
        confidence: CONFIDENCE_SCORES.HIGH
      });
    }
  }
  
  const exportMatches = [...String(content || "").matchAll(/export\s+(?:default\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/g)];
  for (const match of exportMatches) {
    edges.push({
      from: buildNodeId("file", file),
      to: `symbol:${match[1]}`,
      type: KG_EDGE_TYPES.EXPORTS,
      evidence: [{ type: "export_symbol", value: match[1], source: "ast" }],
      confidence: CONFIDENCE_SCORES.HIGH
    });
  }
  
  return edges;
}

export function extractFileEntities(files = [], contents = new Map()) {
  const nodes = new Map();
  const edges = [];
  
  for (const file of files) {
    const content = contents.get(file) || "";
    const typeHint = detectEntityType(file, content);
    
    if (typeHint === KG_NODE_TYPES.UNKNOWN && !content) continue;
    
    const node = {
      id: buildNodeId("file", file),
      type: typeHint,
      name: path.posix.basename(file) || "",
      path: file,
      source: "workspace",
      evidence: [{ type: "workspace_scan", value: file }],
      confidence: CONFIDENCE_SCORES.MEDIUM,
      discoveredBy: "fileExtractor",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (content) {
      node.hash = sha1(content);
    }
    
    nodes.set(node.id, node);
    logEvent(KG_LOG_EVENTS.ENTITY_FOUND, { type: node.type, file }, `entity::${node.id}`);
    
    const fileEdges = extractRelations(file, content, nodes);
    for (const edge of fileEdges) {
      edges.push(edge);
      logEvent(KG_LOG_EVENTS.RELATION_FOUND, { type: edge.type, from: file, to: edge.to }, `relation::${edge.from}::${edge.to}`);
    }
  }
  
  return { nodes: [...nodes.values()], edges };
}

export const extractFileEntitiesFromWorkspace = extractFileEntities;
