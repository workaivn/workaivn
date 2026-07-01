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

function normalizePath(value = "") {
  return String(value || "").replace(/\\\\/g, "/").trim();
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
}

function buildNodeId(prefix, id) {
  return `${prefix}:${String(id || "").toLowerCase().replace(/[^a-z0-9_:.-]/g, "_")}`;
}

function extractRouteEntities(files = [], contents = new Map()) {
  const nodes = [];
  const edges = [];
  
  for (const file of files) {
    const content = contents.get(file) || "";
    const normalized = file.toLowerCase();
    
    if (!/(?:route|router|page|pages|controller)/i.test(normalized)) continue;
    
    const routeMatches = [
      ...String(content || "").matchAll(/(?:route|path)\s*[:=]\s*["']([^"']+)["']/gi),
      ...String(content || "").matchAll(/app\.(?:get|post|put|delete|patch|all)\s*\(\s*["']([^"']+)["']/gi),
      ...String(content || "").matchAll(/@Route\(["']([^"']+)["']\)/gi),
      ...String(content || "").matchAll(/@Route\(\s*["']([^"']+)["']/gi),
      ...String(content || "").matchAll(/createBrowserRouter|createRoutesFromElements|Routes|Route\s+path\s*=\s*["']([^"']+)["']/gi)
    ];
    
    for (const match of routeMatches) {
      const routePath = match[1];
      if (!routePath || !/^\//.test(routePath)) continue;
      
      nodes.push({
        id: buildNodeId("route", `${file}::${routePath}`),
        type: KG_NODE_TYPES.ROUTE,
        name: routePath,
        path: file,
        source: "code",
        evidence: [{ type: "route_decl", value: routePath, source: "ast" }],
        confidence: CONFIDENCE_SCORES.HIGH,
        discoveredBy: "routeExtractor",
        createdAt: new Date().toISOString()
      });
      
      edges.push({
        from: buildNodeId("file", file),
        to: buildNodeId("route", `${file}::${routePath}`),
        type: KG_EDGE_TYPES.ROUTES_TO,
        evidence: [{ type: "route_declaration", value: routePath }],
        confidence: CONFIDENCE_SCORES.HIGH
      });
    }
  }
  
  return { nodes, edges };
}

export function extractRouteEntitiesFromWorkspace(files = [], contents = new Map()) {
  const result = extractRouteEntities(files, contents);
  for (const node of result.nodes) {
    logEvent(KG_LOG_EVENTS.ROUTE_MAPPED, { route: node.name, file: node.path }, `route::${node.id}`);
  }
  return result;
}
