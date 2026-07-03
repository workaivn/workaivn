import fs from "fs/promises";
import { resolveWorkspacePathSafe } from "../workspace.js";
import { assertExecutableUnit } from "../execution/ExecutionInputGuard.js";

export async function deleteFileTool({ path, activeFiles = [], workspaceRoot, layout = null, executionUnit = null }) {
  if (!String(path || "").trim()) return { success: false, error: "DELETE_FILE requires path" };
  if (workspaceRoot) {
    try {
      assertExecutableUnit(executionUnit, { path, toolName: "DELETE_FILE" });
      const resolved = await resolveWorkspacePathSafe(workspaceRoot, path, { layout });
      await fs.unlink(resolved.absolutePath);
      return { success: true, file: resolved.relativePath, changed: true, deleted: true };
    } catch (error) {
      if (error?.code === "FILE_NOT_FOUND" || error?.code === "ENOENT" || error?.code === "CANONICAL_PATH_MISSING_REJECTED") {
        return { success: false, error: "FILE_NOT_FOUND" };
      }
      if (error?.code === "NON_CANONICAL_FILE_BLOCKED") {
        return { success: false, error: "DELETE_FILE_BLOCKED_NON_CANONICAL" };
      }
      if (error?.code === "WORKSPACE_ESCAPE_ATTEMPT") {
        return { success: false, error: "WORKSPACE_ESCAPE_ATTEMPT" };
      }
      return { success: false, error: error.message };
    }
  }
  const idx = activeFiles.findIndex(f => (f.path || f.name) === path);
  if (idx !== -1) {
    activeFiles.splice(idx, 1);
    return { success: true, file: path, changed: true, deleted: true };
  }
  return { success: false, error: `Cannot find uploaded file: ${path}` };
}
