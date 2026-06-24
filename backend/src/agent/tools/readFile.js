import fs from "fs/promises";
import { resolveWorkspacePathSafe } from "../workspace.js";
const DEBUG = () => process.env.DEBUG_AGENT === "true" || process.env.WORKAI_AGENT_DEBUG === "true";

export async function readFileTool({ path, activeFiles = [], workspaceRoot }) {
  if (workspaceRoot) {
    try {
      const resolved = await resolveWorkspacePathSafe(workspaceRoot, path);
      const content = await fs.readFile(resolved.absolutePath, "utf8");
      if (DEBUG()) console.log("[READ_FILE]", { path: resolved.relativePath, length: content.length });
      return {
        success: true,
        file: resolved.relativePath,
        content
      };
    } catch (error) {
      if (DEBUG()) console.log("[READ_FILE][ERROR]", { path, error: error.message });
      return { success: false, error: error.message };
    }
  }

  const normalized = String(path || "").replace(/\\/g, "/").toLowerCase().trim();
  const found = activeFiles.find(file => {
    const filePath = String(file.path || file.name || "")
      .replace(/\\/g, "/")
      .toLowerCase();
    return filePath === normalized || filePath.endsWith(`/${normalized}`);
  });

  if (!found) {
    return { success: false, error: `Cannot find uploaded file: ${path}` };
  }

  return {
    success: true,
    file: found.path || found.name,
    content: found.content || found.chunks?.map(chunk => chunk.content).join("\n\n") || ""
  };
}
