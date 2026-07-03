import fs from "fs/promises";
import path from "node:path";
import { normalizeGeneratedModuleContent, resolveWorkspacePathSafe } from "../workspace.js";
import { assertExecutableUnit } from "../execution/ExecutionInputGuard.js";

function applyExactPatch(original, find, replace) {
  const needle = String(find ?? "");
  if (!needle) {
    return { success: false, error: "Patch find text is required" };
  }

  const firstIndex = original.indexOf(needle);
  if (firstIndex === -1) {
    return { success: false, error: "Patch find text was not found" };
  }

  if (original.indexOf(needle, firstIndex + needle.length) !== -1) {
    return { success: false, error: "Patch find text is ambiguous; provide a unique block" };
  }

  const updated = `${original.slice(0, firstIndex)}${String(replace ?? "")}${original.slice(firstIndex + needle.length)}`;
  if (updated === original) {
    return { success: false, error: "Patch produced no content change" };
  }

  return { success: true, updated };
}

export async function applyPatchTool({ file, find, replace, activeFiles = [], workspaceRoot, layout = null, executionUnit = null }) {
  if (!String(file || "").trim()) {
    return { success: false, error: "INVALID_PATCH_ARGUMENTS", changed: false };
  }
  if (!executionUnit) {
    return { success: false, error: "WRITE_WITHOUT_EXECUTION_UNIT", changed: false };
  }
  if (workspaceRoot) {
    try {
      assertExecutableUnit(executionUnit, { path: file, toolName: "APPLY_PATCH" });
      const resolved = await resolveWorkspacePathSafe(workspaceRoot, file, { allowMissing: true, layout, executionUnit, toolName: "APPLY_PATCH" });
      const exists = await fs.stat(resolved.absolutePath).then(stat => stat?.isFile() === true).catch(() => false);
      if (!exists) {
        console.log("[PATCH_CONVERTED_TO_WRITE]", {
          path: resolved.relativePath,
          reason: "file does not exist, using WRITE_FILE semantics"
        });
        const nextContent = String(replace ?? "");
        const normalizedWrite = await normalizeGeneratedModuleContent({
          workspaceRoot,
          targetPath: resolved.relativePath,
          content: nextContent,
          layout,
          workspaceFiles: activeFiles.map(item => String(item.path || item.name || ""))
        });
        if (!normalizedWrite.success) {
          return {
            success: false,
            error: normalizedWrite.error,
            file: resolved.relativePath,
            changed: false,
            moduleSystem: normalizedWrite.moduleSystem || "unknown"
          };
        }
        await fs.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
        await fs.writeFile(resolved.absolutePath, String(normalizedWrite.content ?? nextContent), "utf8");
        return {
          success: true,
          file: resolved.relativePath,
          changed: true,
          created: true,
          convertedToWrite: true,
          moduleSystem: normalizedWrite.moduleSystem || "unknown",
          transformed: normalizedWrite.transformed === true
        };
      }

      if (!String(find || "").trim() || !String(replace || "").trim()) {
        return { success: false, error: "INVALID_PATCH_ARGUMENTS", changed: false };
      }

      const original = await fs.readFile(resolved.absolutePath, "utf8");
      const patch = applyExactPatch(original, find, replace);
      if (!patch.success) return { ...patch, file: resolved.relativePath, changed: false };

      const normalizedWrite = await normalizeGeneratedModuleContent({
        workspaceRoot,
        targetPath: resolved.relativePath,
        content: patch.updated,
        layout,
        workspaceFiles: activeFiles.map(item => String(item.path || item.name || ""))
      });

      if (!normalizedWrite.success) {
        return {
          success: false,
          error: normalizedWrite.error,
          file: resolved.relativePath,
          changed: false,
          moduleSystem: normalizedWrite.moduleSystem || "unknown"
        };
      }

      const finalContent = String(normalizedWrite.content ?? patch.updated);
      await fs.writeFile(resolved.absolutePath, finalContent, "utf8");
      return {
        success: true,
        file: resolved.relativePath,
        changed: true,
        replacements: 1,
        moduleSystem: normalizedWrite.moduleSystem || "unknown",
        transformed: normalizedWrite.transformed === true
      };
    } catch (error) {
      if (error.code === "NON_EXECUTABLE_PATH_REJECTED") {
        return { success: false, error: "WRITE_WITHOUT_EXECUTION_UNIT" };
      }
      if (error.code === "NON_CANONICAL_FILE_BLOCKED") {
        return { success: false, error: "PATCH_TARGET_BLOCKED_NON_CANONICAL" };
      }
      if (error.code === "FILE_NOT_FOUND" || error.code === "ENOENT" || error.code === "CANONICAL_PATH_MISSING_REJECTED") {
        return { success: false, error: "PATCH_TARGET_MISSING", changed: false };
      }
      if (error.code === "WORKSPACE_ESCAPE_ATTEMPT") {
        return { success: false, error: "WORKSPACE_ESCAPE_ATTEMPT", changed: false };
      }
      return { success: false, error: error.message };
    }
  }

  const normalized = String(file || "").replace(/\\/g, "/").toLowerCase().trim();
  const found = activeFiles.find(item => {
    const filePath = String(item.path || item.name || "").replace(/\\/g, "/").toLowerCase();
    return filePath === normalized || filePath.endsWith(`/${normalized}`);
  });

  if (!found) {
    return { success: false, error: `Cannot find uploaded file: ${file}` };
  }

  const patch = applyExactPatch(String(found.content || ""), find, replace);
  if (!patch.success) return { ...patch, file: found.path || found.name, changed: false };

  found.content = patch.updated;
  return { success: true, file: found.path || found.name, updated: patch.updated, changed: true };
}
