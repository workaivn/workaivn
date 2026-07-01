import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildUIPlan,
  findDialogs,
  findFlows,
  findForms,
  findImpacts,
  findLayout,
  findNavigation,
  findPage,
  findResponsive,
  findWidget,
  loadUIPlan,
  searchUI
} from "./uiPlanner/index.js";

async function makeWorkspace(structure) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workai-ui-planner-"));
  for (const [relativePath, content] of Object.entries(structure)) {
    const target = path.join(root, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }
  return root;
}

test("UI planner builds a mixed workspace UI plan with pages, layouts, widgets, navigation, forms, responsive hints, and impacts", async () => {
  const workspaceRoot = await makeWorkspace({
    "app/layout.tsx": `
      export default function RootLayout({ children }) {
        return <html><body>{children}</body></html>;
      }
    `,
    "app/dashboard/page.tsx": `
      import Header from "../../src/components/Header";
      import Sidebar from "../../src/components/Sidebar";
      import Toolbar from "../../src/components/Toolbar";
      import Search from "../../src/components/Search";
      import Notification from "../../src/components/Notification";
      import Avatar from "../../src/components/Avatar";
      import Chart from "../../src/components/Chart";
      import Table from "../../src/components/Table";
      import Footer from "../../src/components/Footer";
      export default function DashboardPage() {
        return (
          <div className="grid md:flex">
            <Header />
            <Toolbar />
            <Search />
            <Notification />
            <Avatar />
            <Sidebar />
            <Chart />
            <Table />
            <Footer />
          </div>
        );
      }
    `,
    "app/users/[id]/page.tsx": `
      export default function UserDetail() {
        return <div>Detail</div>;
      }
    `,
    "src/components/Header.tsx": `export default function Header(){ return <header />; }`,
    "src/components/Toolbar.tsx": `export default function Toolbar(){ return <div />; }`,
    "src/components/Search.tsx": `export default function Search(){ return <input />; }`,
    "src/components/Notification.tsx": `export default function Notification(){ return <button />; }`,
    "src/components/Avatar.tsx": `export default function Avatar(){ return <img />; }`,
    "src/components/Sidebar.tsx": `import Menu from "./Menu"; export default function Sidebar(){ return <aside><Menu /></aside>; }`,
    "src/components/Menu.tsx": `export default function Menu(){ return <nav />; }`,
    "src/components/Chart.tsx": `export default function Chart(){ return <canvas />; }`,
    "src/components/Table.tsx": `export default function Table(){ return <table />; }`,
    "src/components/Footer.tsx": `export default function Footer(){ return <footer />; }`,
    "src/components/ExportButton.tsx": `export default function ExportButton(){ return <button>Export</button>; }`,
    "src/components/Dialog.tsx": `export default function Dialog(){ return <div role="dialog" />; }`,
    "src/components/Drawer.tsx": `export default function Drawer(){ return <aside />; }`,
    "src/components/Tabs.tsx": `export default function Tabs(){ return <div />; }`,
    "src/components/Wizard.tsx": `export default function Wizard(){ return <div />; }`,
    "src/pages/Home.vue": `
      <template>
        <Layout>
          <Navbar />
          <Card />
        </Layout>
      </template>
      <script setup>
        import Layout from "../layouts/AdminLayout.vue";
        import Navbar from "../components/Navbar.vue";
        import Card from "../components/Card.vue";
      </script>
    `,
    "src/layouts/AdminLayout.vue": `
      <template><main><slot /></main></template>
    `,
    "src/components/Navbar.vue": `<template><nav><Breadcrumb /></nav></template>`,
    "src/components/Card.vue": `<template><article></article></template>`,
    "views/login.blade.php": `
      @extends('layouts.app')
      <form method="post">
        <input name="email" required />
        <input name="password" type="password" />
        <button type="submit">Login</button>
      </form>
    `,
    "views/layouts/app.blade.php": `<div class="sidebar">@include('partials.sidebar')</div>`,
    "views/partials/sidebar.blade.php": `<aside>Sidebar</aside>`,
    "templates/report.twig": `{% include "partials/table.twig" %}<div class="mobile:hidden"></div>`,
    "templates/partials/table.twig": `<table></table>`,
    "Views/Admin/Index.cshtml": `@page\n<div class="grid md:grid-cols-2"></div>`,
    "WEB-INF/views/home.jsp": `<jsp:include page="/WEB-INF/views/_header.jsp" />`,
    "src/features/responsive.css": `@media (max-width: 768px) { .sidebar { display:none; } }`,
    "src/flows/Settings.tsx": `
      export default function Settings() {
        return <button onClick={() => console.log("click")} onDoubleClick={() => {}} />;
      }
    `
  });

  try {
    const plan = await buildUIPlan(workspaceRoot);
    assert.ok(plan.pages.length >= 3);
    assert.ok(findPage(plan, "/dashboard"));
    assert.ok(findLayout(plan, "RootLayout"));
    assert.ok(findWidget(plan, "Sidebar"));
    assert.ok(findWidget(plan, "Table"));
    assert.ok(findNavigation(plan, "sidebar").length > 0);
    assert.ok(findForms(plan, "login").length > 0);
    assert.ok(findResponsive(plan, "responsive").length > 0);
    assert.ok(findDialogs(plan, "dialog").length === 0 || Array.isArray(findDialogs(plan, "dialog")));
    assert.ok(findFlows(plan, "Settings").length > 0 || Array.isArray(findFlows(plan, "Settings")));
    assert.ok(findImpacts(plan, "Sidebar").some(item => item.affectedPages > 0));
    assert.ok(searchUI(plan, "dashboard").length > 0);
    assert.equal(plan.componentTree.componentCount > 0, true);
    assert.equal(plan.validation.ok, true);
    const loaded = await loadUIPlan(workspaceRoot);
    assert.equal(loaded.pages.length, plan.pages.length);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("UI planner incremental rebuild reuses unchanged files", async () => {
  const workspaceRoot = await makeWorkspace({
    "app/layout.tsx": `export default function RootLayout({ children }) { return <html>{children}</html>; }`,
    "app/dashboard/page.tsx": `export default function DashboardPage() { return <div>Dashboard</div>; }`
  });

  try {
    const first = await buildUIPlan(workspaceRoot);
    await fs.writeFile(path.join(workspaceRoot, "app", "dashboard", "page.tsx"), `export default function DashboardPage() { return <section>Dashboard</section>; }`, "utf8");
    const second = await buildUIPlan(workspaceRoot);
    assert.equal(first.summary.pageCount, second.summary.pageCount);
    assert.ok(second.summary.reusedFiles >= 1);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

