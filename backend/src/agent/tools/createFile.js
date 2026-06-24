import fs from "fs/promises";
import pathModule from "path";
import { resolveWorkspacePathSafe } from "../workspace.js";

export async function createFileTool({ path, content = "", activeFiles = [], workspaceRoot }) {
  if (!String(path || "").trim()) {
    return { success: false, error: "CREATE_FILE requires path" };
  }
  if (workspaceRoot) {
    try {
      const resolved = await resolveWorkspacePathSafe(workspaceRoot, path, { allowMissing: true });
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
      return { success: false, error: error.message };
    }
  }
  // In-memory mode
  const normalized = String(path || "").replace(/\\/g, "/").toLowerCase().trim();
  const found = activeFiles.find(f => (f.path || f.name || "").replace(/\\/g, "/").toLowerCase() === normalized);
  if (found) return { success: false, error: "File already exists", file: found.path || found.name, changed: false };
  activeFiles.push({ path, content: String(content) });
  return { success: true, file: path, changed: true, created: true };
}
