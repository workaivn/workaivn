import path from "path";
import { listWorkspaceFiles } from "../workspace.js";

export async function listFilesTool({ activeFiles = [], workspaceRoot, limit = 500 }) {
  if (workspaceRoot) {
    try {
      const files = await listWorkspaceFiles(workspaceRoot, { limit });
      return {
        success: true,
        files: files.map(file => ({
          name: path.basename(file),
          path: file,
          type: path.extname(file)
        })),
        truncated: files.length >= limit
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  return {
    success: true,
    files: activeFiles.map(file => ({
      name: file.name,
      path: file.path,
      type: file.type
    }))
  };
}
