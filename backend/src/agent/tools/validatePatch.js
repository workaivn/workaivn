import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { resolveWorkspacePathSafe, runGit } from "../workspace.js";

const execFileAsync = promisify(execFile);

export async function validatePatchTool({ file, workspaceRoot }) {
  if (!workspaceRoot) {
    return {
      success: true,
      output: "Uploaded-file patch validation is limited to successful in-memory mutation."
    };
  }

  try {
    const resolved = await resolveWorkspacePathSafe(workspaceRoot, file);
    const checks = [];
    const diffCheck = await runGit(workspaceRoot, ["diff", "--check", "--", resolved.relativePath]);

    checks.push({
      name: "git diff --check",
      success: diffCheck.success,
      output: (diffCheck.stdout || diffCheck.stderr || diffCheck.error || "").trim()
    });

    if (path.extname(resolved.absolutePath) === ".js" && !resolved.absolutePath.endsWith(".jsx")) {
      try {
        const syntax = await execFileAsync(process.execPath, ["--check", resolved.absolutePath], {
          windowsHide: true
        });
        checks.push({
          name: "node --check",
          success: true,
          output: (syntax.stdout || syntax.stderr || "").trim()
        });
      } catch (error) {
        checks.push({
          name: "node --check",
          success: false,
          output: (error.stdout || error.stderr || error.message || "").trim()
        });
      }
    }

    const success = checks.every(check => check.success);
    return {
      success,
      file: resolved.relativePath,
      checks,
      output: checks.map(check => `${check.name}: ${check.success ? "passed" : "failed"}${check.output ? `\n${check.output}` : ""}`).join("\n")
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
