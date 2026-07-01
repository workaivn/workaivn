import fs from "node:fs/promises";
import path from "node:path";
import { FEATURE_BLUEPRINT_FILE } from "./types.js";

function resolveBlueprintPath(workspaceId, outputPath = null) {
  return path.resolve(String(workspaceId || "."), outputPath || FEATURE_BLUEPRINT_FILE);
}

export async function serializeBlueprint(blueprint = {}, { workspaceId = ".", outputPath = null } = {}) {
  const filePath = resolveBlueprintPath(workspaceId, outputPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(blueprint, null, 2), "utf8");
  return filePath;
}

export async function loadBlueprint(workspaceId = ".", { outputPath = null } = {}) {
  const filePath = resolveBlueprintPath(workspaceId, outputPath);
  const text = await fs.readFile(filePath, "utf8").catch(() => null);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

