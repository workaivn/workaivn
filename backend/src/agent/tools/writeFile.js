import fs from "fs/promises";
import pathModule from "path";
import { resolveWorkspacePath } from "../workspace.js";

export async function writeFileTool({ path, content, activeFiles = [], workspaceRoot }) {
  const nextContent = String(content ?? "");

  if (workspaceRoot) {
    try {
      const resolved = resolveWorkspacePath(workspaceRoot, path);
      let previousContent = null;

      try {
        previousContent = await fs.readFile(resolved.absolutePath, "utf8");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }

      if (previousContent === nextContent) {
        return {
          success: false,
          error: "WRITE_FILE produced no content change",
          file: resolved.relativePath,
          changed: false
        };
      }

      await fs.mkdir(pathModule.dirname(resolved.absolutePath), { recursive: true });
      await fs.writeFile(resolved.absolutePath, nextContent, "utf8");

      return {
        success: true,
        file: resolved.relativePath,
        changed: true,
        created: previousContent === null,
        bytesWritten: Buffer.byteLength(nextContent)
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  const normalized = String(path || "").replace(/\\/g, "/").toLowerCase().trim();
  const found = activeFiles.find(file => {
    const filePath = String(file.path || file.name || "").replace(/\\/g, "/").toLowerCase();
    return filePath === normalized || filePath.endsWith(`/${normalized}`);
  });

  if (!found) {
    return { success: false, error: `Cannot find uploaded file: ${path}` };
  }

  if (String(found.content || "") === nextContent) {
    return { success: false, error: "WRITE_FILE produced no content change", changed: false };
  }

  found.content = nextContent;
  return { success: true, file: found.path || found.name, content: found.content, changed: true };
}
