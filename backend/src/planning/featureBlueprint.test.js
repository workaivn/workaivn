import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildFeatureBlueprint,
  loadBlueprint,
  serializeBlueprint
} from "./featureBlueprint/index.js";

async function makeWorkspace(structure = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workai-feature-blueprint-"));
  for (const [relativePath, content] of Object.entries(structure)) {
    const target = path.join(root, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }
  return root;
}

async function captureLogs(fn) {
  const logs = [];
  const original = console.log;
  console.log = (...args) => {
    logs.push(args.map(value => (typeof value === "string" ? value : JSON.stringify(value))).join(" "));
  };
  try {
    const result = await fn();
    return { result, logs };
  } finally {
    console.log = original;
  }
}

test("SaaS landing prompts produce an inferred bootstrap plan without template logging", async () => {
  const workspaceRoot = await makeWorkspace();
  try {
    const { result: blueprint, logs } = await captureLogs(() => buildFeatureBlueprint("Create a SaaS landing page", { workspaceRoot }));

    assert.equal(blueprint.bootstrapProfile.framework, "react-vite-ts");
    assert.equal(blueprint.productType, "saas_app");
    assert.equal(blueprint.validation.ok, true);
    assert.ok(blueprint.scaffoldPlan.length > 1);
    assert.ok(blueprint.filePlan.some(item => item.path === "package.json"));
    assert.ok(blueprint.filePlan.some(item => /src\/.+\.tsx$/i.test(item.path)));
    assert.ok(logs.some(line => line.includes("[FEATURE_BLUEPRINT_START]")));
    assert.ok(logs.some(line => line.includes("[BLUEPRINT_ARCHITECTURE_INFERRED]")));
    assert.ok(!logs.some(line => line.includes("[BLUEPRINT_TEMPLATE_SELECTED]")));
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("PHP landing prompts resolve to php-plain and keep PHP starter files", async () => {
  const workspaceRoot = await makeWorkspace();
  try {
    const blueprint = await buildFeatureBlueprint("Create a PHP landing page", { workspaceRoot });

    assert.equal(blueprint.bootstrapProfile.id, "php-plain");
    assert.equal(blueprint.validation.ok, true);
    assert.ok(blueprint.filePlan.some(item => item.path === "index.php"));
    assert.ok(blueprint.filePlan.some(item => item.path === "assets/css/style.css"));
    assert.ok(blueprint.filePlan.some(item => item.path === "assets/js/app.js"));
    assert.equal(blueprint.filePlan.some(item => /src\/.+\.tsx$/i.test(item.path)), false);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("Static HTML landing prompts resolve to generic-static-html with HTML starter files", async () => {
  const workspaceRoot = await makeWorkspace();
  try {
    const blueprint = await buildFeatureBlueprint("Create a static HTML landing page", { workspaceRoot });

    assert.equal(blueprint.bootstrapProfile.id, "generic-static-html");
    assert.equal(blueprint.validation.ok, true);
    assert.ok(blueprint.filePlan.some(item => item.path === "index.html"));
    assert.ok(blueprint.filePlan.some(item => item.path === "assets/css/style.css"));
    assert.ok(blueprint.filePlan.some(item => item.path === "assets/js/app.js"));
    assert.equal(blueprint.validation.command, "");
    assert.ok(Array.isArray(blueprint.validation.checks) && blueprint.validation.checks.length >= 2);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("REST API prompts resolve to node-express with server bootstrap files", async () => {
  const workspaceRoot = await makeWorkspace();
  try {
    const blueprint = await buildFeatureBlueprint("Create a REST API server", { workspaceRoot });

    assert.equal(blueprint.bootstrapProfile.id, "node-express");
    assert.equal(blueprint.validation.ok, true);
    assert.ok(blueprint.filePlan.some(item => item.path === "package.json"));
    assert.ok(blueprint.filePlan.some(item => item.path === "src/server.js"));
    assert.equal(blueprint.validation.command, "node --check src/server.js");
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("existing PHP workspaces stay on php-plain instead of React", async () => {
  const workspaceRoot = await makeWorkspace({
    "index.php": "<?php echo 'hello';",
    "assets/css/style.css": "body { margin: 0; }",
    "assets/js/app.js": "console.log('hi');"
  });

  try {
    const blueprint = await buildFeatureBlueprint("Create a landing page", { workspaceRoot });

    assert.equal(blueprint.bootstrapProfile.id, "php-plain");
    assert.equal(blueprint.bootstrapProfile.framework, "php-plain");
    assert.equal(blueprint.filePlan.some(item => /vite\.config/i.test(item.path)), false);
    assert.equal(blueprint.filePlan.some(item => /src\/main\.tsx$/i.test(item.path)), false);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("existing ASP.NET workspaces are detected and never coerced into React", async () => {
  const workspaceRoot = await makeWorkspace({
    "Project.csproj": "<Project></Project>",
    "Program.cs": "var builder = WebApplication.CreateBuilder(args);"
  });

  try {
    const blueprint = await buildFeatureBlueprint("Create an admin panel", { workspaceRoot });

    assert.equal(blueprint.bootstrapProfile.id, "aspnet-core");
    assert.equal(blueprint.metadata.bootstrapSupported, false);
    assert.equal(blueprint.filePlan.some(item => /vite\.config/i.test(item.path)), false);
    assert.equal(blueprint.filePlan.some(item => /src\/main\.tsx$/i.test(item.path)), false);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("blueprints serialize and reload without losing the inferred framework", async () => {
  const workspaceRoot = await makeWorkspace();

  try {
    const blueprint = await buildFeatureBlueprint("Create a SaaS landing page", { workspaceRoot });
    const savedPath = await serializeBlueprint(blueprint, { workspaceId: workspaceRoot });
    const loaded = await loadBlueprint(workspaceRoot);

    assert.equal(savedPath.endsWith("feature-blueprint.json"), true);
    assert.equal(loaded.bootstrapProfile.framework, "react-vite-ts");
    assert.equal(loaded.validation.ok, true);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
