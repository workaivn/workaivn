import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { executeTool } from "./toolExecutor.js";
import {
  assertWorkspaceRootAllowed,
  buildWriteContext,
  buildWriteValidationPolicy,
  buildWorkspaceTree,
  classifyWriteTargetRole,
  FrameworkAdapter,
  validateGeneratedContentWithPolicy,
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
  await fs.writeFile(
    path.join(projectRoot, "src", "value.test.js"),
    [
      'import test from "node:test";',
      'import assert from "node:assert/strict";',
      'export const value = 1;',
      'test("value", () => { assert.equal(value, 1); });',
      ''
    ].join("\n")
  );
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

test("workspace write validation keeps implementation and test symbols isolated per target file", async () => {
  const allowedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workai-write-isolation-"));
  const projectRoot = path.join(allowedRoot, "sample-project");
  await fs.mkdir(path.join(projectRoot, "src"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify({
      name: "sample-project",
      version: "1.0.0",
      scripts: { test: "npm test" }
    }, null, 2),
    "utf8"
  );

  const prompt = [
    "Create src/math.js and src/math.test.js.",
    "Implement add/subtract/multiply/divide.",
    'Create src/math.test.js with:',
    '```',
    'import { describe, it, expect } from "node:test";',
    'import { add, subtract, multiply, divide } from "./math.js";',
    '```'
  ].join("\n");

  try {
    const mathContext = await buildWriteContext({
      workspaceRoot: projectRoot,
      targetPath: "src/math.js",
      projectScan: { projectType: "node", testCommands: ["npm test"] },
      prompt,
      workspaceFiles: ["package.json", "src/math.js", "src/math.test.js"]
    });
    const testContext = await buildWriteContext({
      workspaceRoot: projectRoot,
      targetPath: "src/math.test.js",
      projectScan: { projectType: "node", testCommands: ["npm test"] },
      prompt,
      workspaceFiles: ["package.json", "src/math.js", "src/math.test.js"]
    });

    assert.notStrictEqual(mathContext, testContext);
    assert.equal(mathContext.validationPolicy.role, "implementation");
    assert.equal(testContext.validationPolicy.role, "test");
    assert.equal(mathContext.validationPolicy.targetPath, "src/math.js");
    assert.equal(testContext.validationPolicy.targetPath, "src/math.test.js");
    assert.deepEqual(mathContext.validationPolicy.mustExport.sort(), ["add", "divide", "multiply", "subtract"]);
    assert.deepEqual(mathContext.validationPolicy.mustReference, []);
    assert.deepEqual(mathContext.validationPolicy.mustContainAny, []);
    assert.equal("forbiddenSymbols" in mathContext.validationPolicy, false);
    assert.deepEqual(testContext.validationPolicy.mustExport, []);
    assert.deepEqual(testContext.validationPolicy.mustReference.sort(), ["add", "divide", "multiply", "subtract"]);
    assert.deepEqual(testContext.validationPolicy.mustContainAny, []);
    assert.equal("forbiddenSymbols" in testContext.validationPolicy, false);

    const implValidation = await validateGeneratedWriteContent({
      workspaceRoot: projectRoot,
      targetPath: "src/math.js",
      projectScan: { projectType: "node", testCommands: ["npm test"] },
      prompt,
      content: [
        "export function add(a, b) { return a + b; }",
        "export function subtract(a, b) { return a - b; }",
        "export function multiply(a, b) { return a * b; }",
        "export function divide(a, b) { return a / b; }"
      ].join("\n")
    });
    assert.equal(implValidation.success, true);

    const testValidation = await validateGeneratedWriteContent({
      workspaceRoot: projectRoot,
      targetPath: "src/math.test.js",
      projectScan: { projectType: "node", testCommands: ["npm test"] },
      prompt,
      content: [
        'import { add, subtract, multiply, divide } from "./math.js";',
        '',
        'if (add(1, 2) !== 3) {',
        '  throw new Error("adds");',
        '}',
        'if (subtract(5, 2) !== 3) {',
        '  throw new Error("subtracts");',
        '}'
      ].join("\n")
    });
    assert.equal(testValidation.success, true);

    const directImplPolicy = buildWriteValidationPolicy({
      targetPath: "src/math.js",
      role: classifyWriteTargetRole("src/math.js"),
      projectContext: { projectType: "node", moduleSystem: "esm" },
      prompt,
      detectedTestFramework: "node:test"
    });
    const directTestPolicy = buildWriteValidationPolicy({
      targetPath: "src/math.test.js",
      role: classifyWriteTargetRole("src/math.test.js"),
      projectContext: { projectType: "node", moduleSystem: "esm" },
      prompt,
      detectedTestFramework: "node:test"
    });

    assert.notStrictEqual(directImplPolicy, directTestPolicy);
    assert.deepEqual(directImplPolicy.mustExport.sort(), ["add", "divide", "multiply", "subtract"]);
    assert.deepEqual(directImplPolicy.mustReference, []);
    assert.deepEqual(directTestPolicy.mustExport, []);
    assert.deepEqual(directTestPolicy.mustReference.sort(), ["add", "divide", "multiply", "subtract"]);
    assert.deepEqual(directTestPolicy.mustContainAny, []);

    directImplPolicy.mustExport.push("fake");
    assert.equal(directImplPolicy.mustExport.includes("fake"), true);
    assert.deepEqual(directTestPolicy.mustExport, []);
  } finally {
    await fs.rm(allowedRoot, { recursive: true, force: true });
  }
});

test("workspace validation policy accepts implementation exports and test references", () => {
  const implPolicy = buildWriteValidationPolicy({
    targetPath: "src/math.js",
    role: "implementation",
    projectContext: { projectType: "node", moduleSystem: "esm" },
    prompt: "Implement add/subtract/multiply/divide."
  });
  const testPolicy = buildWriteValidationPolicy({
    targetPath: "src/math.test.js",
    role: "test",
    projectContext: { projectType: "node", moduleSystem: "esm" },
    prompt: [
      'import { add, subtract, multiply, divide } from "./math.js";',
      '',
      'if (add(1, 2) !== 3) {',
      '  throw new Error("math functions");',
      '}'
    ].join("\n")
  });

  assert.equal(implPolicy.role, "implementation");
  assert.deepEqual(implPolicy.mustExport.sort(), ["add", "divide", "multiply", "subtract"]);
  assert.deepEqual(implPolicy.mustReference, []);
  assert.equal(validateGeneratedContentWithPolicy(
    [
      "export function add(a,b){return a+b}",
      "export function subtract(a,b){return a-b}",
      "export function multiply(a,b){return a*b}",
      "export function divide(a,b){",
      'if (b === 0) throw new Error("Division by zero")',
      "return a/b",
      "}"
    ].join("\n"),
    implPolicy
  ).success, true);

  assert.equal(testPolicy.role, "test");
  assert.deepEqual(testPolicy.mustReference.sort(), ["add", "divide", "multiply", "subtract"]);
  assert.deepEqual(testPolicy.mustContainAny, []);
  assert.equal(validateGeneratedContentWithPolicy(
    [
      'import { add, subtract, multiply, divide } from "./math.js";',
      '',
      'if (add(1, 2) !== 3) {',
      '  throw new Error("math functions");',
      '}'
    ].join("\n"),
    testPolicy
  ).success, true);
});

test("workspace framework detection skips implementation files and detects test files", async () => {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.map(arg => (typeof arg === "object" ? JSON.stringify(arg) : String(arg))).join(" "));
  };

  try {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workai-framework-scope-"));
    const previousRoots = process.env.WORKSPACE_ROOTS;
    process.env.WORKSPACE_ROOTS = workspaceRoot;
    try {
      await fs.writeFile(path.join(workspaceRoot, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }, null, 2));
      await fs.mkdir(path.join(workspaceRoot, "src"), { recursive: true });
      await fs.writeFile(path.join(workspaceRoot, "src", "math.test.js"), 'import test from "node:test";\nimport assert from "node:assert/strict";\n');

      const implContext = await buildWriteContext({
        workspaceRoot,
        targetPath: "src/math.js",
        projectScan: { projectType: "node", testCommands: ["node --test"] },
        prompt: "Implement math helpers.",
        existingTargetContent: "export const add = (a, b) => a + b;",
        taskId: "framework-scope-impl"
      });
      const testContext = await buildWriteContext({
        workspaceRoot,
        targetPath: "src/math.test.js",
        projectScan: { projectType: "node", testCommands: ["node --test"] },
        prompt: "Write tests for math helpers.",
        existingTargetContent: 'import test from "node:test";\nimport assert from "node:assert/strict";',
        taskId: "framework-scope-test"
      });

      assert.equal(implContext.detectedTestFramework, "generic-js-test");
      assert.equal(testContext.detectedTestFramework, "node:test");
    } finally {
      if (previousRoots === undefined) delete process.env.WORKSPACE_ROOTS;
      else process.env.WORKSPACE_ROOTS = previousRoots;
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
    assert.ok(logs.some(line => line.includes("[FRAMEWORK_DETECTION_SKIPPED]") && line.includes("src/math.js")));
    assert.ok(logs.some(line => line.includes("[FRAMEWORK_DETECTED]") && line.includes("src/math.test.js")));
  } finally {
    console.log = originalLog;
  }
});

test("workspace framework detection dedupes repeated logs per task and file", async () => {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.map(arg => (typeof arg === "object" ? JSON.stringify(arg) : String(arg))).join(" "));
  };

  try {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workai-framework-dedupe-"));
    const previousRoots = process.env.WORKSPACE_ROOTS;
    process.env.WORKSPACE_ROOTS = workspaceRoot;
    try {
      await fs.writeFile(path.join(workspaceRoot, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }, null, 2));
      await fs.mkdir(path.join(workspaceRoot, "src"), { recursive: true });
      await fs.writeFile(path.join(workspaceRoot, "src", "math.test.js"), 'import test from "node:test";\nimport assert from "node:assert/strict";\n');

      await buildWriteContext({
        workspaceRoot,
        targetPath: "src/math.test.js",
        projectScan: { projectType: "node", testCommands: ["node --test"] },
        prompt: "Write tests for math helpers.",
        existingTargetContent: 'import test from "node:test";\nimport assert from "node:assert/strict";',
        taskId: "task-dedupe"
      });
      await buildWriteContext({
        workspaceRoot,
        targetPath: "src/math.test.js",
        projectScan: { projectType: "node", testCommands: ["node --test"] },
        prompt: "Write tests for math helpers.",
        existingTargetContent: 'import test from "node:test";\nimport assert from "node:assert/strict";',
        taskId: "task-dedupe"
      });

      const detectedLogs = logs.filter(line => line.includes("[FRAMEWORK_DETECTED]") && line.includes("src/math.test.js"));
      assert.equal(detectedLogs.length, 1);
    } finally {
      if (previousRoots === undefined) delete process.env.WORKSPACE_ROOTS;
      else process.env.WORKSPACE_ROOTS = previousRoots;
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  } finally {
    console.log = originalLog;
  }
});

test("workspace framework adapter rejects node:test expect imports", () => {
  const invalid = [
    'import { test, expect } from "node:test";',
    '',
    'test("x", () => {',
    '  expect(1).toBe(1);',
    '});'
  ].join("\n");

  const logs = [];
  const originalLog = console.log;
  let result;
  try {
    console.log = (...args) => logs.push(args.map(value => {
      if (typeof value === "string") return value;
      try { return JSON.stringify(value); } catch { return String(value); }
    }).join(" "));
    result = FrameworkAdapter.validate(invalid, "node:test", { kind: "runnable", source: "package.json" });
  } finally {
    console.log = originalLog;
  }

  assert.equal(result.success, false);
  assert.match(result.reason, /illegal import/i);
  assert.ok(result.found.some(item => String(item).includes("node:test")));
  assert.ok(result.found.some(item => String(item).includes("expect")));
  assert.match(result.suggestion, /node:assert\/strict/i);
  assert.ok(logs.some(line => line.includes("[FRAMEWORK_API_MISMATCH]")), "must log API mismatch");
  assert.ok(logs.some(line => line.includes("[FRAMEWORK_ASSERTION_API_REJECTED]")), "must log assertion API rejection");
});

test("workspace framework adapter accepts node:test assert usage", () => {
  const valid = [
    'import test from "node:test";',
    'import assert from "node:assert/strict";',
    '',
    'test("x", () => {',
    '  assert.equal(1, 1);',
    '});'
  ].join("\n");

  const result = FrameworkAdapter.validate(valid, "node:test", { kind: "runnable", source: "package.json" });

  assert.equal(result.success, true);
});

test("workspace framework adapter accepts vitest expect usage when runnable", () => {
  const valid = [
    'import { test, expect } from "vitest";',
    '',
    'test("x", () => {',
    '  expect(1).toBe(1);',
    '});'
  ].join("\n");

  const result = FrameworkAdapter.validate(valid, "vitest", { kind: "runnable", source: "package.json" });

  assert.equal(result.success, true);
});

test("workspace framework adapter rejects vitest expect usage when unavailable", () => {
  const invalid = [
    'import { test, expect } from "vitest";',
    '',
    'test("x", () => {',
    '  expect(1).toBe(1);',
    '});'
  ].join("\n");

  const result = FrameworkAdapter.validate(invalid, "vitest", { kind: "style-only", source: "existing_test_files" });

  assert.equal(result.success, false);
  assert.match(result.reason, /unavailable|mismatch/i);
});

test("workspace framework adapter accepts Jest globals", () => {
  const valid = [
    'describe("x", () => {',
    '  beforeEach(() => {});',
    '  it("y", () => {',
    '    expect(1).toBe(1);',
    '  });',
    '});'
  ].join("\n");

  const result = FrameworkAdapter.validate(valid, "jest", { kind: "runnable", source: "package.json" });

  assert.equal(result.success, true);
});

test("workspace framework adapter accepts Mocha style tests", () => {
  const valid = [
    'describe("x", () => {',
    '  before(() => {});',
    '  it("y", () => {',
    '    assert.equal(1, 1);',
    '  });',
    '});'
  ].join("\n");

  const result = FrameworkAdapter.validate(valid, "mocha");

  assert.equal(result.success, true);
});

test("workspace framework adapter generic mode rejects node:test expect imports", () => {
  const invalid = [
    'import test from "node:test";',
    'import { expect } from "vitest";',
    '',
    'test("x", () => {',
    '  expect(1).toBe(1);',
    '});'
  ].join("\n");

  const result = FrameworkAdapter.validate(invalid, "generic-js-test", { kind: "style-only", source: "existing_test_files" });

  assert.equal(result.success, false);
  assert.equal(result.reason, "framework_mismatch");
  assert.equal(result.framework, "generic-js-test");
  assert.ok(result.found.includes("node:test"));
  assert.ok(result.found.includes("other-test-lib"));
});

test("workspace framework adapter emits API contract logs for runnable node:test", () => {
  const logs = [];
  const originalLog = console.log;
  try {
    console.log = (...args) => logs.push(args.map(value => {
      if (typeof value === "string") return value;
      try { return JSON.stringify(value); } catch { return String(value); }
    }).join(" "));

    const contract = FrameworkAdapter.buildFrameworkGenerationContract({
      framework: "node:test",
      targetPath: "src/example.test.js",
      role: "test",
      availability: { kind: "runnable", source: "package.json" }
    });

    assert.equal(contract.framework, "node:test");
    assert.equal(contract.kind, "runnable");
    assert.ok(logs.some(line => line.includes("[FRAMEWORK_API_CONTRACT_BUILT]")));
  } finally {
    console.log = originalLog;
  }
});

test("workspace framework adapter rejects unavailable vitest assertions in style-only mode", () => {
  const invalid = [
    'import { test, expect } from "vitest";',
    '',
    'test("x", () => {',
    '  expect(1).toBe(1);',
    '});'
  ].join("\n");

  const result = FrameworkAdapter.validate(invalid, "vitest", { kind: "style-only", source: "existing_test_files" });

  assert.equal(result.success, false);
  assert.match(result.reason, /unavailable|mismatch/i);
});

test("workspace framework adapter detect priority favors package.json scripts", () => {
  const detected = FrameworkAdapter.detect({
    packageJson: {
      scripts: { test: "node --test src/**/*.test.js" },
      devDependencies: { vitest: "^1.0.0" }
    },
    projectScan: { testCommands: ["vitest run"] },
    nearbyFiles: [{ path: "src/example.test.js", content: 'import { test } from "vitest";' }]
  });

  assert.equal(detected.framework, "node:test");
  assert.equal(detected.source, "package.json");
});

test("workspace framework adapter generation hints mention the expected test style", () => {
  const hints = FrameworkAdapter.buildGenerationHints("node:test");

  assert.equal(hints.framework, "node:test");
  assert.match(hints.importStyle, /node:test/);
  assert.match(hints.assertions, /node:assert\/strict/);
});

test("workspace validation policy reports framework-specific test errors", () => {
  const policy = buildWriteValidationPolicy({
    targetPath: "src/example.test.js",
    role: "test",
    projectContext: { projectType: "node", moduleSystem: "esm" },
    detectedTestFramework: "node:test",
    prompt: 'import { add, subtract, multiply, divide } from "./math.js";'
  });

  const result = validateGeneratedContentWithPolicy([
    'import { test, expect } from "node:test";',
    'import { add, subtract, multiply, divide } from "./math.js";',
    '',
    'test("x", () => {',
    '  expect(1).toBe(1);',
    '});'
  ].join("\n"), policy);

  assert.equal(result.success, false);
  assert.match(result.error, /illegal import/i);
  assert.match(result.reason, /illegal import/i);
  assert.match(result.suggestion, /node:assert\/strict/i);
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
