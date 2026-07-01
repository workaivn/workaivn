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

function detectTestFramework(file = "", content = "") {
  const combined = `${file}\n${content}`.toLowerCase();
  if (/(?:jest|enzyme|@testing-library\/react)/.test(combined)) return "jest";
  if (/(?:vitest|@vitest)/.test(combined)) return "vitest";
  if (/(?:mocha|chai|cypress)/.test(combined)) return "mocha";
  if (/(?:pytest|unittest)/.test(combined)) return "pytest";
  if (/(?:phpunit|phpunit\.xml)/.test(combined)) return "phpunit";
  if (/test\(/.test(content) && /(?:go|golang)/.test(combined)) return "go-test";
  if (/(?:rspec|minitest)/.test(combined)) return "rspec";
  if (/(?:unittest|django\.test)/.test(combined)) return "unittest";
  if (/\.(test\.(py|js|ts|jsx|tsx)|spec\.(js|ts|jsx|tsx))$/i.test(file)) return "auto-detected";
  return null;
}

function extractTestEntities(files = [], contents = new Map()) {
  const nodes = [];
  const edges = [];
  
  for (const file of files) {
    const content = contents.get(file) || "";
    const normalized = file.toLowerCase();
    
    if (!/(?:test|spec|__tests__|testing)/i.test(normalized)) continue;
    
    const framework = detectTestFramework(file, content);
    
    const testMatches = [
      ...String(content || "").matchAll(/(?:test|it|describe|context)\s*\(\s*["']([^"']+)["']/gi),
      ...String(content || "").matchAll(/def\s+(?:test_)?([A-Za-z0-9_]+)/gi),
      ...String(content || "").matchAll(/\bfunc\s+Test[A-Za-z0-9_]+\s*\(/gi),
      ...String(content || "").matchAll(/public\s+function\s+test[A-Za-z0-9_]+\s*\(/gi)
    ];
    
    const testNames = unique(testMatches.map(m => m[1]).filter(Boolean));
    
    const targetFile = file.replace(/(?:test|spec|__tests?|testing)/i, "")
      .replace(/\.(test|spec)\.(js|ts|jsx|tsx|py|php|go)$/i, ".$2");
    
    for (const testName of testNames) {
      nodes.push({
        id: buildNodeId("test", `${file}::${testName}`),
        type: KG_NODE_TYPES.TEST,
        name: testName,
        path: file,
        framework: framework,
        source: "code",
        evidence: [{ type: "test_decl", value: testName, source: "ast" }],
        confidence: CONFIDENCE_SCORES.MEDIUM,
        discoveredBy: "testExtractor",
        createdAt: new Date().toISOString()
      });
      
      if (targetFile) {
        edges.push({
          from: buildNodeId("test", `${file}::${testName}`),
          to: buildNodeId("file", targetFile),
          type: KG_EDGE_TYPES.TESTS,
          evidence: [{ type: "test_target", value: targetFile }],
          confidence: CONFIDENCE_SCORES.MEDIUM
        });
      }
    }
  }
  
  return { nodes, edges };
}

export function extractTestEntitiesFromWorkspace(files = [], contents = new Map()) {
  const result = extractTestEntities(files, contents);
  for (const node of result.nodes) {
    logEvent(KG_LOG_EVENTS.TEST_MAPPED, { test: node.name, file: node.path, framework: node.framework }, `test::${node.id}`);
  }
  return result;
}