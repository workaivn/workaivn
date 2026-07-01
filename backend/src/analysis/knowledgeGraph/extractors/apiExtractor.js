import path from "node:path";
import { KG_NODE_TYPES, KG_EDGE_TYPES, CONFIDENCE_SCORES, KG_LOG_EVENTS } from "../types.js";

const logDedupe = new Set();

function logEvent(eventName, payload = {}, dedupeKey = null) {
  const key = dedupeKey || `${eventName}::${JSON.stringify(payload || {})}`;
  if (logDedupe.has(key)) return false;
  logDedupe.add(key);
  console.log(`[${eventName}]`, payload);
  return true;
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

function extractApiEntities(files = [], contents = new Map()) {
  const nodes = [];
  const edges = [];
  
  for (const file of files) {
    const content = contents.get(file) || "";
    const normalized = file.toLowerCase();
    
    const hasRouteSyntax =
      /(?:app|router)\.(?:get|post|put|delete|patch|all)\s*\(/i.test(content) ||
      /(?:@(?:Get|Post|Put|Delete|Patch|RequestMapping)\s*\()/i.test(content) ||
      /(?:fetch|axios\.(?:get|post|put|delete|patch))\s*\(/i.test(content);
    const looksLikeApiFile =
      /(?:controller|api|endpoint|route|server|app|backend|handler)/i.test(normalized) ||
      /(?:express|koa|fastify|hono|nestjs|flask|django|rest|http)/i.test(content);
    
    if (!hasRouteSyntax || !looksLikeApiFile) continue;
    
    const apiMatches = [
      ...String(content || "").matchAll(/(?:app|router)\.(get|post|put|delete|patch|all)\s*\(\s*["']([^"']+)["']/gi),
      ...String(content || "").matchAll(/@(?:Get|Post|Put|Delete|Patch|RequestMapping)\s*\(\s*["']([^"']+)["']\s*\)/gi),
      ...String(content || "").matchAll(/@(?:get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']\s*\)/gi),
      ...String(content || "").matchAll(/fetch\s*\(\s*["']([^"']+)["']/gi),
      ...String(content || "").matchAll(/axios\.(?:get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/gi)
    ];
    
    for (const match of apiMatches) {
      const apiPath = match[2] || match[1];
      if (!apiPath) continue;
      
      const httpMethod = match[1]
        ? String(match[1]).toUpperCase()
        : /get/i.test(content.slice(Math.max(0, match.index - 50), match.index)) ? "GET" :
          /post/i.test(content.slice(Math.max(0, match.index - 50), match.index)) ? "POST" :
          /put/i.test(content.slice(Math.max(0, match.index - 50), match.index)) ? "PUT" :
          /delete/i.test(content.slice(Math.max(0, match.index - 50), match.index)) ? "DELETE" : "UNKNOWN";
      
      nodes.push({
        id: buildNodeId("api", `${httpMethod}:${apiPath}`),
        type: KG_NODE_TYPES.API,
        name: apiPath,
        path: file,
        method: httpMethod,
        source: "code",
        evidence: [{ type: "api_decl", value: `${httpMethod} ${apiPath}`, source: "ast" }],
        confidence: CONFIDENCE_SCORES.HIGH,
        discoveredBy: "apiExtractor",
        createdAt: new Date().toISOString()
      });
      
      edges.push({
        from: buildNodeId("file", file),
        to: buildNodeId("api", `${httpMethod}:${apiPath}`),
        type: KG_EDGE_TYPES.HANDLES,
        evidence: [{ type: "endpoint_declaration", method: httpMethod, path: apiPath }],
        confidence: CONFIDENCE_SCORES.HIGH
      });
    }
  }
  
  return { nodes, edges };
}

export function extractApiEntitiesFromWorkspace(files = [], contents = new Map()) {
  const result = extractApiEntities(files, contents);
  for (const node of result.nodes) {
    logEvent(KG_LOG_EVENTS.API_MAPPED, { api: `${node.method} ${node.name}`, file: node.path }, `api::${node.id}`);
  }
  return result;
}
