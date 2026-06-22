import fs from "fs/promises";
import path from "path";
import AdmZip from "adm-zip";
import Workspace from "../../models/Workspace.js";
import {
  MANAGED_WORKSPACE_ROOT,
  assertWorkspaceRootAllowed,
  validateWorkspaceRoot
} from "../../agent/workspace.js";

export async function getWorkspaceByPublicId(workspaceId) {
  const query = { id: workspaceId };
  if (/^[a-f\d]{24}$/i.test(String(workspaceId || ""))) {
    query.$or = [{ id: workspaceId }, { _id: workspaceId }];
    delete query.id;
  }
  const workspace = await Workspace.findOne(query);

  if (!workspace) throw new Error("Workspace not found");
  await validateWorkspaceRoot(workspace.rootPath, {
    allowManaged: workspace.sourceType === "zip"
  });
  return workspace;
}

export async function createLocalWorkspace({ name, rootPath }) {
  const allowedPath = assertWorkspaceRootAllowed(rootPath, { allowManaged: false });
  const realRoot = await validateWorkspaceRoot(allowedPath, { allowManaged: false });

  return Workspace.create({
    name: String(name || path.basename(realRoot)).trim(),
    rootPath: realRoot,
    sourceType: "local"
  });
}

export async function createZipWorkspace({ name, zipBuffer }) {
  if (!zipBuffer?.length) throw new Error("ZIP file is required");

  const workspace = new Workspace({
    name: String(name || "Uploaded project").trim(),
    rootPath: path.join(MANAGED_WORKSPACE_ROOT, "pending"),
    sourceType: "zip"
  });
  workspace.rootPath = path.join(MANAGED_WORKSPACE_ROOT, workspace.id);
  await fs.mkdir(workspace.rootPath, { recursive: true });

  try {
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();

    for (const entry of entries) {
      const normalized = path.posix.normalize(entry.entryName.replace(/\\/g, "/"));
      if (
        normalized === ".." ||
        normalized.startsWith("../") ||
        path.posix.isAbsolute(normalized) ||
        /^[A-Za-z]:\//.test(normalized)
      ) {
        throw new Error(`Unsafe ZIP entry: ${entry.entryName}`);
      }
    }

    zip.extractAllTo(workspace.rootPath, true);
    await workspace.save();
    return workspace;
  } catch (error) {
    await fs.rm(workspace.rootPath, { recursive: true, force: true });
    throw error;
  }
}
