import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { executeTool } from "./toolExecutor.js";
import {
  assertWorkspaceRootAllowed,
  buildWorkspaceTree,
  resolveWorkspacePath,
  validateWorkspaceRoot
} from "./workspace.js";

async function createAllowedProject() {
  const allowedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workai-roots-"));
  const projectRoot = path.join(allowedRoot, "sample-project");
  await fs.mkdir(path.join(projectRoot, "src"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "package.json"), '{"name":"sample-project"}\n');
  await fs.writeFile(path.join(projectRoot, "src", "value.test.js"), "export const value = 1;\n");
  return { allowedRoot, projectRoot };
}

test("workspace security only accepts projects inside WORKSPACE_ROOTS", async () => {
  const previousRoots = process.env.WORKSPACE_ROOTS;
  const { allowedRoot, projectRoot } = await createAllowedProject();
  process.env.WORKSPACE_ROOTS = allowedRoot;

  try {
    assert.equal(await validateWorkspaceRoot(projectRoot, { allowManaged: false }), await fs.realpath(projectRoot));
    assert.throws(
      () => assertWorkspaceRootAllowed(path.dirname(allowedRoot), { allowManaged: false }),
      /outside WORKSPACE_ROOTS/
    );
    assert.throws(
      () => resolveWorkspacePath(projectRoot, "../outside.txt"),
      /escapes selected workspace/
    );
  } finally {
    if (previousRoots === undefined) delete process.env.WORKSPACE_ROOTS;
    else process.env.WORKSPACE_ROOTS = previousRoots;
    await fs.rm(allowedRoot, { recursive: true, force: true });
  }
});

test("workspace tools read, modify, and run terminal from the selected project root", async () => {
  const { allowedRoot, projectRoot } = await createAllowedProject();
  const context = { workspaceId: "test-workspace", workspaceRoot: projectRoot };

  try {
    const read = await executeTool("READ_FILE", { path: "package.json" }, context);
    assert.equal(read.success, true);
    assert.match(read.content, /sample-project/);

    const patch = await executeTool("APPLY_PATCH", {
      file: "src/value.test.js",
      find: "value = 1",
      replace: "value = 2"
    }, context);
    assert.equal(patch.success, true);
    assert.match(await fs.readFile(path.join(projectRoot, "src", "value.test.js"), "utf8"), /value = 2/);

    const terminal = await executeTool(
      "RUN_TERMINAL",
      { command: "node -e \"console.log(process.cwd())\"" },
      context
    );
    assert.equal(terminal.success, true);
    assert.equal(path.resolve(terminal.stdout.trim()), path.resolve(projectRoot));

    const tree = await buildWorkspaceTree(projectRoot);
    assert.ok(tree.tree.some(node => node.name === "package.json"));
  } finally {
    await fs.rm(allowedRoot, { recursive: true, force: true });
  }
});

test("workspace tools cannot read absolute system paths", async () => {
  const { allowedRoot, projectRoot } = await createAllowedProject();

  try {
    const result = await executeTool(
      "READ_FILE",
      { path: "C:\\Windows\\System32\\drivers\\etc\\hosts" },
      { workspaceId: "test-workspace", workspaceRoot: projectRoot }
    );
    assert.equal(result.success, false);
    assert.match(result.error, /relative to the selected workspace/);

    const terminal = await executeTool(
      "RUN_TERMINAL",
      { command: "type C:\\Windows\\win.ini" },
      { workspaceId: "test-workspace", workspaceRoot: projectRoot }
    );
    assert.equal(terminal.success, false);
    assert.match(terminal.error, /blocked/);
  } finally {
    await fs.rm(allowedRoot, { recursive: true, force: true });
  }
});
