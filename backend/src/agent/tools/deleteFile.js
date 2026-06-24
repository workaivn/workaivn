import fs from "fs/promises";
import { resolveWorkspacePathSafe } from "../workspace.js";

export async function deleteFileTool({ path, activeFiles = [], workspaceRoot }) {
  if (!String(path || "").trim()) return { success: false, error: "DELETE_FILE requires path" };
  if (workspaceRoot) {
    try {
      const resolved = await resolveWorkspacePathSafe(workspaceRoot, path);
      await fs.unlink(resolved.absolutePath);
      return { success: true, file: resolved.relativePath, changed: true, deleted: true };
    } catch (error) {
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
