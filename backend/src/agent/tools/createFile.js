import fs from "fs/promises";
import pathModule from "path";
import { resolveWorkspacePathSafe } from "../workspace.js";
import { assertExecutableUnit } from "../execution/ExecutionInputGuard.js";

export async function createFileTool({ path, content = "", activeFiles = [], workspaceRoot, layout = null, executionUnit = null }) {
  if (!String(path || "").trim()) {
    return { success: false, error: "CREATE_FILE requires path" };
  }
  if (workspaceRoot) {
    try {
      assertExecutableUnit(executionUnit, { path, toolName: "CREATE_FILE" });
      const resolved = await resolveWorkspacePathSafe(workspaceRoot, path, { allowMissing: true, layout });
      try {
        const stat = await fs.stat(resolved.absolutePath);
        if (stat && stat.isFile()) {
          return { success: false, error: "File already exists", file: resolved.relativePath, changed: false };
        }
      } catch {}
      await fs.mkdir(pathModule.dirname(resolved.absolutePath), { recursive: true });
      await fs.writeFile(resolved.absolutePath, String(content), "utf8");
      return { success: true, file: resolved.relativePath, changed: true, created: true };
    } catch (error) {
      return {
        success: false,
        error: error.code === "NON_CANONICAL_FILE_BLOCKED"
          ? "CREATE_FILE_BLOCKED_NON_CANONICAL"
          : error.message
      };
    }
  }
  // In-memory mode
  const normalized = String(path || "").replace(/\\/g, "/").toLowerCase().trim();
  const found = activeFiles.find(f => (f.path || f.name || "").replace(/\\/g, "/").toLowerCase() === normalized);
  if (found) return { success: false, error: "File already exists", file: found.path || found.name, changed: false };
  activeFiles.push({ path, content: String(content) });
  return { success: true, file: path, changed: true, created: true };
}
