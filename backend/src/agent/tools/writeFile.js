import fs from "fs/promises";
import pathModule from "path";
import { resolveWorkspacePath, resolveWorkspacePathSafe } from "../workspace.js";
const DEBUG = () => process.env.DEBUG_AGENT === "true" || process.env.WORKAI_AGENT_DEBUG === "true";

export async function writeFileTool({ path, content, activeFiles = [], workspaceRoot }) {
  const nextContent = String(content ?? "");

  if (workspaceRoot) {
    try {
      // Guard: prevent duplicate workai:test script keys in package.json candidate
      if (String(path || "").replace(/\\/g, "/").toLowerCase().endsWith("package.json")) {
        // Naive detect duplicates of the specific key inside scripts block
        const text = nextContent;
        // Try to find scripts block boundaries
        const scriptsKey = /"scripts"\s*:\s*\{/g;
        let dupDetected = false;
        const occurrences = (text.match(/"workai:test"\s*:/g) || []).length;
        if (occurrences > 1) {
          // Narrow check: ensure they are within scripts by looking for scripts key
          dupDetected = scriptsKey.test(text);
        }
        if (dupDetected) {
          return { success: false, error: "package.json scripts contains duplicate key workai:test", changed: false };
        }
      }
      const candidate = resolveWorkspacePath(workspaceRoot, path);
      await fs.mkdir(pathModule.dirname(candidate.absolutePath), { recursive: true });
      const resolved = await resolveWorkspacePathSafe(workspaceRoot, path, { allowMissing: true });
      let previousContent = null;

      try {
        previousContent = await fs.readFile(resolved.absolutePath, "utf8");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }

      if (previousContent === nextContent) {
        // Idempotent success: already up to date
        return {
          success: true,
          file: resolved.relativePath,
          changed: false,
          alreadyUpToDate: true,
          created: false,
          bytesWritten: Buffer.byteLength(nextContent)
        };
      }

      await fs.mkdir(pathModule.dirname(resolved.absolutePath), { recursive: true });
      await fs.writeFile(resolved.absolutePath, nextContent, "utf8");
      if (DEBUG()) console.log("[WRITE_FILE]", { path: resolved.relativePath, beforeLength: (previousContent || "").length, afterLength: nextContent.length });

      return {
        success: true,
        file: resolved.relativePath,
        changed: true,
        created: previousContent === null,
        bytesWritten: Buffer.byteLength(nextContent)
      };
    } catch (error) {
      if (DEBUG()) console.log("[WRITE_FILE][ERROR]", { path, error: error.message });
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
    return { success: true, file: found.path || found.name, content: found.content, changed: false, alreadyUpToDate: true };
  }

  found.content = nextContent;
  return { success: true, file: found.path || found.name, content: found.content, changed: true };
}
