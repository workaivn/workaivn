import fs from "fs/promises";
import path from "path";
import archiver from "archiver";
import Workspace from "../../models/Workspace.js";
import { executeTool } from "../../agent/toolExecutor.js";
import {
  buildWorkspaceTree,
  resolveWorkspacePathSafe
} from "../../agent/workspace.js";
import {
  createLocalWorkspace,
  createZipWorkspace,
  getWorkspaceByPublicId
} from "./workspace.service.js";

function publicWorkspace(workspace) {
  return {
    id: workspace.id,
    _id: workspace._id,
    name: workspace.name,
    rootPath: workspace.rootPath,
    sourceType: workspace.sourceType,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt
  };
}

function workspaceError(res, error, fallback = "Workspace operation failed") {
  const status = error.message === "Workspace not found" ? 404 : 400;
  return res.status(status).json({
    success: false,
    message: error.message || fallback
  });
}

export async function listWorkspaces(_req, res) {
  const workspaces = await Workspace.find().sort({ updatedAt: -1 });
  return res.json({ success: true, data: workspaces.map(publicWorkspace) });
}

export async function createWorkspace(req, res) {
  try {
    const { name, rootPath } = req.body;
    if (!rootPath) return res.status(400).json({ success: false, message: "rootPath is required" });
    const workspace = await createLocalWorkspace({ name, rootPath });
    return res.status(201).json({ success: true, data: publicWorkspace(workspace) });
  } catch (error) {
    return workspaceError(res, error);
  }
}

export async function uploadZipWorkspace(req, res) {
  try {
    const workspace = await createZipWorkspace({
      name: req.body.name || req.file?.originalname?.replace(/\.zip$/i, ""),
      zipBuffer: req.file?.buffer
    });
    return res.status(201).json({ success: true, data: publicWorkspace(workspace) });
  } catch (error) {
    return workspaceError(res, error, "Failed to import ZIP workspace");
  }
}

export async function getWorkspaceTree(req, res) {
  try {
    const workspace = await getWorkspaceByPublicId(req.params.id);
    const data = await buildWorkspaceTree(workspace.rootPath);
    return res.json({ success: true, data });
  } catch (error) {
    return workspaceError(res, error);
  }
}

export async function getWorkspaceFile(req, res) {
  try {
    const workspace = await getWorkspaceByPublicId(req.params.id);
    const resolved = await resolveWorkspacePathSafe(workspace.rootPath, req.query.path);
    const stats = await fs.stat(resolved.absolutePath);
    if (!stats.isFile()) throw new Error("Requested path is not a file");
    if (stats.size > 2 * 1024 * 1024) throw new Error("File is too large to preview");
    const content = await fs.readFile(resolved.absolutePath, "utf8");
    return res.json({
      success: true,
      data: { path: resolved.relativePath, content, size: stats.size }
    });
  } catch (error) {
    return workspaceError(res, error);
  }
}

export async function putWorkspaceFile(req, res) {
  try {
    const workspace = await getWorkspaceByPublicId(req.params.id);
    const result = await executeTool(
      "WRITE_FILE",
      { path: req.body.path, content: req.body.content },
      { workspaceId: workspace.id, workspaceRoot: workspace.rootPath }
    );
    return res.status(result.success ? 200 : 400).json({ success: result.success, data: result, message: result.error });
  } catch (error) {
    return workspaceError(res, error);
  }
}

export async function runWorkspaceTerminal(req, res) {
  try {
    const workspace = await getWorkspaceByPublicId(req.params.id);
    const result = await executeTool(
      "RUN_TERMINAL",
      { command: req.body.command },
      { workspaceId: workspace.id, workspaceRoot: workspace.rootPath }
    );
    return res.status(result.success ? 200 : 400).json({ success: result.success, data: result, message: result.error });
  } catch (error) {
    return workspaceError(res, error);
  }
}

export async function applyWorkspacePatch(req, res) {
  try {
    const workspace = await getWorkspaceByPublicId(req.params.id);
    const result = await executeTool(
      "APPLY_PATCH",
      { file: req.body.file, find: req.body.find, replace: req.body.replace },
      { workspaceId: workspace.id, workspaceRoot: workspace.rootPath }
    );
    return res.status(result.success ? 200 : 400).json({ success: result.success, data: result, message: result.error });
  } catch (error) {
    return workspaceError(res, error);
  }
}

export async function downloadWorkspaceZip(req, res) {
  try {
    const workspace = await getWorkspaceByPublicId(req.params.id);
    const safeName = workspace.name.replace(/[^a-z0-9_-]+/gi, "-") || "workspace";
    res.attachment(`${safeName}-patched.zip`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", error => {
      if (!res.headersSent) res.status(500).json({ success: false, message: error.message });
      else res.destroy(error);
    });
    archive.pipe(res);
    archive.directory(workspace.rootPath, false);
    await archive.finalize();
  } catch (error) {
    return workspaceError(res, error);
  }
}

