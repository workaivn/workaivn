import fs from "node:fs/promises";
import path from "node:path";
import { DEPENDENCY_GRAPH_FILE } from "./types.js";

function resolveGraphPath(workspaceRoot, outputPath = null) {
  return path.resolve(String(workspaceRoot || "."), outputPath || DEPENDENCY_GRAPH_FILE);
}

async function saveDependencyGraph(workspaceRoot, graph = {}, { outputPath = null } = {}) {
  const filePath = resolveGraphPath(workspaceRoot, outputPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(graph, null, 2), "utf8");
  return filePath;
}

async function loadDependencyGraph(workspaceRoot, { outputPath = null } = {}) {
  const filePath = resolveGraphPath(workspaceRoot, outputPath);
  const text = await fs.readFile(filePath, "utf8").catch(() => null);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export { loadDependencyGraph, resolveGraphPath, saveDependencyGraph };

