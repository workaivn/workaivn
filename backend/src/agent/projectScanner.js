import fs from "node:fs/promises";
import { listWorkspaceFiles } from "./workspace.js";

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").trim();
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function hasAnyFile(files, candidates) {
  const lower = new Set(files.map(file => normalizePath(file).toLowerCase()));
  return candidates.some(candidate => lower.has(normalizePath(candidate).toLowerCase()));
}

async function readJsonFile(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readWorkspacePackageJson(workspaceRoot) {
  return readJsonFile(`${workspaceRoot}/package.json`);
}

function getDependencyNames(pkg = {}) {
  return new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
    ...Object.keys(pkg.peerDependencies || {}),
    ...Object.keys(pkg.optionalDependencies || {})
  ].map(name => String(name || "").toLowerCase()));
}

function hasReactDependency(pkg = {}) {
  const dependencies = getDependencyNames(pkg);
  return dependencies.has("react") || dependencies.has("react-dom");
}

async function hasReactImportEvidence(workspaceRoot, files) {
  const candidates = [
    "src/main.jsx",
    "src/main.tsx",
    "src/index.jsx",
    "src/index.tsx"
  ];

  for (const candidate of candidates) {
    if (!hasAnyFile(files, [candidate])) continue;
    try {
      const content = await fs.readFile(`${workspaceRoot}/${candidate}`, "utf8");
      if (/\bimport\s+react\b/i.test(content) || /\bfrom\s+['"]react['"]/i.test(content) || /\brequire\(\s*['"]react['"]\s*\)/i.test(content)) {
        return true;
      }
    } catch {
      // ignore unreadable files
    }
  }
  return false;
}

async function detectReactEvidence(workspaceRoot, files, pkg) {
  if (hasReactDependency(pkg)) return true;
  if (hasAnyFile(files, ["src/App.jsx", "src/App.tsx"])) return true;
  return hasReactImportEvidence(workspaceRoot, files);
}

function detectBackendEvidence(files, pkg) {
  const dependencies = getDependencyNames(pkg);
  const backendMarkers = [
    "src/agent/",
    "src/modules/",
    "src/services/",
    "src/controllers/",
    "src/routes/",
    "server.js",
    "app.js",
    "src/server.js",
    "src/app.js",
    "index.js"
  ];

  const hasBackendMarker = files.some(file => {
    const normalized = normalizePath(file).toLowerCase();
    return backendMarkers.some(marker => {
      const lowerMarker = marker.toLowerCase();
      return lowerMarker.endsWith("/") ? normalized.startsWith(lowerMarker) : normalized === lowerMarker;
    });
  });

  const hasBackendDependency =
    dependencies.has("express") ||
    dependencies.has("mongoose") ||
    dependencies.has("sequelize") ||
    dependencies.has("prisma");

  const hasNodeTestScript = Object.values(pkg.scripts || {}).some(script => /\bnode\s+--test\b/i.test(String(script || "")));

  return {
    hasBackendMarker,
    hasBackendDependency,
    hasNodeTestScript,
    backendEvidence: hasBackendMarker || hasBackendDependency || hasNodeTestScript
  };
}

function buildScriptCommands(pkg = {}, packageManager = "npm") {
  const scripts = pkg.scripts || {};
  const commands = {
    testCommands: [],
    buildCommands: [],
    runCommands: []
  };

  const runForScript = scriptName => {
    if (!scripts[scriptName]) return null;
    if (packageManager === "npm") {
      if (scriptName === "test") return "npm test";
      if (scriptName === "start") return "npm start";
      return `npm run ${scriptName}`;
    }
    return `${packageManager} ${scriptName}`;
  };

  for (const scriptName of Object.keys(scripts)) {
    const command = runForScript(scriptName);
    if (!command) continue;
    if (scriptName === "test") commands.testCommands.push(command);
    else if (scriptName === "build") commands.buildCommands.push(command);
    else if (["start", "dev", "serve", "preview"].includes(scriptName)) commands.runCommands.push(command);
  }

  return {
    testCommands: uniqueSorted(commands.testCommands),
    buildCommands: uniqueSorted(commands.buildCommands),
    runCommands: uniqueSorted(commands.runCommands)
  };
}

function isReactProjectFile(file) {
  return /^(?:src\/(?:App|main|index)\.(?:js|jsx|ts|tsx))$/i.test(normalizePath(file));
}

function detectProjectType({ files, pkg, reactEvidence, backendEvidence }) {
  const lower = new Set(files.map(file => normalizePath(file).toLowerCase()));
  if (lower.has("next.config.js") || lower.has("next.config.mjs") || lower.has("next.config.cjs") || lower.has("next.config.ts") || lower.has("app/page.tsx") || lower.has("app/page.js") || lower.has("pages/index.js") || lower.has("pages/index.tsx")) {
    return "next";
  }

  if (lower.has("vite.config.js") || lower.has("vite.config.ts")) {
    return reactEvidence ? "vite" : (backendEvidence ? (pkg?.dependencies?.express ? "express" : "node_backend") : "node");
  }

  if (reactEvidence) return "node_react";
  if (lower.has("composer.json") || files.some(file => normalizePath(file).toLowerCase().endsWith(".php"))) return "php";
  if (files.some(file => /\.(?:csproj|config|aspx|cshtml)$/i.test(file))) return "aspnet";
  if (lower.has("pubspec.yaml") || lower.has("lib/main.dart")) return "flutter";
  if (lower.has("requirements.txt") || lower.has("pyproject.toml") || files.some(file => /\.py$/i.test(file))) return "python";
  if (lower.has("index.html") || lower.has("public/index.html")) return "static_html";
  if (backendEvidence) return pkg?.dependencies?.express ? "express" : "node_backend";
  if (lower.has("package.json")) return "node";
  return "generic";
}

function pickEntryFiles(projectType, files) {
  const lower = new Set(files.map(file => normalizePath(file).toLowerCase()));
  const selected = [];
  const pushIfExists = candidate => {
    if (lower.has(normalizePath(candidate).toLowerCase()) && !selected.includes(candidate)) selected.push(candidate);
  };

  if (projectType === "node_react" || projectType === "vite" || projectType === "next") {
    [
      "app/page.tsx",
      "app/page.js",
      "pages/index.tsx",
      "pages/index.js",
      "src/App.jsx",
      "src/App.tsx",
      "src/index.jsx",
      "src/index.tsx",
      "src/main.jsx",
      "src/main.tsx",
      "src/App.js",
      "src/index.js",
      "src/main.js"
    ].forEach(pushIfExists);
  } else if (projectType === "php") {
    ["public/index.php", "index.php"].forEach(pushIfExists);
  } else if (projectType === "aspnet") {
    files.filter(file => /\.(?:aspx|cshtml)$/i.test(file)).slice(0, 3).forEach(file => pushIfExists(file));
  } else if (projectType === "flutter") {
    pushIfExists("lib/main.dart");
  } else if (projectType === "python") {
    files.filter(file => /\.py$/i.test(file)).slice(0, 3).forEach(file => pushIfExists(file));
  } else if (projectType === "static_html") {
    pushIfExists("index.html");
  } else {
    ["src/server.js", "src/app.js", "server.js", "app.js", "src/index.js", "index.js"].forEach(pushIfExists);
  }

  return selected;
}

function detectWorkspaceLayout(workspaceRoot, files) {
  const normalizedFiles = files.map(normalizePath);
  const existingTopLevelDirs = uniqueSorted(
    normalizedFiles
      .filter(file => file.includes("/"))
      .map(file => file.split("/").filter(Boolean)[0])
      .filter(dir => dir && !dir.startsWith("."))
  );

  const topLevelSet = new Set(existingTopLevelDirs);
  const appRoots = new Set();
  const sourceRoots = new Set();
  const moduleRoots = new Set();
  const testRoots = new Set();

  const addRoot = (set, root) => {
    const normalized = normalizePath(root);
    if (!normalized) return;
    set.add(normalized);
  };

  const sourceMarkers = new Set(["src", "app", "backend", "frontend", "server", "client", "api"]);
  const appMarkers = new Set(["src", "app", "backend", "frontend", "server", "client", "api", "pages", "routes"]);
  const testMarkers = new Set(["tests", "test", "__tests__", "spec", "specs"]);

  for (const file of normalizedFiles) {
    const parts = file.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    const first = parts[0];
    const second = parts[1];
    const topLevel = first;
    const nestedRoot = second ? `${first}/${second}` : null;

    if (topLevelSet.has(topLevel)) {
      if (appMarkers.has(topLevel)) addRoot(appRoots, topLevel);
      if (sourceMarkers.has(topLevel)) addRoot(sourceRoots, topLevel);
      if (appMarkers.has(topLevel) || sourceMarkers.has(topLevel)) addRoot(moduleRoots, topLevel);
      if (testMarkers.has(topLevel)) addRoot(testRoots, topLevel);
    }

    const nestedMarkers = new Set(["src", "app", "pages", "routes", "tests", "test", "__tests__"]);
    if (nestedRoot && nestedMarkers.has(second)) {
      if (sourceMarkers.has(first) || appMarkers.has(first)) {
        addRoot(sourceRoots, nestedRoot);
        addRoot(moduleRoots, nestedRoot);
      }
      if (testMarkers.has(second)) {
        addRoot(testRoots, nestedRoot);
      }
    }

    const fileIsCode = /\.(?:js|jsx|ts|tsx|mjs|cjs|php|py|cs|cshtml|aspx|dart|html|json|css|scss|sass)$/i.test(file);
    const fileIsTest = /(?:^|\/)(?:tests?|__tests__|specs?)(?:\/|$)|\.(?:test|spec)\.(?:js|jsx|ts|tsx|mjs|cjs|php|py|cs|cshtml|aspx)$/i.test(file);
    if (fileIsCode) {
      if (appMarkers.has(topLevel)) addRoot(appRoots, topLevel);
      if (sourceMarkers.has(topLevel)) addRoot(sourceRoots, topLevel);
      if (nestedRoot && nestedMarkers.has(second)) {
        addRoot(moduleRoots, nestedRoot);
      }
      if (topLevel === "src" || topLevel === "app" || topLevel === "backend" || topLevel === "frontend" || topLevel === "server" || topLevel === "client" || topLevel === "api") {
        addRoot(moduleRoots, topLevel);
      }
    }
    if (fileIsTest) {
      if (topLevel) addRoot(testRoots, topLevel);
      if (nestedRoot && (second === "tests" || second === "test" || second === "__tests__")) addRoot(testRoots, nestedRoot);
    }
  }

  if (normalizedFiles.includes("package.json")) {
    appRoots.add(".");
    moduleRoots.add(".");
  }
  if (normalizedFiles.some(file => /^index\.(?:html|php)$/i.test(file) || /^public\/index\.php$/i.test(file))) {
    appRoots.add(".");
    moduleRoots.add(".");
  }

  return {
    workspaceRoot,
    appRoots: uniqueSorted([...appRoots]),
    sourceRoots: uniqueSorted([...sourceRoots]),
    moduleRoots: uniqueSorted([...moduleRoots]),
    testRoots: uniqueSorted([...testRoots]),
    existingTopLevelDirs
  };
}

export async function scanProject(workspaceRoot, { limit = 5000 } = {}) {
  const files = await listWorkspaceFiles(workspaceRoot, { limit }).catch(() => []);
  const lower = new Set(files.map(f => f.toLowerCase()));
  const layout = detectWorkspaceLayout(workspaceRoot, files);
  const pkg = await readWorkspacePackageJson(workspaceRoot);
  const packageManager = lower.has("yarn.lock") ? "yarn" : lower.has("pnpm-lock.yaml") ? "pnpm" : "npm";
  const reactEvidence = await detectReactEvidence(workspaceRoot, files, pkg || {});
  const backendSignals = detectBackendEvidence(files, pkg || {});
  const projectType = detectProjectType({ files, pkg: pkg || {}, reactEvidence, backendEvidence: backendSignals.backendEvidence });

  const entryFiles = pickEntryFiles(projectType, files);

  const styleFiles = files.filter(f => /\.(css|scss|sass)$/i.test(f)).slice(0, 5);

  const { testCommands, buildCommands, runCommands } = projectType === "flutter"
    ? { testCommands: ["flutter test"], buildCommands: ["flutter build"], runCommands: ["flutter run"] }
    : buildScriptCommands(pkg || {}, packageManager);

  console.log("[PROJECT_SCAN_ROOT]", { workspaceRoot, topLevelDirs: layout.existingTopLevelDirs });
  console.log("[PROJECT_SCAN_PACKAGE]", {
    packageJsonFound: !!pkg,
    packageManager,
    scripts: Object.keys(pkg?.scripts || {})
  });
  console.log("[PROJECT_SCAN_DETECTION]", {
    projectType,
    reactEvidence,
    backendEvidence: backendSignals.backendEvidence,
    entryFiles,
    testCommands,
    buildCommands,
    runCommands
  });

  return {
    workspaceRoot,
    projectType,
    packageManager,
    entryFiles,
    styleFiles,
    testCommands,
    buildCommands,
    runCommands,
    appRoots: layout.appRoots,
    sourceRoots: layout.sourceRoots,
    moduleRoots: layout.moduleRoots,
    testRoots: layout.testRoots,
    existingTopLevelDirs: layout.existingTopLevelDirs
  };
}
