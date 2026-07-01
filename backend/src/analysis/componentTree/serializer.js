import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_COMPONENT_TREE_FILE } from "./types.js";

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function getComponentTreePath(workspaceRoot, outputPath = null) {
  if (outputPath) return path.resolve(workspaceRoot, outputPath);
  return path.resolve(workspaceRoot, DEFAULT_COMPONENT_TREE_FILE);
}

async function saveComponentTree(workspaceRoot, tree, { outputPath = null } = {}) {
  const target = getComponentTreePath(workspaceRoot, outputPath);
  await ensureDir(target);
  await fs.writeFile(target, JSON.stringify(tree, null, 2), "utf8");
  return target;
}

async function loadComponentTree(workspaceRoot, { outputPath = null } = {}) {
  const target = getComponentTreePath(workspaceRoot, outputPath);
  const text = await fs.readFile(target, "utf8").catch(() => null);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export { getComponentTreePath, loadComponentTree, saveComponentTree };

