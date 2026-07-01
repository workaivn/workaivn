import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildComponentTree,
  findCircular,
  findChildren,
  findComponent,
  findLayout,
  findRoute,
  findShared,
  findUnused,
  searchComponent
} from "./componentTree/index.js";

async function makeWorkspace(structure) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workai-component-tree-"));
  for (const [relativePath, content] of Object.entries(structure)) {
    const target = path.join(root, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }
  return root;
}

test("component tree resolves mixed-framework render graph, routes, layouts, shared nodes, and cycles", async () => {
  const workspaceRoot = await makeWorkspace({
    "src/App.tsx": `
      import Layout from "./components/Layout";
      import Home from "./pages/Home";
      import DynamicWidget from "./components/DynamicWidget";
      export default function App() {
        return <Layout><Home /><DynamicWidget /></Layout>;
      }
    `,
    "src/components/Layout.tsx": `
      import Navbar from "./Navbar";
      import Sidebar from "./Sidebar";
      import Footer from "./Footer";
      export default function Layout({ children }) {
        return <div><Navbar /><Sidebar /><main>{children}</main><Footer /></div>;
      }
    `,
    "src/components/Navbar.tsx": `
      import Button from "./Button";
      export default function Navbar() { return <nav><Button /><Button /></nav>; }
    `,
    "src/components/Sidebar.tsx": `
      import Menu from "./Menu";
      export default function Sidebar() { return <aside><Menu /></aside>; }
    `,
    "src/components/Menu.tsx": `
      import MenuItem from "./MenuItem";
      export default function Menu() { return <ul><MenuItem /></ul>; }
    `,
    "src/components/MenuItem.tsx": `
      export default function MenuItem() { return <li>Item</li>; }
    `,
    "src/components/Footer.tsx": `
      export default function Footer() { return <footer>Footer</footer>; }
    `,
    "src/components/Button.tsx": `
      export default function Button() { return <button>Click</button>; }
    `,
    "src/components/DynamicWidget.tsx": `
      export default function DynamicWidget() { return <section>Dynamic</section>; }
    `,
    "src/pages/Home.tsx": `
      import Button from "../components/Button";
      import { lazy, Suspense } from "react";
      const LazyWidget = lazy(() => import("../components/DynamicWidget"));
      export default function Home() {
        return <Suspense><Button /><LazyWidget /></Suspense>;
      }
    `,
    "src/components/CycleA.tsx": `
      import CycleB from "./CycleB";
      export default function CycleA() { return <CycleB />; }
    `,
    "src/components/CycleB.tsx": `
      import CycleC from "./CycleC";
      export default function CycleB() { return <CycleC />; }
    `,
    "src/components/CycleC.tsx": `
      import CycleA from "./CycleA";
      export default function CycleC() { return <CycleA />; }
    `,
    "app/layout.tsx": `
      export default function RootLayout({ children }) { return <html><body>{children}</body></html>; }
    `,
    "app/users/page.tsx": `
      export default function UsersPage() { return <div>Users</div>; }
    `,
    "pages/index.vue": `
      <template><Layout><Navbar /><SharedButton /></Layout></template>
      <script setup>
      import Layout from "../layouts/default.vue";
      import Navbar from "../components/Navbar.vue";
      import SharedButton from "../components/SharedButton.vue";
      </script>
    `,
    "layouts/default.vue": `
      <template><main><slot /></main></template>
    `,
    "components/Navbar.vue": `
      <template><nav><SharedButton /></nav></template>
      <script setup>import SharedButton from "./SharedButton.vue";</script>
    `,
    "components/SharedButton.vue": `
      <template><button>Vue</button></template>
    `,
    "src/app/app.component.ts": `
      import { Component } from "@angular/core";
      @Component({
        selector: "app-root",
        templateUrl: "./app.component.html"
      })
      export class AppComponent {}
    `,
    "src/app/app.component.html": `
      <app-navbar></app-navbar>
    `,
    "src/app/navbar.component.ts": `
      import { Component } from "@angular/core";
      @Component({ selector: "app-navbar", template: "<div>Nav</div>" })
      export class NavbarComponent {}
    `,
    "src/routes/+page.svelte": `
      <script>
        import SharedButton from "../lib/SharedButton.svelte";
        import { onMount } from "svelte";
      </script>
      <SharedButton />
    `,
    "src/lib/SharedButton.svelte": `
      <button>Svelte</button>
    `,
    "src/pages/index.astro": `
      ---
      import AstroWidget from "../components/AstroWidget.astro";
      ---
      <AstroWidget />
    `,
    "src/components/AstroWidget.astro": `
      <section>Astro</section>
    `,
    "index.php": `<?php include "partials/header.php"; echo "PHP"; ?>`,
    "partials/header.php": `<?php echo "Header"; ?>`,
    "views/base.blade.php": `@include('partials.navbar')`,
    "views/partials/navbar.blade.php": `<nav>Blade</nav>`,
    "templates/base.twig": `{% include "partials/nav.twig" %}`,
    "templates/partials/nav.twig": `<nav>Twig</nav>`,
    "Views/Home.cshtml": `@await Html.PartialAsync("_Nav")`,
    "Views/Shared/_Nav.cshtml": `<nav>Razor</nav>`,
    "src/main.jsp": `<jsp:include page="/WEB-INF/jsp/header.jsp" />`,
    "WEB-INF/jsp/header.jsp": `<div>JSP</div>`,
    "templates/index.html": `<include src="./partials/card.html"></include>`,
    "templates/partials/card.html": `<div>HTML include</div>`,
    "app.py": `from flask import render_template\n`,
    "templates/index.html.jinja": `{% extends "base.html" %}{% include "partials/card.html" %}`,
    "components/Unused.tsx": `export default function Unused() { return <div>Unused</div>; }`
  });

  try {
    const tree = await buildComponentTree(workspaceRoot);

    assert.ok(tree.components.length > 0);
    assert.ok(findComponent(tree, "Layout"));
    assert.ok(findChildren(tree, "src/components/Layout.tsx").some(node => node.name === "Navbar"));
    assert.ok(findRoute(tree, "/users"));
    assert.ok(findLayout(tree, "Layout"));
    assert.ok(findShared(tree).some(node => node.name === "Button"));
    assert.ok(findUnused(tree).some(node => node.name === "Unused"));
    assert.ok(findCircular(tree).some(node => ["CycleA", "CycleB", "CycleC"].includes(node.name)));
    assert.ok(searchComponent(tree, "DynamicWidget").length > 0);

    const appNode = findComponent(tree, "src/App.tsx");
    assert.equal(appNode?.dynamic, true);
    assert.equal(appNode?.framework, "react");
    assert.equal(findComponent(tree, "app/layout.tsx")?.framework, "next");
    assert.equal(findComponent(tree, "components/Navbar.vue")?.framework, "vue");
    assert.equal(findComponent(tree, "src/app/app.component.ts")?.framework, "angular");
    assert.equal(findComponent(tree, "src/routes/+page.svelte")?.framework, "svelte");
    assert.equal(findComponent(tree, "src/components/AstroWidget.astro")?.framework, "astro");
    assert.equal(findComponent(tree, "src/pages/Home.tsx")?.framework, "react");
    assert.ok(tree.root.length > 0);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("component tree persists and reloads serialized output", async () => {
  const workspaceRoot = await makeWorkspace({
    "src/App.tsx": `export default function App() { return <div>Hello</div>; }`
  });

  try {
    const tree = await buildComponentTree(workspaceRoot);
    const loaded = await (await import("./componentTree/index.js")).loadComponentTree(workspaceRoot);
    assert.equal(loaded?.components?.length, tree.components.length);
    assert.equal(loaded?.version, tree.version);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("component tree incremental rebuild reuses unchanged file analysis", async () => {
  const workspaceRoot = await makeWorkspace({
    "src/App.tsx": `import Layout from "./Layout"; export default function App() { return <Layout />; }`,
    "src/Layout.tsx": `export default function Layout({ children }) { return <main>{children}</main>; }`
  });

  try {
    const first = await buildComponentTree(workspaceRoot);
    await fs.writeFile(path.join(workspaceRoot, "src", "Layout.tsx"), `export default function Layout({ children }) { return <section>{children}</section>; }`, "utf8");
    const second = await buildComponentTree(workspaceRoot);
    assert.equal(first.summary.componentCount, second.summary.componentCount);
    assert.ok(second.summary.reusedCount >= 1);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
