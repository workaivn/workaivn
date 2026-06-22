import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import AdmZip from "adm-zip";
import Workspace from "../../models/Workspace.js";
import {
  MANAGED_WORKSPACE_ROOT,
  assertWorkspaceRootAllowed,
  ensureManagedWorkspaceRoot,
  getWorkspaceMode,
  isRemoteWorkspaceMode,
  validateWorkspaceRoot
} from "../../agent/workspace.js";

const execFileAsync = promisify(execFile);
const BLOCKED_SEGMENTS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "storage",
  "uploads"
]);
const SECRET_FILE_PATTERNS = [
  /^\.env(?:\.|$)/i,
  /(?:^|\/)id_(?:rsa|ed25519)$/i,
  /\.(?:pem|key|p12|pfx)$/i
];

function isSecretOrBlockedEntry(entryName) {
  const normalized = entryName.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments.some(segment => BLOCKED_SEGMENTS.has(segment.toLowerCase())) ||
    SECRET_FILE_PATTERNS.some(pattern => pattern.test(normalized));
}

function validateArchiveEntry(entryName) {
  const normalized = path.posix.normalize(String(entryName || "").replace(/\\/g, "/"));
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    path.posix.isAbsolute(normalized) ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    throw new Error(`Unsafe ZIP entry: ${entryName}`);
  }
  if (isSecretOrBlockedEntry(normalized)) {
    throw new Error(`ZIP contains blocked or sensitive path: ${entryName}`);
  }
  return normalized;
}

async function detectProjectRoot(containerRoot) {
  let currentRoot = containerRoot;

  for (let depth = 0; depth < 3; depth += 1) {
    const entries = await fs.readdir(currentRoot, { withFileTypes: true });
    const visible = entries.filter(entry =>
      entry.name !== "__MACOSX" &&
      entry.name !== ".DS_Store"
    );
    const directories = visible.filter(entry => entry.isDirectory());
    const files = visible.filter(entry => entry.isFile());

    if (files.length === 0 && directories.length === 1) {
      currentRoot = path.join(currentRoot, directories[0].name);
      continue;
    }
    break;
  }

  return fs.realpath(currentRoot);
}

function validateGitRepoUrl(repoUrl) {
  let parsed;
  try {
    parsed = new URL(String(repoUrl || ""));
  } catch {
    throw new Error("Invalid Git repository URL");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Only public HTTPS Git repository URLs are supported");
  }
  if (!["github.com", "gitlab.com", "bitbucket.org"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("Only GitHub, GitLab, and Bitbucket public repositories are supported");
  }
  if (parsed.username || parsed.password || !/\.git$/i.test(parsed.pathname)) {
    throw new Error("Repository URL must be a public HTTPS .git URL without credentials");
  }

  return parsed.toString();
}

export function getWorkspaceCapabilities() {
  const mode = getWorkspaceMode();
  return {
    mode,
    allowLocalPath: mode !== "remote",
    allowZipUpload: true,
    allowGitClone: true,
    message: mode === "remote"
      ? "Backend is running remotely. Upload a ZIP or clone a Git repository to create a workspace."
      : "Select a local project path, upload a ZIP, or clone a Git repository."
  };
}

export async function getWorkspaceByPublicId(workspaceId) {
  const query = { id: workspaceId };
  if (/^[a-f\d]{24}$/i.test(String(workspaceId || ""))) {
    query.$or = [{ id: workspaceId }, { _id: workspaceId }];
    delete query.id;
  }
  const workspace = await Workspace.findOne(query);

  if (!workspace) throw new Error("Workspace not found");
  if (workspace.status !== "ready") {
    throw new Error(`Workspace is not ready: ${workspace.status}`);
  }
  if (isRemoteWorkspaceMode() && workspace.sourceType === "local") {
    throw new Error("Remote mode cannot access local disk workspaces");
  }

  await validateWorkspaceRoot(workspace.rootPath, {
    allowManaged: workspace.sourceType !== "local"
  });
  return workspace;
}

export async function createLocalWorkspace({ name, rootPath }) {
  if (isRemoteWorkspaceMode()) {
    throw new Error(
      "Backend is running remotely. Upload a ZIP or clone a Git repository to create a workspace."
    );
  }
  if (/^[A-Za-z]:[\\/]/.test(String(rootPath || "")) && process.platform !== "win32") {
    throw new Error("Windows local paths are not available on this backend");
  }

  const allowedPath = assertWorkspaceRootAllowed(rootPath, { allowManaged: false });
  const realRoot = await validateWorkspaceRoot(allowedPath, { allowManaged: false });

  return Workspace.create({
    name: String(name || path.basename(realRoot)).trim(),
    rootPath: realRoot,
    sourceType: "local",
    status: "ready"
  });
}

export async function createZipWorkspace({ name, zipBuffer, originalName = "" }) {
  if (!zipBuffer?.length) throw new Error("ZIP file is required");
  if (originalName && !/\.zip$/i.test(originalName)) {
    throw new Error("Only .zip project uploads are supported");
  }

  await ensureManagedWorkspaceRoot();
  const workspace = new Workspace({
    name: String(name || originalName.replace(/\.zip$/i, "") || "Uploaded project").trim(),
    rootPath: path.join(MANAGED_WORKSPACE_ROOT, "pending"),
    sourceType: "zip",
    status: "creating"
  });
  const containerRoot = path.join(MANAGED_WORKSPACE_ROOT, workspace.id);
  workspace.rootPath = containerRoot;
  await fs.mkdir(containerRoot, { recursive: true });

  try {
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();
    if (!entries.length) throw new Error("ZIP archive is empty");

    for (const entry of entries) {
      const normalized = validateArchiveEntry(entry.entryName);
      const target = path.join(containerRoot, ...normalized.split("/"));

      if (entry.isDirectory) {
        await fs.mkdir(target, { recursive: true });
      } else {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, entry.getData());
      }
    }

    workspace.rootPath = await detectProjectRoot(containerRoot);
    workspace.status = "ready";
    await workspace.save();
    return workspace;
  } catch (error) {
    await fs.rm(containerRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function createGitWorkspace({ repoUrl, branch = "main" }) {
  const normalizedUrl = validateGitRepoUrl(repoUrl);
  const normalizedBranch = String(branch || "main").trim();
  if (!/^[A-Za-z0-9._/-]+$/.test(normalizedBranch) || normalizedBranch.includes("..")) {
    throw new Error("Invalid Git branch name");
  }

  await ensureManagedWorkspaceRoot();
  const repoName = path.basename(new URL(normalizedUrl).pathname, ".git");
  const workspace = new Workspace({
    name: repoName,
    rootPath: path.join(MANAGED_WORKSPACE_ROOT, "pending"),
    sourceType: "git",
    status: "creating",
    repository: { repoUrl: normalizedUrl, branch: normalizedBranch }
  });
  const targetRoot = path.join(MANAGED_WORKSPACE_ROOT, workspace.id);
  workspace.rootPath = targetRoot;
  await workspace.save();

  try {
    await execFileAsync(
      "git",
      ["clone", "--depth", "1", "--branch", normalizedBranch, "--", normalizedUrl, targetRoot],
      {
        windowsHide: true,
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024
      }
    );
    workspace.status = "ready";
    await workspace.save();
    return workspace;
  } catch (error) {
    workspace.status = "error";
    await workspace.save().catch(() => {});
    await fs.rm(targetRoot, { recursive: true, force: true });
    throw new Error(error.stderr || error.message || "Git clone failed");
  }
}

