import test from "node:test";
import assert from "node:assert/strict";
import { createBootstrapTaskGraph, detectProjectIntent, resolveBootstrapProfile } from "../projectIntelligence/index.js";
import { createRuntimePlan } from "../projectIntelligence/runtimePlanningIntelligence.js";

function emptyWorkspaceState(existingFiles = []) {
  return {
    existingFiles,
    hasPackageJson: existingFiles.some(file => file === "package.json"),
    hasIndexPhp: existingFiles.some(file => /(^|\/)index\.php$/i.test(file)),
    hasCsproj: existingFiles.some(file => /\.csproj$/i.test(file)),
    hasLaravel: false,
    hasFastapi: false,
    hasFlask: false,
    hasFlutter: false,
    hasReactVite: existingFiles.some(file => /(^|\/)(vite\.config\.(?:ts|js)|src\/main\.(?:tsx|jsx)|src\/App\.(?:tsx|jsx))$/i.test(file)),
    hasNext: existingFiles.some(file => /(^|\/)(next\.config\.(?:js|ts)|app\/page\.(?:tsx|jsx)|pages\/index\.(?:tsx|jsx))$/i.test(file)),
    hasNodeExpress: existingFiles.some(file => /(^|\/)(src\/server\.js|server\.js)$/i.test(file)),
    hasStaticHtml: existingFiles.some(file => /(^|\/)(index\.html|public\/index\.html)$/i.test(file)),
    scan: { projectType: "generic", packageManager: "npm", entryFiles: [], testCommands: [], buildCommands: [], runCommands: [] }
  };
}

test("runtime planning resolves react-vite-ts for a SaaS landing page and creates a multi-stage graph", () => {
  const intent = detectProjectIntent("Create a SaaS landing page");
  const workspaceState = emptyWorkspaceState();
  const profile = resolveBootstrapProfile(intent, workspaceState);
  const runtimePlan = createRuntimePlan({
    prompt: intent.prompt,
    projectScan: workspaceState.scan,
    workspaceState,
    projectIntent: intent,
    bootstrapProfile: profile
  });

  const graph = createBootstrapTaskGraph(profile, {
    objective: intent.objective,
    projectIntent: intent,
    workspaceState
  });

  assert.equal(runtimePlan.goalType, "SAAS_APP");
  assert.equal(runtimePlan.targetProfile.id, "react-vite-ts");
  assert.ok(runtimePlan.filePlan.length > 1);
  assert.ok(runtimePlan.filePlan.some(file => file.path === "src/App.tsx"));
  assert.ok(runtimePlan.filePlan.some(file => file.path === "src/components/sections/HeroSection.tsx"));
  assert.ok(runtimePlan.executionPlan.validationCommands.includes("npm run build"));
  assert.ok(graph.tasks.length > 1);
  assert.ok(graph.tasks.some(task => task.goal === "ANALYZE_WORKSPACE"));
  assert.ok(graph.tasks.some(task => task.tool === "LIST_FILES"));
});

test("provider failure still yields deterministic skeleton files", () => {
  const intent = detectProjectIntent("Create a SaaS landing page");
  const workspaceState = emptyWorkspaceState();
  const profile = resolveBootstrapProfile(intent, workspaceState);
  const runtimePlan = createRuntimePlan({
    prompt: intent.prompt,
    projectScan: workspaceState.scan,
    workspaceState,
    projectIntent: intent,
    bootstrapProfile: profile,
    failure: { message: "provider failed" }
  });

  assert.ok(runtimePlan.filePlan.some(file => file.path === "package.json"));
  assert.ok(runtimePlan.filePlan.some(file => file.path === "src/App.tsx"));
  assert.ok(runtimePlan.filePlan.some(file => file.path === "src/components/layout/Layout.tsx"));
  assert.ok(runtimePlan.validationPlan.commands.includes("npm run build"));
});

test("PHP landing page uses php-plain and emits PHP starter files", () => {
  const intent = detectProjectIntent("Create a PHP landing page");
  const workspaceState = emptyWorkspaceState();
  const profile = resolveBootstrapProfile(intent, workspaceState);
  const runtimePlan = createRuntimePlan({
    prompt: intent.prompt,
    projectScan: workspaceState.scan,
    workspaceState,
    projectIntent: intent,
    bootstrapProfile: profile
  });

  assert.equal(runtimePlan.targetProfile.id, "php-plain");
  assert.ok(runtimePlan.filePlan.some(file => file.path === "index.php"));
  assert.ok(runtimePlan.filePlan.some(file => file.path === "assets/css/style.css"));
  assert.ok(runtimePlan.filePlan.some(file => file.path === "assets/js/app.js"));
  assert.equal(runtimePlan.filePlan.some(file => /src\/App\.tsx$/i.test(file.path)), false);
});

test("static HTML landing page uses generic-static-html and emits HTML starter files", () => {
  const intent = detectProjectIntent("Create a static HTML landing page");
  const workspaceState = emptyWorkspaceState();
  const profile = resolveBootstrapProfile(intent, workspaceState);
  const runtimePlan = createRuntimePlan({
    prompt: intent.prompt,
    projectScan: workspaceState.scan,
    workspaceState,
    projectIntent: intent,
    bootstrapProfile: profile
  });

  assert.equal(runtimePlan.targetProfile.id, "generic-static-html");
  assert.ok(runtimePlan.filePlan.some(file => file.path === "index.html"));
  assert.ok(runtimePlan.filePlan.some(file => file.path === "assets/css/style.css"));
  assert.ok(runtimePlan.filePlan.some(file => file.path === "assets/js/app.js"));
});

test("REST API server defaults to node-express and validates server syntax", () => {
  const intent = detectProjectIntent("Create a REST API server");
  const workspaceState = emptyWorkspaceState();
  const profile = resolveBootstrapProfile(intent, workspaceState);
  const runtimePlan = createRuntimePlan({
    prompt: intent.prompt,
    projectScan: workspaceState.scan,
    workspaceState,
    projectIntent: intent,
    bootstrapProfile: profile
  });

  assert.equal(runtimePlan.targetProfile.id, "node-express");
  assert.ok(runtimePlan.filePlan.some(file => file.path === "package.json"));
  assert.ok(runtimePlan.filePlan.some(file => file.path === "src/server.js"));
  assert.ok(runtimePlan.validationPlan.commands.includes("node --check src/server.js"));
});

test("existing PHP projects keep php-plain and do not bootstrap React", () => {
  const intent = detectProjectIntent("Create a landing page");
  const workspaceState = emptyWorkspaceState(["index.php", "assets/css/style.css"]);
  const profile = resolveBootstrapProfile(intent, workspaceState);
  const runtimePlan = createRuntimePlan({
    prompt: intent.prompt,
    projectScan: workspaceState.scan,
    workspaceState,
    projectIntent: intent,
    bootstrapProfile: profile
  });

  assert.equal(runtimePlan.targetProfile.id, "php-plain");
  assert.equal(runtimePlan.filePlan.some(file => /src\/App\.tsx$/i.test(file.path)), false);
  assert.equal(runtimePlan.filePlan.some(file => /src\/components\/navigation\/Navbar\.tsx$/i.test(file.path)), false);
});

test("existing ASP.NET projects resolve aspnet-core instead of React", () => {
  const intent = detectProjectIntent("Create a landing page");
  const workspaceState = emptyWorkspaceState(["Project.csproj"]);
  const profile = resolveBootstrapProfile(intent, workspaceState);
  const runtimePlan = createRuntimePlan({
    prompt: intent.prompt,
    projectScan: workspaceState.scan,
    workspaceState,
    projectIntent: intent,
    bootstrapProfile: profile
  });

  assert.equal(runtimePlan.targetProfile.id, "aspnet-core");
  assert.equal(runtimePlan.filePlan.some(file => /src\/App\.tsx$/i.test(file.path)), false);
  assert.equal(runtimePlan.filePlan.some(file => /src\/components\/navigation\/Navbar\.tsx$/i.test(file.path)), false);
});

test("read-only prompt does not bootstrap or install", () => {
  const intent = detectProjectIntent("Read package.json and show package name");
  const workspaceState = emptyWorkspaceState();
  const runtimePlan = createRuntimePlan({
    prompt: intent.prompt,
    projectScan: workspaceState.scan,
    workspaceState,
    projectIntent: intent
  });

  assert.equal(runtimePlan.goalType, "READ_ONLY");
  assert.deepEqual(runtimePlan.filePlan, []);
  assert.deepEqual(runtimePlan.installCommands, []);
  assert.deepEqual(runtimePlan.buildCommands, []);
  assert.deepEqual(runtimePlan.validationPlan.commands, []);
});

test("build failure reflection selects deterministic dependency repair", () => {
  const intent = detectProjectIntent("Create a SaaS landing page");
  const workspaceState = emptyWorkspaceState();
  const profile = resolveBootstrapProfile(intent, workspaceState);
  const runtimePlan = createRuntimePlan({
    prompt: intent.prompt,
    projectScan: workspaceState.scan,
    workspaceState,
    projectIntent: intent,
    bootstrapProfile: profile,
    failure: { message: "Cannot find module lucide-react" }
  });

  assert.equal(runtimePlan.repairPlan.repairType, "missing_dependency");
  assert.equal(runtimePlan.repairPlan.action, "install_dependency");
  assert.equal(runtimePlan.repairPlan.tool, "RUN_TERMINAL");
});

test("missing build script selects package.json repair", () => {
  const intent = detectProjectIntent("Create a SaaS landing page");
  const workspaceState = emptyWorkspaceState();
  const profile = resolveBootstrapProfile(intent, workspaceState);
  const runtimePlan = createRuntimePlan({
    prompt: intent.prompt,
    projectScan: workspaceState.scan,
    workspaceState,
    projectIntent: intent,
    bootstrapProfile: profile,
    failure: { message: "Missing script: build" }
  });

  assert.equal(runtimePlan.repairPlan.repairType, "missing_script");
  assert.equal(runtimePlan.repairPlan.action, "patch_package_json");
  assert.equal(runtimePlan.repairPlan.retryCommand, "npm run build");
});

test("component planning captures parent-child and shared component anatomy", () => {
  const intent = detectProjectIntent("Create a SaaS landing page");
  const workspaceState = emptyWorkspaceState();
  const profile = resolveBootstrapProfile(intent, workspaceState);
  const runtimePlan = createRuntimePlan({
    prompt: intent.prompt,
    projectScan: workspaceState.scan,
    workspaceState,
    projectIntent: intent,
    bootstrapProfile: profile
  });

  const layout = runtimePlan.componentPlan.components.find(component => component.name === "Layout");
  const navbar = runtimePlan.componentPlan.components.find(component => component.name === "Navbar");

  assert.ok(layout);
  assert.ok(navbar);
  assert.ok(layout.children.length > 0);
  assert.equal(navbar.shared, true);
  assert.ok(runtimePlan.componentPlan.shared.some(component => component.name === "Navbar"));
});

