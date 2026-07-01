import fs from "node:fs/promises";
import path from "node:path";
import { UI_PLAN_FILE } from "./types.js";

function resolvePlanPath(workspaceRoot, outputPath = null) {
  return path.resolve(workspaceRoot, outputPath || UI_PLAN_FILE);
}

async function saveUIPlan(workspaceRoot, plan, { outputPath = null } = {}) {
  const filePath = resolvePlanPath(workspaceRoot, outputPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(plan, null, 2), "utf8");
  return filePath;
}

async function loadUIPlan(workspaceRoot, { outputPath = null } = {}) {
  const filePath = resolvePlanPath(workspaceRoot, outputPath);
  const text = await fs.readFile(filePath, "utf8").catch(() => null);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export { loadUIPlan, saveUIPlan };

