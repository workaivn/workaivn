import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_WORKSPACE_ROOT = path.resolve(__dirname, "../../..");
const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "uploads",
  "generated",
  "dist",
  "build",
  "coverage"
]);
const BLOCKED_FILE_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  "id_rsa",
  "id_ed25519"
]);

export function getWorkspaceRoot(requestedRoot = "") {
  return path.resolve(
    requestedRoot ||
    process.env.AGENT_WORKSPACE_ROOT ||
    DEFAULT_WORKSPACE_ROOT
  );
}

export function resolveWorkspacePath(workspaceRoot, requestedPath = ".") {
  const root = getWorkspaceRoot(workspaceRoot);
  const resolved = path.resolve(root, String(requestedPath || "."));
  const relative = path.relative(root, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes agent workspace: ${requestedPath}`);
  }

  const segments = relative.split(path.sep).filter(Boolean);
  if (
    segments.some(segment => IGNORED_DIRECTORIES.has(segment)) ||
    segments.some(segment => BLOCKED_FILE_NAMES.has(segment.toLowerCase()))
  ) {
    throw new Error(`Path is not available to the agent: ${requestedPath}`);
  }

  return {
    root,
    absolutePath: resolved,
    relativePath: relative.replace(/\\/g, "/") || "."
  };
}

export async function listWorkspaceFiles(workspaceRoot, { limit = 500 } = {}) {
  const root = getWorkspaceRoot(workspaceRoot);
  const files = [];

  async function walk(directory) {
    if (files.length >= limit) return;

    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= limit) break;
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
      if (entry.isFile() && BLOCKED_FILE_NAMES.has(entry.name.toLowerCase())) continue;

      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        files.push(path.relative(root, absolutePath).replace(/\\/g, "/"));
      }
    }
  }

  await walk(root);
  return files;
}

export async function runGit(workspaceRoot, args) {
  const root = getWorkspaceRoot(workspaceRoot);

  try {
    const result = await execFileAsync("git", ["-C", root, ...args], {
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    });

    return {
      success: true,
      stdout: result.stdout || "",
      stderr: result.stderr || ""
    };
  } catch (error) {
    return {
      success: false,
      stdout: error.stdout || "",
      stderr: error.stderr || "",
      error: error.message
    };
  }
}

export async function getGitSnapshot(workspaceRoot) {
  const status = await runGit(workspaceRoot, ["status", "--porcelain=v1"]);
  const changedFiles = status.success
    ? status.stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .map(line => line.slice(3).trim())
    : [];

  return {
    isGitRepository: status.success,
    status: status.stdout,
    changedFiles
  };
}

export async function getDiffSummary(workspaceRoot, changedFiles = []) {
  const stat = await runGit(workspaceRoot, ["diff", "--stat", "--", ...changedFiles]);
  const numstat = await runGit(workspaceRoot, ["diff", "--numstat", "--", ...changedFiles]);
  const status = await runGit(workspaceRoot, ["status", "--porcelain=v1", "--", ...changedFiles]);
  const untrackedFiles = status.success
    ? status.stdout
        .split(/\r?\n/)
        .filter(line => line.startsWith("?? "))
        .map(line => line.slice(3).trim())
    : [];
  const untrackedSummary = untrackedFiles
    .map(file => `${file} | new file`)
    .join("\n");

  return {
    stat: [
      stat.success ? stat.stdout.trim() : "",
      untrackedSummary
    ].filter(Boolean).join("\n"),
    numstat: numstat.success ? numstat.stdout.trim() : "",
    untrackedFiles,
    error: stat.success ? null : stat.error
  };
}
