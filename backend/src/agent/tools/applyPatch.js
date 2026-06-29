import fs from "fs/promises";
import { normalizeGeneratedModuleContent, resolveWorkspacePathSafe } from "../workspace.js";

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

export async function applyPatchTool({ file, find, replace, activeFiles = [], workspaceRoot, layout = null }) {
  // Validate arguments early to avoid EISDIR or cryptic errors
  if (!String(file || "").trim() || !String(find || "").trim() || !String(replace || "").trim()) {
    return { success: false, error: "INVALID_PATCH_ARGUMENTS", changed: false };
  }
  if (workspaceRoot) {
    try {
      const resolved = await resolveWorkspacePathSafe(workspaceRoot, file, { layout });
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
