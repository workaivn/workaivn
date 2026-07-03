import fs from "fs/promises";
import path from "path";
import { resolveWorkspacePathSafe, listWorkspaceFiles } from "../workspace.js";
import { assertExecutableUnit } from "../execution/ExecutionInputGuard.js";
const DEBUG = () => process.env.DEBUG_AGENT === "true" || process.env.WORKAI_AGENT_DEBUG === "true";

export async function readFileTool({ path, activeFiles = [], workspaceRoot, layout = null, executionUnit = null }) {
  if (!executionUnit) {
    return { success: false, error: "READ_TASK_BLOCKED_NON_EXECUTABLE" };
  }
  if (workspaceRoot) {
    try {
      assertExecutableUnit(executionUnit, { path, toolName: "READ_FILE" });
    } catch (error) {
      return { success: false, error: error.code === "NON_EXECUTABLE_PATH_REJECTED" ? "READ_TASK_BLOCKED_NON_EXECUTABLE" : error.code || error.message };
    }
  }
  if (workspaceRoot) {
    try {
      const resolved = await resolveWorkspacePathSafe(workspaceRoot, path, { layout, executionUnit, toolName: "READ_FILE" });
      const content = await fs.readFile(resolved.absolutePath, "utf8");
      if (DEBUG()) console.log("[READ_FILE]", { path: resolved.relativePath, length: content.length });
      return {
        success: true,
        file: resolved.relativePath,
        content
      };
    } catch (error) {
      // Attempt basename resolution on ENOENT
      if (error && error.code === "ENOENT") {
        try {
          const requestedPath = String(path || "");
          const base = pathModuleBasename(requestedPath);
          if (base) {
            const files = await listWorkspaceFiles(workspaceRoot, { limit: 5000 });
            const matches = files.filter(fp => fp.split("/").pop().toLowerCase() === base.toLowerCase());
            if (matches.length === 1) {
              const resolvedFile = matches[0];
              const resolved = await resolveWorkspacePathSafe(workspaceRoot, resolvedFile, { executionUnit, toolName: "READ_FILE" });
              const content = await fs.readFile(resolved.absolutePath, "utf8");
              if (DEBUG()) console.log("[READ_FILE][RESOLVED]", { from: requestedPath, to: resolvedFile, length: content.length });
              return {
                success: true,
                file: resolved.relativePath,
                content,
                resolved: true,
                requestedPath: requestedPath,
                resolvedPath: resolved.relativePath
              };
            }
            if (matches.length > 1) {
              if (DEBUG()) console.log("[READ_FILE][AMBIGUOUS]", { base, choices: matches.slice(0, 10) });
              return {
                success: false,
                error: `Ambiguous file: ${base} matches ${matches.length} files`,
                choices: matches
              };
            }
          }
        } catch (resolveErr) {
          if (DEBUG()) console.log("[READ_FILE][RESOLVE_ERROR]", { path, error: resolveErr.message });
        }
      }
      if (DEBUG()) console.log("[READ_FILE][ERROR]", { path, error: error.message });
      if (error?.code === "FILE_NOT_FOUND" || error?.code === "ENOENT" || error?.code === "CANONICAL_PATH_MISSING_REJECTED") {
        return { success: false, error: "FILE_NOT_FOUND" };
      }
      if (error?.code === "NON_CANONICAL_FILE_BLOCKED") {
        return { success: false, error: "READ_TASK_BLOCKED_NON_CANONICAL" };
      }
      if (error?.code === "WORKSPACE_ESCAPE_ATTEMPT") {
        return { success: false, error: "WORKSPACE_ESCAPE_ATTEMPT" };
      }
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

function pathModuleBasename(p) {
  try {
    return path.basename(String(p || "")).replace(/\\/g, "/");
  } catch {
    return "";
  }
}
