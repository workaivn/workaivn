import { listWorkspaceFiles } from "./workspace.js";

export async function scanProject(workspaceRoot, { limit = 5000 } = {}) {
  const files = await listWorkspaceFiles(workspaceRoot, { limit }).catch(() => []);
  const lower = new Set(files.map(f => f.toLowerCase()));

  function has(pattern) {
    const rx = typeof pattern === "string" ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : pattern;
    return files.some(f => rx.test(f));
  }

  let projectType = "generic";
  if (has(/package\.json$/)) {
    if (has(/next\.config\.(js|mjs|cjs|ts)$/) || has(/^pages\//i)) projectType = "next";
    else if (has(/vite\.config\.(js|ts)$/)) projectType = "vite";
    else projectType = "node_react";
  } else if (has(/composer\.json$/) || has(/\.php$/)) {
    projectType = "php";
  } else if (has(/\.csproj$/) || has(/web\.config$/) || has(/\.(aspx|cshtml)$/)) {
    projectType = "aspnet";
  } else if (has(/pubspec\.yaml$/) || has(/^lib\/main\.dart$/i)) {
    projectType = "flutter";
  } else if (has(/requirements\.txt$/) || has(/pyproject\.toml$/) || has(/\.py$/)) {
    projectType = "python";
  } else if (has(/^index\.html$/i) || has(/^public\/index\.html$/i)) {
    projectType = "static_html";
  }

  let packageManager = null;
  if (lower.has("package-lock.json")) packageManager = "npm";
  else if (lower.has("yarn.lock")) packageManager = "yarn";
  else if (lower.has("pnpm-lock.yaml")) packageManager = "pnpm";

  const entryFiles = [];
  if (projectType === "node_react" || projectType === "vite") {
    [
      "src/App.jsx", "src/App.tsx", "src/index.jsx", "src/main.jsx", "src/main.tsx",
      "src/index.tsx", "src/App.js", "src/index.js"
    ].forEach(f => { if (lower.has(f.toLowerCase())) entryFiles.push(f); });
  } else if (projectType === "next") {
    ["pages/index.js", "pages/index.tsx", "app/page.tsx", "app/page.js"].forEach(f => { if (lower.has(f.toLowerCase())) entryFiles.push(f); });
  } else if (projectType === "php") {
    ["index.php"].forEach(f => { if (lower.has(f.toLowerCase())) entryFiles.push(f); });
  } else if (projectType === "aspnet") {
    const asp = files.filter(f => /\.(aspx|cshtml)$/i.test(f));
    entryFiles.push(...asp.slice(0, 3));
  } else if (projectType === "flutter") {
    if (lower.has("lib/main.dart")) entryFiles.push("lib/main.dart");
  } else if (projectType === "python") {
    const py = files.filter(f => /\.py$/i.test(f));
    entryFiles.push(...py.slice(0, 3));
  } else if (projectType === "static_html") {
    if (lower.has("index.html")) entryFiles.push("index.html");
  }

  const styleFiles = files.filter(f => /\.(css|scss|sass)$/i.test(f)).slice(0, 5);

  const testCommands = [];
  const buildCommands = [];
  const runCommands = [];
  if (projectType.startsWith("node") || projectType === "vite" || projectType === "next") {
    if (packageManager) {
      testCommands.push(`${packageManager} test`);
      buildCommands.push(`${packageManager} run build`);
      runCommands.push(`${packageManager} start`);
    }
  } else if (projectType === "flutter") {
    testCommands.push("flutter test");
    buildCommands.push("flutter build");
    runCommands.push("flutter run");
  }

  return { projectType, packageManager, entryFiles, styleFiles, testCommands, buildCommands, runCommands };
}
