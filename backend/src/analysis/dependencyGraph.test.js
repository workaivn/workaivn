import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildDependencyGraph,
  findCircular,
  findCriticalNodes,
  findDatabaseChain,
  findDependencies,
  findDependents,
  findImpact,
  findRuntimeChain,
  findUnused,
  loadDependencyGraph,
  saveDependencyGraph,
  searchDependency
} from "./dependencyGraph/index.js";

async function makeWorkspace(structure = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workai-dependency-"));
  for (const [relativePath, content] of Object.entries(structure)) {
    const target = path.join(root, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }
  return root;
}

test("dependency graph resolves mixed-framework dependencies, cycles, runtime, database, state, and assets", async () => {
  const workspaceRoot = await makeWorkspace({
    "package.json": JSON.stringify({
      name: "demo-app",
      private: true,
      scripts: {
        build: "vite build",
        test: "node --test"
      },
      dependencies: {
        react: "^18.0.0",
        express: "^4.18.2",
        redux: "^5.0.0",
        vuex: "^4.1.0",
        mongoose: "^8.0.0",
        "socket.io": "^4.0.0"
      }
    }, null, 2),
    "packages/shared/package.json": JSON.stringify({
      name: "@acme/shared",
      version: "1.0.0"
    }, null, 2),
    "packages/shared/src/index.js": `export const shared = () => "shared";`,
    "src/App.tsx": `
      import Header from "./components/Header";
      import store from "./state/store";
      import { shared } from "@acme/shared";
      import "./assets/style.css";
      const LazyWidget = lazy(() => import("./components/HeavyWidget"));
      export default function App() {
        return <main><Header /><LazyWidget />{shared()}</main>;
      }
    `,
    "src/components/Header.tsx": `
      import Button from "./Button";
      export default function Header() { return <header><Button /></header>; }
    `,
    "src/components/Button.tsx": `
      import Icon from "./Icon";
      export default function Button() { return <button><Icon /></button>; }
    `,
    "src/components/Icon.tsx": `
      import Tooltip from "./Tooltip";
      export default function Icon() { return <span><Tooltip /></span>; }
    `,
    "src/components/Tooltip.tsx": `
      import Button from "./Button";
      export default function Tooltip() { return <small><Button /></small>; }
    `,
    "src/components/HeavyWidget.tsx": `export default function HeavyWidget() { return <section />; }`,
    "src/components/Unused.tsx": `export default function Unused() { return <div />; }`,
    "src/state/store.ts": `
      import { configureStore } from "@reduxjs/toolkit";
      export default configureStore({ reducer: {} });
    `,
    "src/state/context.tsx": `import { createContext } from "react"; export const AppContext = createContext(null);`,
    "src/assets/style.css": `body { background: url("./logo.svg"); }`,
    "src/assets/logo.svg": `<svg xmlns="http://www.w3.org/2000/svg"></svg>`,
    "app/layout.tsx": `export default function RootLayout({ children }) { return <html><body>{children}</body></html>; }`,
    "app/users/page.tsx": `export default function UsersPage() { return <div>Users</div>; }`,
    "src/components/VueShell.vue": `<template><VueButton /></template><script setup>import VueButton from "./VueButton.vue";</script>`,
    "src/components/VueButton.vue": `<template><button>Vue</button></template>`,
    "src/app/app.component.ts": `import { Component } from "@angular/core"; @Component({ selector: "app-root", templateUrl: "./app.component.html" }) export class AppComponent {}`,
    "src/app/app.component.html": `<app-navbar></app-navbar>`,
    "src/app/navbar.component.ts": `import { Component } from "@angular/core"; @Component({ selector: "app-navbar", template: "<div>Nav</div>" }) export class NavbarComponent {}`,
    "src/routes/+page.svelte": `<script>import SharedButton from "../lib/SharedButton.svelte";</script><SharedButton />`,
    "src/lib/SharedButton.svelte": `<button>Svelte</button>`,
    "index.php": `<?php include "partials/header.php"; ?><link rel="stylesheet" href="assets/style.css" /><script src="assets/app.js"></script>`,
    "partials/header.php": `<?php echo "Header"; ?>`,
    "routes/web.php": `<?php use App\\Http\\Controllers\\UserController; Route::get("/users", [UserController::class, "index"]);`,
    "app/Http/Controllers/UserController.php": `<?php namespace App\\Http\\Controllers; use App\\Services\\UserService; class UserController { public function index(UserService $service) { return $service->all(); } }`,
    "app/Services/UserService.php": `<?php namespace App\\Services; use App\\Repositories\\UserRepository; class UserService { public function all() { return (new UserRepository())->all(); } }`,
    "app/Repositories/UserRepository.php": `<?php namespace App\\Repositories; use App\\Models\\User; class UserRepository { public function all() { return User::query()->whereRaw("select * from users")->get(); } }`,
    "app/Models/User.php": `<?php namespace App\\Models; class User {}`,
    "Views/Home/Index.cshtml": `@page\n@await Html.PartialAsync("_Layout")`,
    "Views/Shared/_Layout.cshtml": `<div>Razor</div>`,
    "WEB-INF/views/home.jsp": `<jsp:include page="/WEB-INF/views/_header.jsp" />`,
    "WEB-INF/views/_header.jsp": `<div>JSP</div>`,
    "app.py": `from flask import Flask\napp = Flask(__name__)`,
    "templates/index.html.jinja": `{% extends "base.html" %}`,
    "server.js": `const express = require("express"); const { Server } = require("socket.io"); const app = express();`,
    "src/worker.js": `export function runWorker() { return "worker"; }`,
    "src/queue/job.js": `import { runWorker } from "../worker"; export function enqueue() { return runWorker(); }`,
    "src/cron/scheduler.js": `import { enqueue } from "../queue/job"; export function schedule() { return enqueue(); }`,
    "src/api/rest.ts": `export async function handler(req, res) { return res.json({ ok: true }); }`,
    "src/api/graphql.ts": `export const typeDefs = "type Query { ok: Boolean }";`,
    "src/api/ws.ts": `export function connect() { return new WebSocket("ws://localhost"); }`
  });

  try {
    const graph = await buildDependencyGraph(workspaceRoot);

    assert.equal(graph.validation.ok, true);
    assert.ok(graph.nodes.length > 0);
    assert.ok(graph.edges.length > 0);

    const frameworks = new Set(graph.nodes.map(node => node.framework).filter(Boolean));
    for (const framework of ["react", "next", "vue", "angular", "svelte", "php", "razor", "jsp", "flask"]) {
      assert.ok(frameworks.has(framework), `expected framework ${framework}`);
    }

    const types = new Set(graph.nodes.map(node => node.type));
    for (const type of ["component", "service", "repository", "model", "database", "runtime", "state", "build", "api", "package"]) {
      assert.ok(types.has(type), `expected node type ${type}`);
    }

    const circular = findCircular(graph).map(node => node.path || node.id);
    assert.ok(circular.some(path => path.includes("Button.tsx")));
    assert.ok(circular.some(path => path.includes("Tooltip.tsx")));

    const appDeps = findDependencies(graph, "src/App.tsx").map(node => node.path || node.id);
    assert.ok(appDeps.some(item => item.includes("Header.tsx")));
    assert.ok(appDeps.some(item => item.includes("state/store.ts")));
    assert.ok(appDeps.some(item => String(item).startsWith("package:@acme/shared")));

    const buttonDependents = findDependents(graph, "src/components/Button.tsx").map(node => node.path || node.id);
    assert.ok(buttonDependents.some(item => item.includes("Header.tsx")));
    assert.ok(buttonDependents.some(item => item.includes("Tooltip.tsx")));

    const critical = findCriticalNodes(graph, 5);
    assert.ok(critical.length > 0);
    assert.ok(critical[0].criticalScore >= critical.at(-1).criticalScore);

    const impact = findImpact(graph, "app/Models/User.php").map(node => node.path || node.id);
    assert.ok(impact.some(item => item.includes("UserRepository.php")));
    assert.ok(impact.some(item => item.includes("UserService.php")));
    assert.ok(impact.some(item => item.includes("UserController.php")));

    const runtimeChain = findRuntimeChain(graph, "src/worker.js").map(node => node.path || node.id);
    assert.ok(runtimeChain.some(item => item.includes("worker.js")));

    const databaseChain = findDatabaseChain(graph, "app/Models/User.php").map(node => node.path || node.id);
    assert.ok(databaseChain.some(item => item.includes("UserRepository.php")));
    assert.ok(databaseChain.some(item => item.includes("User.php")));

    const stateHits = searchDependency(graph, "redux").map(node => node.path || node.id);
    assert.ok(stateHits.some(item => item.includes("state/store.ts")));

    const unused = findUnused(graph).map(node => node.path || node.id);
    assert.ok(unused.some(item => item.includes("Unused.tsx")));

    const savedPath = await saveDependencyGraph(workspaceRoot, graph);
    const loaded = await loadDependencyGraph(workspaceRoot);
    assert.equal(savedPath.endsWith("dependency-graph.json"), true);
    assert.equal(loaded.summary.nodeCount, graph.summary.nodeCount);
    assert.equal(loaded.summary.edgeCount, graph.summary.edgeCount);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("dependency graph incremental rebuild reuses unchanged files", async () => {
  const workspaceRoot = await makeWorkspace({
    "package.json": JSON.stringify({ name: "demo-app", dependencies: { react: "^18.0.0" } }, null, 2),
    "src/App.tsx": `import Header from "./Header"; export default function App() { return <Header />; }`,
    "src/Header.tsx": `export default function Header() { return <header />; }`
  });

  try {
    const first = await buildDependencyGraph(workspaceRoot);
    await fs.writeFile(path.join(workspaceRoot, "src", "Header.tsx"), `export default function Header() { return <section />; }`, "utf8");
    const second = await buildDependencyGraph(workspaceRoot);

    assert.equal(first.summary.nodeCount, second.summary.nodeCount);
    assert.ok(second.summary.reusedFiles >= 1);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
