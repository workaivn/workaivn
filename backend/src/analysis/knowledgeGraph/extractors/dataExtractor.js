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

function extractDataEntities(files = [], contents = new Map()) {
  const nodes = [];
  const edges = [];
  
  for (const file of files) {
    const content = contents.get(file) || "";
    const normalized = file.toLowerCase();
    
    const schemaMatches = [
      ...String(content || "").matchAll(/(?:schema|model|collection)\s*\.\s*(?:model|schema|define|create|collection)\s*\(\s*["']([A-Za-z0-9_\-]+)["']/gi),
      ...String(content || "").matchAll(/new\s+(?:Schema|model)\s*\(\s*["']([A-Za-z0-9_\-]+)["']/gi),
      ...String(content || "").matchAll(/@Entity\s*\(\s*["']([A-Za-z0-9_\-]+)["']/gi),
      ...String(content || "").matchAll(/class\s+([A-Za-z0-9_]+)\s+extends\s+(?:Model|Entity|BaseModel)/gi),
      ...String(content || "").matchAll(/Table\s*\(\s*["']([A-Za-z0-9_\-]+)["']/gi),
      ...String(content || "").matchAll(/\b([A-Za-z0-9_]+)Schema\s*[/{]/gi),
      ...String(content || "").matchAll(/\binferSchema\s*\(\s*{/gi)
    ];
    
    const modelNames = unique(
      [...schemaMatches.map(m => m[1] || m[0])]
      .filter(Boolean)
    );
    
    for (const modelName of modelNames) {
      nodes.push({
        id: buildNodeId("data", modelName),
        type: KG_NODE_TYPES.DATA,
        name: modelName,
        path: file,
        source: "code",
        evidence: [{ type: "model_decl", value: modelName, source: "ast" }],
        confidence: CONFIDENCE_SCORES.MEDIUM,
        discoveredBy: "dataExtractor",
        createdAt: new Date().toISOString()
      });
      
      edges.push({
        from: buildNodeId("file", file),
        to: buildNodeId("data", modelName),
        type: KG_EDGE_TYPES.OWNS,
        evidence: [{ type: "model_definition", value: modelName }],
        confidence: CONFIDENCE_SCORES.MEDIUM
      });
    }
    
    const fieldMatches = [...String(content || "").matchAll(/\b([A-Za-z0-9_]+)\s*:\s*(?:String|Number|Boolean|Date|Int|Float|Boolean|ObjectId|Ref|Array|Decimal128|Mixed|<)/gi)];
    if (fieldMatches.length > 0 && modelNames.length > 0) {
      for (const modelName of modelNames) {
        const modelNode = nodes.find(n => n.name === modelName);
        if (modelNode) {
          modelNode.fields = unique([
            ...modelNode.fields || [],
            ...fieldMatches.map(m => m[1])
          ]);
        }
      }
    }
  }
  
  return { nodes, edges };
}

export function extractDataEntitiesFromWorkspace(files = [], contents = new Map()) {
  const result = extractDataEntities(files, contents);
  for (const node of result.nodes) {
    logEvent(KG_LOG_EVENTS.DATA_MAPPED, { model: node.name, file: node.path }, `data::${node.id}`);
  }
  return result;
}
