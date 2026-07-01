import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildCodeContext,
  resolveConvention,
  resolveImports,
  resolveExports,
  generateFileContent,
  generatePatch,
  generateTestContent,
  buildValidationHints,
  guardGeneratedOutput,
  generateForTask,
  CODE_GENERATION_STATUS,
  CODE_GENERATION_TOOL
} from "./codeGenerator/index.js";

const execFileAsync = promisify(execFile);

async function createWorkspace() {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codegen-"));
  await fs.mkdir(path.join(workspaceRoot, "src"), { recursive: true });
  return workspaceRoot;
}

async function writeFile(workspaceRoot, relativePath, content) {
  const absolute = path.join(workspaceRoot, relativePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content, "utf8");
}

function captureLogs(fn) {
  const logs = [];
  const original = console.log;
  console.log = (...args) => {
    logs.push(args.map(arg => {
      if (typeof arg === "string") return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }).join(" "));
  };
  return Promise.resolve()
    .then(fn)
    .then(result => ({ result, logs }))
    .finally(() => {
      console.log = original;
    });
}

test("code generator creates a new file from execution-task evidence", async () => {
  const workspaceRoot = await createWorkspace();
  await writeFile(workspaceRoot, "src/math.js", `export function add(a, b) {\n  return a + b;\n}\n`);

  const result = await generateForTask({
    workspaceRoot,
    workspaceState: {
      workspaceRoot,
      existingFiles: ["src/math.js"],
      packageJson: { type: "module", scripts: { test: "node --test src/**/*.test.js" } }
    },
    task: {
      id: "write-calc",
      kind: "create",
      tool: "WRITE_FILE",
      goal: "Create a calculator module that uses math helpers",
      toolArgs: { path: "src/calc.js" },
      dependencies: ["read-math"],
      expectedExports: ["calc"]
    },
    executionPlan: {
      tasks: [
        { id: "read-math", tool: "READ_FILE", toolArgs: { path: "src/math.js" } },
        { id: "write-calc", tool: "WRITE_FILE", toolArgs: { path: "src/calc.js" }, dependsOn: ["read-math"] }
      ]
    },
    relatedFiles: [
      { path: "src/math.js", content: `export function add(a, b) {\n  return a + b;\n}\n`, relation: "dependency" }
    ]
  });

  assert.equal(result.status, CODE_GENERATION_STATUS.READY);
  assert.equal(result.tool, CODE_GENERATION_TOOL.WRITE_FILE);
  assert.match(result.content, /import\s+\{\s*add\s*\}\s+from\s+['"]\.\/math\.js['"]/);
  assert.match(result.content, /export function calc\(/);
  assert.ok(Array.isArray(result.expectedImports));
  assert.ok(result.expectedImports.some(item => item.source === "./math.js"));
});

test("code generator produces a localized patch for an existing file", async () => {
  const workspaceRoot = await createWorkspace();
  const original = `import express from "express";\n\nconst app = express();\napp.listen(3000);\n`;
  await writeFile(workspaceRoot, "src/server.js", original);

  const result = await generateForTask({
    workspaceRoot,
    workspaceState: {
      workspaceRoot,
      existingFiles: ["src/server.js"],
      packageJson: { type: "module" }
    },
    task: {
      id: "patch-server",
      kind: "modify",
      tool: "APPLY_PATCH",
      goal: "Add a health route",
      toolArgs: { path: "src/server.js" }
    },
    existingFileContent: original,
    validationErrors: ["missing health route"]
  });

  assert.equal(result.status, CODE_GENERATION_STATUS.READY);
  assert.equal(result.tool, CODE_GENERATION_TOOL.APPLY_PATCH);
  assert.match(result.patch, /"file":\s*"src\/server\.js"/);
  assert.match(result.patch, /app\.get/);
});

test("resolveConvention infers style from workspace evidence", async () => {
  const workspaceRoot = await createWorkspace();
  await writeFile(workspaceRoot, "src/legacy.js", "module.exports = {\n\tvalue: 'x'\n};\n");
  await writeFile(workspaceRoot, "src/modern.js", "export const value = \"x\";\n");

  const legacy = resolveConvention({
    workspaceRoot,
    workspaceState: { workspaceRoot, existingFiles: ["src/legacy.js"], packageJson: { type: "commonjs" } },
    targetPath: "src/legacy.js",
    existingContent: "module.exports = {\n\tvalue: 'x'\n};\n",
    relatedFiles: [{ path: "src/legacy.js", content: "module.exports = {\n\tvalue: 'x'\n};\n" }]
  });
  const modern = resolveConvention({
    workspaceRoot,
    workspaceState: { workspaceRoot, existingFiles: ["src/modern.js"], packageJson: { type: "module" } },
    targetPath: "src/modern.js",
    existingContent: "export const value = \"x\";\n",
    relatedFiles: [{ path: "src/modern.js", content: "export const value = \"x\";\n" }]
  });

  assert.notEqual(legacy.moduleSystem, modern.moduleSystem);
  assert.notEqual(legacy.quoteStyle, modern.quoteStyle);
});

test("import and export resolution stay consistent across related files", async () => {
  const workspaceRoot = await createWorkspace();
  await writeFile(workspaceRoot, "src/math.js", "export function add(a, b) { return a + b; }\n");

  const context = await buildCodeContext({
    workspaceRoot,
    workspaceState: {
      workspaceRoot,
      existingFiles: ["src/math.js"],
      packageJson: { type: "module" }
    },
    task: {
      id: "calc",
      tool: "WRITE_FILE",
      toolArgs: { path: "src/calc.js" },
      expectedExports: ["calc"]
    },
    relatedFiles: [{ path: "src/math.js", content: "export function add(a, b) { return a + b; }\n", relation: "dependency" }]
  });
  const convention = resolveConvention(context);
  const imports = resolveImports(context, convention);
  const exports = resolveExports(context, convention);

  assert.ok(imports.some(item => item.source === "./math.js"));
  assert.ok(exports.some(item => item.name === "calc"));
});

test("generateTestContent uses the discovered test convention", async () => {
  const workspaceRoot = await createWorkspace();
  await writeFile(workspaceRoot, "src/math.js", "export function add(a, b) { return a + b; }\n");
  await writeFile(workspaceRoot, "src/math.test.js", "import test from 'node:test';\n");

  const context = await buildCodeContext({
    workspaceRoot,
    workspaceState: {
      workspaceRoot,
      existingFiles: ["src/math.js", "src/math.test.js"],
      packageJson: { type: "module", scripts: { test: "node --test src/**/*.test.js" } }
    },
    task: {
      id: "math-test",
      tool: "WRITE_FILE",
      toolArgs: { path: "src/math.test.js" }
    },
    relatedFiles: [{ path: "src/math.js", content: "export function add(a, b) { return a + b; }\n", relation: "subject" }]
  });
  const convention = resolveConvention(context);
  const testContent = generateTestContent(context, convention);

  assert.match(testContent, /node:test/);
  assert.match(testContent, /add/);
});

test("validation hints reflect the detected workspace validation strategy", async () => {
  const workspaceRoot = await createWorkspace();
  const context = await buildCodeContext({
    workspaceRoot,
    workspaceState: {
      workspaceRoot,
      existingFiles: ["src/index.js"],
      packageJson: { scripts: { test: "npm test" } }
    },
    task: {
      id: "test-hints",
      tool: "WRITE_FILE",
      toolArgs: { path: "src/index.js" }
    },
    validationErrors: ["missing import"]
  });
  const convention = resolveConvention(context);
  const hints = buildValidationHints(context, convention);

  assert.ok(hints.length > 0);
  assert.ok(hints.some(hint => /review validation errors/i.test(hint)));
});

test("safety guard blocks generation outside the workspace and empty output", async () => {
  const workspaceRoot = await createWorkspace();
  const blocked = guardGeneratedOutput({
    status: CODE_GENERATION_STATUS.READY,
    tool: CODE_GENERATION_TOOL.WRITE_FILE,
    targetPath: "../escape.js",
    content: "x",
    expectedImports: [],
    expectedExports: [],
    evidence: []
  }, { workspaceRoot });

  assert.equal(blocked.status, CODE_GENERATION_STATUS.SAFETY_BLOCKED);
  assert.match(blocked.reason, /TARGET_OUTSIDE_WORKSPACE/);
});

test("placeholder policy blocks fake completion when evidence is missing", async () => {
  const workspaceRoot = await createWorkspace();
  const result = await generateForTask({
    workspaceRoot,
    workspaceState: { workspaceRoot, existingFiles: [], packageJson: {} },
    task: {
      id: "needs-context",
      tool: "WRITE_FILE",
      toolArgs: { path: "" },
      goal: "Create a feature"
    }
  });

  assert.notEqual(result.status, CODE_GENERATION_STATUS.READY);
  assert.ok(result.reason.length > 0);
});

test("same task can produce different shapes from different conventions", async () => {
  const workspaceRootA = await createWorkspace();
  const workspaceRootB = await createWorkspace();
  await writeFile(workspaceRootA, "src/file.js", "module.exports = { value: 'one' };\n");
  await writeFile(workspaceRootB, "src/file.js", "export const value = \"two\";\n");

  const resultA = await generateForTask({
    workspaceRoot: workspaceRootA,
    workspaceState: { workspaceRoot: workspaceRootA, existingFiles: ["src/file.js"], packageJson: { type: "commonjs" } },
    task: { id: "same-a", tool: "WRITE_FILE", toolArgs: { path: "src/output.js" }, goal: "Create output helper" },
    relatedFiles: [{ path: "src/file.js", content: "module.exports = { value: 'one' };\n", relation: "dependency" }]
  });
  const resultB = await generateForTask({
    workspaceRoot: workspaceRootB,
    workspaceState: { workspaceRoot: workspaceRootB, existingFiles: ["src/file.js"], packageJson: { type: "module" } },
    task: { id: "same-b", tool: "WRITE_FILE", toolArgs: { path: "src/output.js" }, goal: "Create output helper" },
    relatedFiles: [{ path: "src/file.js", content: "export const value = \"two\";\n", relation: "dependency" }]
  });

  assert.notEqual(resultA.content, resultB.content);
});

test("generateForTask emits deterministic logs and returns serializable payloads", async () => {
  const workspaceRoot = await createWorkspace();
  await writeFile(workspaceRoot, "src/math.js", "export function add(a, b) { return a + b; }\n");

  const { result, logs } = await captureLogs(() => generateForTask({
    workspaceRoot,
    workspaceState: {
      workspaceRoot,
      existingFiles: ["src/math.js"],
      packageJson: { type: "module" }
    },
    task: { id: "log-task", tool: "WRITE_FILE", toolArgs: { path: "src/calc.js" } },
    relatedFiles: [{ path: "src/math.js", content: "export function add(a, b) { return a + b; }\n", relation: "dependency" }]
  }));

  assert.ok(logs.some(line => line.includes("[CODE_GENERATION_START]")));
  assert.equal(result.taskId, "log-task");
  assert.equal(result.status, CODE_GENERATION_STATUS.READY);
  assert.ok(result.content.length > 0);
});

