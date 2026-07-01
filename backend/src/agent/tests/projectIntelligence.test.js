import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildPlan } from "../planner/planBuilder.js";
import { Planner } from "../planner/planner.js";
import { Task } from "../planner/task.js";
import {
  buildPlannerExecutionMetadata,
  createBootstrapTaskGraph,
  detectProjectIntent,
  resolveBootstrapProfile
} from "../projectIntelligence/index.js";

function baseWorkspaceState(existingFiles = []) {
  return {
    existingFiles,
    hasPackageJson: existingFiles.some(file => file === "package.json"),
    hasIndexPhp: existingFiles.some(file => /(^|\/)index\.php$/i.test(file)),
    hasCsproj: existingFiles.some(file => /\.csproj$/i.test(file)),
    hasLaravel: false,
    hasFastapi: false,
    hasFlask: false,
    hasFlutter: false,
    hasReactVite: false,
    hasNext: false,
    hasNodeExpress: false,
    hasStaticHtml: existingFiles.some(file => /(^|\/)index\.html$/i.test(file))
  };
}

test("bootstrap intelligence resolves react-vite-ts for SaaS landing pages on empty workspaces", () => {
  const intent = detectProjectIntent("Create a SaaS landing page");
  const profile = resolveBootstrapProfile(intent, baseWorkspaceState());
  assert.equal(profile.id, "react-vite-ts");
});

test("bare package.json does not force React for a plain landing page", () => {
  const intent = detectProjectIntent("Create a landing page");
  const profile = resolveBootstrapProfile(intent, baseWorkspaceState(["package.json"]));
  assert.equal(profile.id, "generic-static-html");
});

test("bootstrap intelligence resolves php-plain for PHP landing pages on empty workspaces", () => {
  const intent = detectProjectIntent("Create a PHP landing page");
  const profile = resolveBootstrapProfile(intent, baseWorkspaceState());
  assert.equal(profile.id, "php-plain");
});

test("bootstrap intelligence resolves generic-static-html for framework-free landing pages", () => {
  const intent = detectProjectIntent("Create a static HTML landing page");
  const profile = resolveBootstrapProfile(intent, baseWorkspaceState());
  assert.equal(profile.id, "generic-static-html");
});

test("bootstrap intelligence resolves node-express for REST API prompts", () => {
  const intent = detectProjectIntent("Create a REST API server");
  const profile = resolveBootstrapProfile(intent, baseWorkspaceState());
  assert.equal(profile.id, "node-express");
});

test("existing PHP projects keep php-plain even if the prompt mentions landing pages", () => {
  const intent = detectProjectIntent("Create a landing page");
  const profile = resolveBootstrapProfile(intent, baseWorkspaceState(["index.php", "assets/css/style.css"]));
  assert.equal(profile.id, "php-plain");
});

test("existing ASP.NET projects resolve aspnet-core instead of React", () => {
  const intent = detectProjectIntent("Create a landing page");
  const profile = resolveBootstrapProfile(intent, baseWorkspaceState(["Project.csproj"]));
  assert.equal(profile.id, "aspnet-core");
});

test("bootstrap task graphs generate framework-specific starter files", () => {
  const intent = detectProjectIntent("Create a static HTML landing page");
  const profile = resolveBootstrapProfile(intent, baseWorkspaceState());
  const graph = createBootstrapTaskGraph(profile, { objective: intent.objective, projectIntent: intent, workspaceState: baseWorkspaceState() });
  assert.deepEqual(
    graph.tasks.filter(task => task.tool === "WRITE_FILE").map(task => task.toolArgs?.path || task.toolArgs?.file),
    ["index.html", "assets/css/style.css", "assets/js/app.js"]
  );
});

test("planner execution metadata normalizes read, write, run, and protected files", () => {
  const planner = new Planner([
    new Task({
      id: "read-package",
      kind: "CODING",
      tool: "READ_FILE",
      toolArgs: { path: "package.json" },
      goal: "Read package.json"
    }),
    new Task({
      id: "write-math",
      kind: "CODING",
      tool: "WRITE_FILE",
      toolArgs: { path: "src/math.js" },
      goal: "Write src/math.js"
    }),
    new Task({
      id: "write-math-test",
      kind: "CODING",
      tool: "WRITE_FILE",
      toolArgs: { path: "src/math.test.js" },
      goal: "Write src/math.test.js"
    }),
    new Task({
      id: "run-test",
      kind: "CODING",
      tool: "RUN_TERMINAL",
      toolArgs: { command: "npm test" },
      goal: "Run npm test"
    })
  ]);

  const metadata = buildPlannerExecutionMetadata(planner);

  assert.deepEqual(metadata.plannerReadFiles, ["package.json"]);
  assert.deepEqual(metadata.plannerWriteFiles, ["src/math.js", "src/math.test.js"]);
  assert.deepEqual(metadata.plannerRunCommands, ["npm test"]);
  assert.deepEqual(metadata.plannerValidationCommands, ["npm test"]);
  assert.deepEqual(metadata.plannerProtectedFiles, ["package.json"]);
  assert.deepEqual(metadata.plannerTaskFilesByTool.READ_FILE, ["package.json"]);
  assert.deepEqual(metadata.plannerTaskFilesByTool.WRITE_FILE, ["src/math.js", "src/math.test.js"]);
  assert.deepEqual(metadata.plannerTaskFilesByTool.RUN_TERMINAL, ["npm test"]);
});

test("unsupported bootstrap profiles return a deterministic unsupported plan", () => {
  const intent = detectProjectIntent("Create an ASP.NET Core admin panel");
  const profile = resolveBootstrapProfile(intent, baseWorkspaceState());
  assert.equal(profile.id, "aspnet-core");
  const plan = buildPlan("Create an ASP.NET Core admin panel", {
    taskType: "CODING",
    bootstrapProfile: profile,
    projectIntent: intent,
    workspaceState: baseWorkspaceState()
  });
  assert.equal(plan.tasks.length, 1);
  assert.match(String(plan.tasks[0].goal || ""), /unsupported framework plan/i);
  assert.equal(plan.tasks.some(task => task.tool === "WRITE_FILE" && /react/i.test(String(task.toolArgs?.path || task.toolArgs?.file || ""))), false);
});

test("detectWorkspaceState is not required for bootstrap resolution when intent is explicit", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workai-bootstrap-"));
  try {
    await fs.writeFile(path.join(root, "index.php"), "<?php echo 'hi';", "utf8");
    const intent = detectProjectIntent("Create a SaaS landing page");
    const profile = resolveBootstrapProfile(intent, baseWorkspaceState(["index.php"]));
    assert.equal(profile.id, "php-plain");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
