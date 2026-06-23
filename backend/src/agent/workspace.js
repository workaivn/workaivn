import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, "../..");
export const MANAGED_WORKSPACE_ROOT = path.resolve(BACKEND_ROOT, "..", "storage", "workspaces");

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
const SYSTEM_PATHS = [
  "c:\\windows",
  "c:\\program files",
  "c:\\program files (x86)",
  "c:\\programdata",
  "/etc",
  "/bin",
  "/sbin",
  "/usr",
  "/var",
  "/system",
  "/library"
];

function normalizeForComparison(value) {
  const normalized = path.resolve(String(value || "")).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isInsidePath(parent, child) {
  const normalizedParent = normalizeForComparison(parent);
  const normalizedChild = normalizeForComparison(child);
  return normalizedChild === normalizedParent ||
    normalizedChild.startsWith(`${normalizedParent}${path.sep}`);
}

function isBlockedFileName(name) {
  const normalized = String(name || "").toLowerCase();
  return BLOCKED_FILE_NAMES.has(normalized) || /^\.env(?:\.|$)/i.test(normalized);
}

export function getWorkspaceMode() {
  return String(process.env.WORKSPACE_MODE || "local").trim().toLowerCase() === "remote"
    ? "remote"
    : "local";
}

export function isRemoteWorkspaceMode() {
  return getWorkspaceMode() === "remote";
}

export async function ensureManagedWorkspaceRoot() {
  await fs.mkdir(MANAGED_WORKSPACE_ROOT, { recursive: true });
  return fs.realpath(MANAGED_WORKSPACE_ROOT);
}

export function getAllowedWorkspaceRoots() {
  const configured = String(
    process.env.WORKSPACE_ROOTS ||
    process.env.AGENT_WORKSPACE_ROOT ||
    ""
  );
  const developmentFallback = process.env.NODE_ENV !== "production"
    ? path.resolve(BACKEND_ROOT, "../..")
    : "";

  return (configured || developmentFallback)
    .split(/[;\r\n]+/)
    .map(root => root.trim())
    .filter(Boolean)
    .map(root => path.resolve(root));
}

export function getWorkspaceRoot(requestedRoot = "") {
  if (!requestedRoot) {
    throw new Error("Workspace root is required");
  }
  return path.resolve(requestedRoot);
}

export function assertWorkspaceRootAllowed(rootPath, { allowManaged = true } = {}) {
  const resolved = path.resolve(String(rootPath || ""));
  const comparable = normalizeForComparison(resolved);

  if (SYSTEM_PATHS.some(systemPath => {
    const normalizedSystem = process.platform === "win32"
      ? systemPath.toLowerCase()
      : systemPath;
    return comparable === normalizedSystem ||
      comparable.startsWith(`${normalizedSystem}${path.sep}`);
  })) {
    throw new Error("System folders cannot be used as project workspaces");
  }

  const allowedRoots = getAllowedWorkspaceRoots();
  const allowed = allowedRoots.some(root => isInsidePath(root, resolved));
  const managed = allowManaged && isInsidePath(MANAGED_WORKSPACE_ROOT, resolved);

  if (isRemoteWorkspaceMode() && !managed) {
    throw new Error("Remote mode only allows managed workspaces created from ZIP or Git.");
  }

  if (!allowed && !managed) {
    throw new Error(
      "Workspace path is outside WORKSPACE_ROOTS. Configure an allowed parent folder first."
    );
  }

  return resolved;
}

export async function validateWorkspaceRoot(rootPath, options = {}) {
  const resolved = assertWorkspaceRootAllowed(rootPath, options);
  const stats = await fs.stat(resolved).catch(() => null);

  if (!stats?.isDirectory()) {
    throw new Error("Workspace root does not exist or is not a directory");
  }

  return fs.realpath(resolved);
}

function assertRelativePathAllowed(relativePath) {
  const normalizedInput = String(relativePath ?? ".").replace(/\\/g, "/").trim() || ".";

  if (path.isAbsolute(normalizedInput) || /^[A-Za-z]:\//.test(normalizedInput)) {
    throw new Error("File path must be relative to the selected workspace");
  }

  const normalized = path.posix.normalize(normalizedInput);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Path escapes selected workspace: ${relativePath}`);
  }

  const segments = normalized.split("/").filter(Boolean);
  if (
    segments.some(segment => IGNORED_DIRECTORIES.has(segment.toLowerCase())) ||
    segments.some(segment => isBlockedFileName(segment))
  ) {
    throw new Error(`Path is not available to the agent: ${relativePath}`);
  }

  return normalized;
}

export function resolveWorkspacePath(workspaceRoot, requestedPath = ".") {
  const root = getWorkspaceRoot(workspaceRoot);
  const normalized = assertRelativePathAllowed(requestedPath);
  const absolutePath = path.resolve(root, normalized);

  if (!isInsidePath(root, absolutePath)) {
    throw new Error(`Path escapes selected workspace: ${requestedPath}`);
  }

  return {
    root,
    absolutePath,
    relativePath: path.relative(root, absolutePath).replace(/\\/g, "/") || "."
  };
}

export async function resolveWorkspacePathSafe(
  workspaceRoot,
  requestedPath = ".",
  { allowMissing = false } = {}
) {
  const resolved = resolveWorkspacePath(workspaceRoot, requestedPath);
  const realRoot = await fs.realpath(resolved.root);
  let realTarget;

  try {
    realTarget = await fs.realpath(resolved.absolutePath);
  } catch (error) {
    if (!allowMissing || error.code !== "ENOENT") throw error;
    const realParent = await fs.realpath(path.dirname(resolved.absolutePath));
    realTarget = path.join(realParent, path.basename(resolved.absolutePath));
  }

  if (!isInsidePath(realRoot, realTarget)) {
    throw new Error(`Resolved path escapes selected workspace: ${requestedPath}`);
  }

  return {
    root: realRoot,
    absolutePath: realTarget,
    relativePath: path.relative(realRoot, realTarget).replace(/\\/g, "/") || "."
  };
}

export async function listWorkspaceFiles(workspaceRoot, { limit = 500 } = {}) {
  const root = await fs.realpath(getWorkspaceRoot(workspaceRoot));
  const files = [];

  async function walk(directory) {
    if (files.length >= limit) return;
    const entries = await fs.readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      if (files.length >= limit) break;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) continue;
      if (entry.isFile() && isBlockedFileName(entry.name)) continue;

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

export async function buildWorkspaceTree(workspaceRoot, { limit = 2000 } = {}) {
  const files = await listWorkspaceFiles(workspaceRoot, { limit });
  const root = [];

  for (const filePath of files) {
    const parts = filePath.split("/");
    let level = root;
    let currentPath = "";

    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = index === parts.length - 1;
      let node = level.find(item => item.name === part && item.type === (isFile ? "file" : "folder"));

      if (!node) {
        node = {
          name: part,
          path: currentPath,
          type: isFile ? "file" : "folder",
          ...(isFile ? {} : { children: [] })
        };
        level.push(node);
      }

      if (!isFile) level = node.children;
    });
  }

  function sortNodes(nodes) {
    nodes.sort((left, right) => {
      if (left.type !== right.type) return left.type === "folder" ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
    nodes.forEach(node => {
      if (node.children) sortNodes(node.children);
    });
  }

  sortNodes(root);
  return { tree: root, truncated: files.length >= limit, fileCount: files.length };
}

export async function runGit(workspaceRoot, args) {
  const root = getWorkspaceRoot(workspaceRoot);

  try {
    const result = await execFileAsync("git", ["-C", root, ...args], {
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    });
    return { success: true, stdout: result.stdout || "", stderr: result.stderr || "" };
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
  const status = await runGit(workspaceRoot, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all"
  ]);
  const changedFiles = status.success
    ? status.stdout.split(/\r?\n/).filter(Boolean).map(line => line.slice(3).trim())
    : [];

  return { isGitRepository: status.success, status: status.stdout, changedFiles };
}

export async function getDiffSummary(workspaceRoot, changedFiles = []) {
  const stat = await runGit(workspaceRoot, ["diff", "--stat", "--", ...changedFiles]);
  const numstat = await runGit(workspaceRoot, ["diff", "--numstat", "--", ...changedFiles]);
  const status = await runGit(workspaceRoot, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    ...changedFiles
  ]);
  const untrackedFiles = status.success
    ? status.stdout.split(/\r?\n/).filter(line => line.startsWith("?? ")).map(line => line.slice(3).trim())
    : [];

  return {
    stat: [
      stat.success ? stat.stdout.trim() : "",
      ...untrackedFiles.map(file => `${file} | new file`)
    ].filter(Boolean).join("\n"),
    numstat: numstat.success ? numstat.stdout.trim() : "",
    untrackedFiles,
    error: stat.success ? null : stat.error
  };
}
