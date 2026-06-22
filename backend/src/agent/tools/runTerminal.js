import { exec } from "child_process";
import { getWorkspaceRoot } from "../workspace.js";

export function runTerminalTool({ command, workspaceRoot }) {
  return new Promise(resolve => {
    const normalizedCommand = String(command || "").trim();
    const blocked = [
      /\.\.[\\/]/,
      /\b(?:rm|rmdir|del|erase|remove-item)\b/i,
      /\b(?:curl|wget|invoke-webrequest)\b/i,
      /\b(?:shutdown|restart-computer|stop-computer)\b/i
    ];

    if (!normalizedCommand || blocked.some(pattern => pattern.test(normalizedCommand))) {
      resolve({
        success: false,
        stdout: "",
        stderr: "",
        exitCode: null,
        error: "Terminal command was blocked by the Coding Agent safety policy"
      });
      return;
    }

    exec(
      normalizedCommand,
      {
        cwd: getWorkspaceRoot(workspaceRoot),
        timeout: 60000,
        windowsHide: true,
        maxBuffer: 5 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        resolve({
          success: !error,
          stdout: stdout || "",
          stderr: stderr || "",
          exitCode: error?.code ?? 0,
          error: error?.message || null
        });
      }
    );
  });
}
