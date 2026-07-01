import fs from "node:fs/promises";
import path from "node:path";
import { EXECUTION_PLAN_FILE } from "./types.js";

export function resolveExecutionPlanPath(workspaceId = ".", outputPath = null) {
  return path.resolve(String(workspaceId || "."), outputPath || EXECUTION_PLAN_FILE);
}

export async function serializeExecutionPlan(plan = {}, { workspaceId = ".", outputPath = null } = {}) {
  const filePath = resolveExecutionPlanPath(workspaceId, outputPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(plan, null, 2), "utf8");
  return filePath;
}

export async function loadExecutionPlan(workspaceId = ".", { outputPath = null } = {}) {
  const filePath = resolveExecutionPlanPath(workspaceId, outputPath);
  const text = await fs.readFile(filePath, "utf8").catch(() => null);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
