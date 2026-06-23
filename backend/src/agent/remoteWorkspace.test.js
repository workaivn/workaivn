import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  MANAGED_WORKSPACE_ROOT,
  assertWorkspaceRootAllowed
} from "./workspace.js";
import {
  detectProjectRoot,
  getWorkspaceCapabilities,
  validateArchiveEntry,
  validateGitRepoUrl
} from "../modules/workspace/workspace.service.js";

test("remote mode only allows managed workspace roots", () => {
  const previousMode = process.env.WORKSPACE_MODE;
  const previousRoots = process.env.WORKSPACE_ROOTS;
  process.env.WORKSPACE_MODE = "remote";
  process.env.WORKSPACE_ROOTS = MANAGED_WORKSPACE_ROOT;

  try {
    assert.doesNotThrow(() =>
      assertWorkspaceRootAllowed(path.join(MANAGED_WORKSPACE_ROOT, "workspace-id"))
    );
    assert.throws(
      () => assertWorkspaceRootAllowed(path.resolve(".."), { allowManaged: false }),
      /Remote mode only allows managed workspaces/
    );
    assert.deepEqual(getWorkspaceCapabilities(), {
      mode: "remote",
      allowLocalPath: false,
      allowZipUpload: true,
      allowGitClone: true,
      message: "Backend is running remotely. Upload a ZIP or clone a Git repository to create a workspace."
    });
  } finally {
    if (previousMode === undefined) delete process.env.WORKSPACE_MODE;
    else process.env.WORKSPACE_MODE = previousMode;
    if (previousRoots === undefined) delete process.env.WORKSPACE_ROOTS;
    else process.env.WORKSPACE_ROOTS = previousRoots;
  }
});

test("ZIP safety rejects traversal, secrets, and dependency folders", () => {
  assert.equal(validateArchiveEntry("project/src/index.js"), "project/src/index.js");
  assert.throws(() => validateArchiveEntry("../secret.txt"), /Unsafe ZIP entry/);
  assert.throws(() => validateArchiveEntry("project/.env.production"), /blocked or sensitive/);
  assert.throws(() => validateArchiveEntry("project/node_modules/pkg/index.js"), /blocked or sensitive/);
});

test("nested ZIP project root is detected", async () => {
  const container = await fs.mkdtemp(path.join(os.tmpdir(), "workai-remote-root-"));
  const nested = path.join(container, "uploaded-project");
  await fs.mkdir(nested);
  await fs.writeFile(path.join(nested, "package.json"), "{}");

  try {
    assert.equal(await detectProjectRoot(container), await fs.realpath(nested));
  } finally {
    await fs.rm(container, { recursive: true, force: true });
  }
});

test("Git clone URL policy only accepts public HTTPS .git repositories", () => {
  assert.equal(
    validateGitRepoUrl("https://github.com/openai/openai-node.git"),
    "https://github.com/openai/openai-node.git"
  );
  assert.throws(() => validateGitRepoUrl("git@github.com:owner/repo.git"), /Invalid Git repository URL/);
  assert.throws(() => validateGitRepoUrl("https://token@github.com/owner/repo.git"), /without credentials/);
  assert.throws(() => validateGitRepoUrl("https://example.com/owner/repo.git"), /GitHub, GitLab, and Bitbucket/);
});

