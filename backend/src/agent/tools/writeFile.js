import fs from "fs/promises";
import pathModule from "path";
import { normalizeGeneratedModuleContent, resolveWorkspacePathSafe } from "../workspace.js";
const DEBUG = () => process.env.DEBUG_AGENT === "true" || process.env.WORKAI_AGENT_DEBUG === "true";

export async function writeFileTool({ path, content, activeFiles = [], workspaceRoot, layout = null, allowEmptyContent = false, overwriteEmpty = false, writeContext = null }) {
  const nextContent = String(content ?? "");
  const allowEmptyOverwrite = allowEmptyContent === true || overwriteEmpty === true;

  if (!allowEmptyOverwrite && !String(nextContent).trim()) {
    return {
      success: false,
      error: "WRITE_FILE requires non-empty content",
      changed: false,
      overwritten: false
    };
  }

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
      const resolved = await resolveWorkspacePathSafe(workspaceRoot, path, { allowMissing: true, layout });
      let previousContent = null;

      try {
        previousContent = await fs.readFile(resolved.absolutePath, "utf8");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }

      const normalizedWrite = await normalizeGeneratedModuleContent({
        workspaceRoot,
        targetPath: resolved.relativePath,
        content: nextContent,
        layout,
        workspaceFiles: activeFiles.map(file => String(file.path || file.name || "")),
        writeContext
      });

      if (!normalizedWrite.success) {
        return {
          success: false,
          error: normalizedWrite.error,
          changed: false,
          overwritten: false,
          moduleSystem: normalizedWrite.moduleSystem || "unknown"
        };
      }

      const finalContent = String(normalizedWrite.content ?? nextContent);

      if (previousContent === finalContent) {
        return {
          success: true,
          file: resolved.relativePath,
          changed: false,
          alreadyUpToDate: true,
          created: false,
          bytesWritten: 0,
          moduleSystem: normalizedWrite.moduleSystem || "unknown",
          transformed: normalizedWrite.transformed === true
        };
      }

      await fs.mkdir(pathModule.dirname(resolved.absolutePath), { recursive: true });
      await fs.writeFile(resolved.absolutePath, finalContent, "utf8");
      if (DEBUG()) console.log("[WRITE_FILE]", { path: resolved.relativePath, beforeLength: (previousContent || "").length, afterLength: finalContent.length, moduleSystem: normalizedWrite.moduleSystem || "unknown", transformed: normalizedWrite.transformed === true });

      return {
        success: true,
        file: resolved.relativePath,
        changed: true,
        created: previousContent === null,
        bytesWritten: Buffer.byteLength(finalContent),
        moduleSystem: normalizedWrite.moduleSystem || "unknown",
        transformed: normalizedWrite.transformed === true
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
