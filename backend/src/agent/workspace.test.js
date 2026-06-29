import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { executeTool } from "./toolExecutor.js";
import {
  assertWorkspaceRootAllowed,
  buildWriteContext,
  buildWorkspaceTree,
  validateGeneratedWriteContent,
  resolveWorkspacePath,
  resolveWorkspacePathSafe,
  validateWorkspaceRoot
} from "./workspace.js";
import { scanProject } from "./projectScanner.js";

async function createAllowedProject() {
  const allowedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workai-roots-"));
  const projectRoot = path.join(allowedRoot, "sample-project");
  await fs.mkdir(path.join(projectRoot, "src"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "package.json"), '{"name":"sample-project"}\n');
  await fs.writeFile(path.join(projectRoot, "src", "value.test.js"), "export const value = 1;\n");
  return { allowedRoot, projectRoot };
}

async function createSrcOnlyProject() {
  const allowedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workai-src-only-"));
  const projectRoot = path.join(allowedRoot, "sample-project");
  await fs.mkdir(path.join(projectRoot, "src", "agent", "planner"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "package.json"), '{"name":"sample-project"}\n');
  await fs.writeFile(
    path.join(projectRoot, "src", "agent", "planner", "clarificationEngine.js"),
    "export function analyzeClarification(prompt) { return { needsClarification: false }; }\n"
  );
  return { allowedRoot, projectRoot };
}

async function createBackendOnlyProject() {
  const allowedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workai-backend-only-"));
  const projectRoot = path.join(allowedRoot, "sample-backend");
  await fs.mkdir(path.join(projectRoot, "src", "agent"), { recursive: true });
  await fs.mkdir(path.join(projectRoot, "src", "modules"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify({
      name: "sample-backend",
      version: "1.0.0",
      scripts: {
        test: "node --test src/**/*.test.js",
        build: "node build.js",
        start: "node server.js"
      }
    }, null, 2),
    "utf8"
  );
  await fs.writeFile(path.join(projectRoot, "server.js"), "export function start() { return true; }\n", "utf8");
  await fs.writeFile(path.join(projectRoot, "src", "server.js"), "export default function app() { return true; }\n", "utf8");
  await fs.writeFile(path.join(projectRoot, "src", "agent", "index.js"), "export const agent = true;\n", "utf8");
  await fs.writeFile(path.join(projectRoot, "src", "modules", "index.js"), "export const modules = true;\n", "utf8");
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

test("development workspace fallback allows projects under the current checkout parent", () => {
  const previousRoots = process.env.WORKSPACE_ROOTS;
  const previousLegacyRoot = process.env.AGENT_WORKSPACE_ROOT;
  const previousNodeEnv = process.env.NODE_ENV;
  delete process.env.WORKSPACE_ROOTS;
  delete process.env.AGENT_WORKSPACE_ROOT;
  process.env.NODE_ENV = "development";

  try {
    assert.doesNotThrow(() =>
      assertWorkspaceRootAllowed(path.resolve(".."), { allowManaged: false })
    );
  } finally {
    if (previousRoots === undefined) delete process.env.WORKSPACE_ROOTS;
    else process.env.WORKSPACE_ROOTS = previousRoots;
    if (previousLegacyRoot === undefined) delete process.env.AGENT_WORKSPACE_ROOT;
    else process.env.AGENT_WORKSPACE_ROOT = previousLegacyRoot;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
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

test("workspace path resolver maps backend/src to existing src layout when backend is absent", async () => {
  const { allowedRoot, projectRoot } = await createSrcOnlyProject();
  const clarificationEngineContent = [
    "export function analyzeClarification(prompt) {",
    "  const text = String(prompt || \"\").trim().toLowerCase();",
    "  if (!text) return { needsClarification: true };",
    "  if (/^(?:fix|update|improve|repair)\\s+it$/.test(text)) return { needsClarification: true };",
    "  return { needsClarification: false };",
    "}\n"
  ].join("\n");

  try {
    const resolved = await resolveWorkspacePathSafe(
      projectRoot,
      "backend/src/agent/planner/clarificationEngine.js",
      { allowMissing: true }
    );

    assert.equal(
      resolved.relativePath.replace(/\\/g, "/"),
      "src/agent/planner/clarificationEngine.js"
    );

    const write = await executeTool(
      "WRITE_FILE",
      {
        path: "backend/src/agent/planner/clarificationEngine.js",
        content: clarificationEngineContent
      },
      { workspaceId: "test-workspace", workspaceRoot: projectRoot }
    );

    assert.equal(write.success, true);
    assert.equal(
      await fs.readFile(
        path.join(projectRoot, "src", "agent", "planner", "clarificationEngine.js"),
        "utf8"
      ),
      clarificationEngineContent
    );
    assert.equal(await fs.access(path.join(projectRoot, "backend")).then(() => true).catch(() => false), false);
  } finally {
    await fs.rm(allowedRoot, { recursive: true, force: true });
  }
});

test("workspace tools normalize CommonJS output to ESM in module projects", async () => {
  const allowedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workai-esm-write-"));
  const projectRoot = path.join(allowedRoot, "sample-project");
  await fs.mkdir(path.join(projectRoot, "src", "agent", "planner"), { recursive: true });
  await fs.mkdir(path.join(projectRoot, "src", "modules", "aiagent"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "sample-project", type: "module" }, null, 2)
  );
  await fs.writeFile(
    path.join(projectRoot, "src", "modules", "aiagent", "aiagent.controller.js"),
    'import { analyzeClarification } from "../../agent/planner/clarificationEngine.js";\n'
  );

  try {
    const result = await executeTool(
      "WRITE_FILE",
      {
        path: "src/agent/planner/clarificationEngine.js",
        content: [
          'module.exports = { analyzeClarification(prompt) {',
          '  const text = String(prompt || "").trim().toLowerCase();',
          '  if (!text) return { needsClarification: true };',
          '  if (/^(?:fix|update|improve|repair)\\s+it$/.test(text)) return { needsClarification: true };',
          '  return { needsClarification: false };',
          '} }'
        ].join('\n')
      },
      { workspaceId: "test-workspace", workspaceRoot: projectRoot }
    );

    assert.equal(result.success, true);
    const content = await fs.readFile(
      path.join(projectRoot, "src", "agent", "planner", "clarificationEngine.js"),
      "utf8"
    );
    assert.match(content, /export function analyzeClarification/);
    assert.ok(!content.includes("module.exports"));
    assert.ok(!content.includes("exports."));
  } finally {
    await fs.rm(allowedRoot, { recursive: true, force: true });
  }
});

test("workspace tools preserve CommonJS output when the project is CommonJS", async () => {
  const allowedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workai-cjs-write-"));
  const projectRoot = path.join(allowedRoot, "sample-project");
  await fs.mkdir(path.join(projectRoot, "lib"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ name: "sample-project" }, null, 2));
  await fs.writeFile(
    path.join(projectRoot, "lib", "consumer.js"),
    'const target = require("../target.js");\nconsole.log(target);\n'
  );

  try {
    const result = await executeTool(
      "WRITE_FILE",
      {
        path: "target.js",
        content: 'module.exports = { hello() { return "hi"; } }'
      },
      { workspaceId: "test-workspace", workspaceRoot: projectRoot }
    );

    assert.equal(result.success, true);
    const content = await fs.readFile(path.join(projectRoot, "target.js"), "utf8");
    assert.match(content, /module\.exports/);
    assert.ok(!content.includes("export function hello"));
  } finally {
    await fs.rm(allowedRoot, { recursive: true, force: true });
  }
});

test("workspace write validation respects Python language context", async () => {
  const allowedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workai-python-write-"));
  const projectRoot = path.join(allowedRoot, "sample-project");
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(path.join(projectRoot, "pyproject.toml"), "[project]\nname = 'sample-project'\n");
  await fs.writeFile(path.join(projectRoot, "app.py"), "from os import path\n\ndef main():\n    return path.exists('.')\n");

  try {
    const context = await buildWriteContext({
      workspaceRoot: projectRoot,
      targetPath: "app.py",
      projectScan: { projectType: "python" },
      prompt: "Implement app.py"
    });

    assert.equal(context.detectedLanguage, "python");
    assert.equal(context.projectType, "python");
    assert.ok(context.referenceGraph.imports.length > 0);
    assert.ok(context.requiredSymbols.includes("main"));

    const rejected = await validateGeneratedWriteContent({
      workspaceRoot: projectRoot,
      targetPath: "app.py",
      projectScan: { projectType: "python" },
      content: "module.exports = { main() { return true; } }",
      prompt: "Implement app.py"
    });

    assert.equal(rejected.success, false);
    assert.match(rejected.error, /incompatible/i);

    const accepted = await validateGeneratedWriteContent({
      workspaceRoot: projectRoot,
      targetPath: "app.py",
      projectScan: { projectType: "python" },
      content: "def main():\n    return True\n",
      prompt: "Implement app.py"
    });

    assert.equal(accepted.success, true);
    assert.match(accepted.content, /def main/);
  } finally {
    await fs.rm(allowedRoot, { recursive: true, force: true });
  }
});

test("project scanner exposes workspace layout roots", async () => {
  const { allowedRoot, projectRoot } = await createSrcOnlyProject();

  try {
    const scan = await scanProject(projectRoot);
    assert.equal(scan.workspaceRoot, projectRoot);
    assert.ok(Array.isArray(scan.existingTopLevelDirs));
    assert.ok(scan.existingTopLevelDirs.includes("src"));
    assert.ok(Array.isArray(scan.sourceRoots));
    assert.ok(Array.isArray(scan.moduleRoots));
    assert.ok(Array.isArray(scan.appRoots));
    assert.ok(Array.isArray(scan.testRoots));
  } finally {
    await fs.rm(allowedRoot, { recursive: true, force: true });
  }
});

test("project scanner does not classify package-json backend as React without React evidence", async () => {
  const { allowedRoot, projectRoot } = await createBackendOnlyProject();

  try {
    const scan = await scanProject(projectRoot);

    assert.match(scan.projectType, /^(?:node|node_backend)$/);
    assert.ok(!scan.entryFiles.some(file => /^src\/(?:App|main|index)\.(?:jsx|tsx|js)$/i.test(file)));
    assert.ok(scan.entryFiles.some(file => ["server.js", "src/server.js", "app.js", "src/app.js", "src/index.js", "index.js"].includes(file)));
    assert.ok(scan.testCommands.includes("npm test"));
    assert.ok(scan.buildCommands.includes("npm run build"));
    assert.ok(scan.runCommands.includes("npm start"));
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
