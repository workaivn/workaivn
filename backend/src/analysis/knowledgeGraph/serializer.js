import fs from "node:fs/promises";
import path from "node:path";
import { KNOWLEDGE_GRAPH_FILE, KG_LOG_EVENTS } from "./types.js";

function resolveGraphPath(workspaceRoot, outputPath = null) {
  const root = path.resolve(String(workspaceRoot || "."));
  const fileName = outputPath || KNOWLEDGE_GRAPH_FILE;
  return path.resolve(root, ".codex", "cache", fileName);
}

async function saveKnowledgeGraph(workspaceRoot, graph = {}, { outputPath = null } = {}) {
  const filePath = resolveGraphPath(workspaceRoot, outputPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  
  const cleanGraph = {
    ...graph,
    nodes: graph.nodes || [],
    edges: graph.edges || []
  };
  
  await fs.writeFile(filePath, JSON.stringify(cleanGraph, null, 2), "utf8");
  return filePath;
}

async function loadKnowledgeGraph(workspaceRoot, { outputPath = null } = {}) {
  const filePath = resolveGraphPath(workspaceRoot, outputPath);
  const text = await fs.readFile(filePath, "utf8").catch(() => null);
  if (!text) return null;
  
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export { loadKnowledgeGraph, saveKnowledgeGraph, resolveGraphPath };
