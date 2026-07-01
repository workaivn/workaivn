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

function classifyCommand(cmd = "", file = "") {
  const command = String(cmd || "").toLowerCase();
  if (/^(?:npm|yarn|pnpm|npm run) (?:install|i)$/.test(command)) return "install";
  if (/^(?:npm|yarn|pnpm|npm run) (?:test|t)$/.test(command)) return "test";
  if (/^(?:npm|yarn|pnpm|npm run) (?:lint|eslint|prettier)/.test(command)) return "lint";
  if (/^(?:npm|yarn|pnpm|npm run) (?:build|b)$/.test(command)) return "build";
  if (/^(?:npm|yarn|pnpm|npm run) (?:dev|start|serve)$/.test(command)) return "dev";
  if (/^(?:npm|yarn|pnpm|npm run) (?:format|f)/.test(command)) return "format";
  if (/^(?:npm|yarn|pnpm|npm run) (?:migrate|migrate:) /.test(command)) return "migrate";
  if (/^(?:npm|yarn|pnpm|npm run) (?:seed|seed:) /.test(command)) return "seed";
  return "custom";
}

function extractCommandEntities(files = [], contents = new Map()) {
  const nodes = [];
  const edges = [];
  
  for (const file of files) {
    const content = contents.get(file) || "";
    const normalized = file.toLowerCase();
    
    if (!/package\.json$/i.test(normalized)) continue;
    
    let pkg;
    try {
      pkg = JSON.parse(content);
    } catch {
      continue;
    }
    
    const scripts = pkg.scripts || {};
    for (const [scriptName, scriptCmd] of Object.entries(scripts)) {
      const commandId = buildNodeId("command", `${file}::${scriptName}`);
      nodes.push({
        id: commandId,
        type: KG_NODE_TYPES.COMMAND,
        name: scriptName,
        path: file,
        command: String(scriptCmd),
        purpose: classifyCommand(String(scriptCmd), file),
        source: "config",
        evidence: [{ type: "package_script", value: scriptName }],
        confidence: CONFIDENCE_SCORES.HIGH,
        discoveredBy: "commandExtractor",
        createdAt: new Date().toISOString()
      });
      
      edges.push({
        from: buildNodeId("file", file),
        to: commandId,
        type: KG_EDGE_TYPES.CONFIGURES,
        evidence: [{ type: "script_definition", value: scriptName }],
        confidence: CONFIDENCE_SCORES.HIGH
      });
    }
  }
  
  return { nodes, edges };
}

export function extractCommandEntitiesFromWorkspace(files = [], contents = new Map()) {
  const result = extractCommandEntities(files, contents);
  for (const node of result.nodes) {
    logEvent(KG_LOG_EVENTS.COMMAND_MAPPED, { command: node.name, purpose: node.purpose }, `command::${node.id}`);
  }
  return result;
}