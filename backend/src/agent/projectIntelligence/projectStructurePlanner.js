import { createPlanningFileRecord, getComponentKnowledge, getGoalKnowledge, getProfileKnowledge, GOAL_TYPES, isReactProfile } from "./planningKnowledgeRegistry.js";
import { normalizeLower, pascalize, slugify, unique } from "./inference.js";

function hasExistingFile(existingFiles = [], candidate = "") {
  const normalized = normalizeLower(candidate);
  return (Array.isArray(existingFiles) ? existingFiles : []).some(file => normalizeLower(file) === normalized);
}

function addDirectory(directories, value) {
  const normalized = String(value || "").replace(/\\/g, "/").trim().replace(/\/+$/, "");
  if (!normalized) return;
  directories.add(normalized);
}

function addFile(records, existingFiles, pathValue, meta = {}) {
  const path = String(pathValue || "").replace(/\\/g, "/").trim();
  if (!path || hasExistingFile(existingFiles, path)) return;
  records.push(createPlanningFileRecord(path, meta));
}

function buildReactFiles({ goalType, componentKnowledge, featureNames, prompt, existingFiles }) {
  const files = [];
  const directories = new Set();
  ["src", ...componentKnowledge.directories].forEach(dir => addDirectory(directories, dir));
  addFile(files, existingFiles, "package.json", { phase: "BOOTSTRAP_PROJECT", role: "manifest", reason: "Initialize React/Vite workspace", priority: 100 });
  addFile(files, existingFiles, "index.html", { phase: "GENERATE_BASE_FILES", role: "entry", reason: "HTML mount point", priority: 98 });
  addFile(files, existingFiles, "src/main.tsx", { phase: "GENERATE_BASE_FILES", role: "entry", reason: "React entry point", priority: 97 });
  addFile(files, existingFiles, "src/App.tsx", { phase: "GENERATE_BASE_FILES", role: "root-component", reason: "Root application shell", priority: 96 });
  addFile(files, existingFiles, "src/styles.css", { phase: "GENERATE_BASE_FILES", role: "styles", reason: "Global style layer", priority: 95 });

  const featureComponentMap = {
    [GOAL_TYPES.LANDING_PAGE]: [
      "src/components/layout/Layout.tsx",
      "src/components/navigation/Navbar.tsx",
      "src/components/sections/HeroSection.tsx",
      "src/components/sections/FeatureGrid.tsx",
      "src/components/sections/CTASection.tsx",
      "src/components/sections/Footer.tsx"
    ],
    [GOAL_TYPES.SAAS_APP]: [
      "src/components/layout/Layout.tsx",
      "src/components/navigation/Navbar.tsx",
      "src/components/sections/HeroSection.tsx",
      "src/components/sections/PricingGrid.tsx",
      "src/components/sections/FeatureGrid.tsx",
      "src/components/sections/CTASection.tsx",
      "src/components/sections/Footer.tsx"
    ],
    [GOAL_TYPES.DASHBOARD]: [
      "src/components/layout/Layout.tsx",
      "src/components/navigation/Sidebar.tsx",
      "src/components/navigation/Topbar.tsx",
      "src/components/widgets/StatsCards.tsx",
      "src/components/widgets/DataTable.tsx",
      "src/components/widgets/ActivityFeed.tsx",
      "src/components/widgets/SettingsPanel.tsx"
    ],
    [GOAL_TYPES.ADMIN_PANEL]: [
      "src/components/layout/Layout.tsx",
      "src/components/navigation/Sidebar.tsx",
      "src/components/navigation/Topbar.tsx",
      "src/components/widgets/UserTable.tsx",
      "src/components/widgets/RoleMatrix.tsx",
      "src/components/widgets/AuditLog.tsx",
      "src/components/widgets/SettingsPanel.tsx"
    ],
    [GOAL_TYPES.FULLSTACK_APP]: [
      "src/components/layout/Layout.tsx",
      "src/components/navigation/Navbar.tsx",
      "src/components/sections/HeroSection.tsx",
      "src/components/sections/FeatureGrid.tsx",
      "src/components/sections/CTASection.tsx",
      "src/components/sections/Footer.tsx"
    ]
  };

  const selected = featureComponentMap[goalType] || featureComponentMap[GOAL_TYPES.LANDING_PAGE];
  for (const file of selected) {
    const component = pascalize(file.split("/").pop().replace(/\.[^.]+$/, ""));
    addFile(files, existingFiles, file, {
      phase: "GENERATE_FEATURE_MODULES",
      role: "component",
      component,
      feature: featureNames[0] || goalType,
      reason: `Modular UI component for ${goalType}`,
      priority: 80
    });
  }

  return { directories: [...directories], files };
}

function buildNextFiles({ goalType, componentKnowledge, featureNames, existingFiles }) {
  const files = [];
  const directories = new Set();
  ["app", "components", "components/layout", "components/sections", "components/shared"].forEach(dir => addDirectory(directories, dir));
  addFile(files, existingFiles, "package.json", { phase: "BOOTSTRAP_PROJECT", role: "manifest", reason: "Initialize Next.js workspace", priority: 100 });
  addFile(files, existingFiles, "app/layout.tsx", { phase: "GENERATE_BASE_FILES", role: "entry", reason: "Root layout", priority: 98 });
  addFile(files, existingFiles, "app/page.tsx", { phase: "GENERATE_BASE_FILES", role: "entry", reason: "Route entry", priority: 97 });
  addFile(files, existingFiles, "app/globals.css", { phase: "GENERATE_BASE_FILES", role: "styles", reason: "Global styles", priority: 96 });
  for (const name of componentKnowledge.components.slice(0, 6)) {
    const file = `components/${slugify(name)}.tsx`;
    addFile(files, existingFiles, file, {
      phase: "GENERATE_FEATURE_MODULES",
      role: "component",
      component: name,
      feature: featureNames[0] || goalType,
      reason: `Next.js component for ${goalType}`,
      priority: 80
    });
  }
  return { directories: [...directories], files };
}

function buildNodeFiles({ goalType, featureNames, existingFiles }) {
  const files = [];
  const directories = new Set();
  ["src", "src/routes", "src/controllers", "src/middleware", "src/services"].forEach(dir => addDirectory(directories, dir));
  addFile(files, existingFiles, "package.json", { phase: "BOOTSTRAP_PROJECT", role: "manifest", reason: "Initialize Node.js workspace", priority: 100 });
  addFile(files, existingFiles, "src/server.js", { phase: "GENERATE_BASE_FILES", role: "entry", reason: "HTTP server entry", priority: 98 });
  addFile(files, existingFiles, "src/routes/health.js", { phase: "GENERATE_FEATURE_MODULES", role: "route", reason: "Health route", priority: 96 });
  addFile(files, existingFiles, "src/routes/index.js", { phase: "GENERATE_FEATURE_MODULES", role: "route", reason: "Route registry", priority: 95 });
  addFile(files, existingFiles, "src/controllers/healthController.js", { phase: "GENERATE_FEATURE_MODULES", role: "controller", reason: "Health controller", priority: 94 });
  addFile(files, existingFiles, "src/middleware/errorHandler.js", { phase: "GENERATE_FEATURE_MODULES", role: "middleware", reason: "Error handling middleware", priority: 93 });
  return { directories: [...directories], files };
}

function buildPhpFiles({ existingFiles }) {
  const files = [];
  const directories = new Set();
  ["assets/css", "assets/js"].forEach(dir => addDirectory(directories, dir));
  addFile(files, existingFiles, "index.php", { phase: "BOOTSTRAP_PROJECT", role: "entry", reason: "Primary PHP entry point", priority: 100 });
  addFile(files, existingFiles, "assets/css/style.css", { phase: "GENERATE_BASE_FILES", role: "styles", reason: "Shared styles", priority: 98 });
  addFile(files, existingFiles, "assets/js/app.js", { phase: "GENERATE_BASE_FILES", role: "script", reason: "Client script", priority: 97 });
  return { directories: [...directories], files };
}

function buildStaticFiles({ existingFiles }) {
  const files = [];
  const directories = new Set();
  ["assets/css", "assets/js"].forEach(dir => addDirectory(directories, dir));
  addFile(files, existingFiles, "index.html", { phase: "BOOTSTRAP_PROJECT", role: "entry", reason: "Static HTML entry point", priority: 100 });
  addFile(files, existingFiles, "assets/css/style.css", { phase: "GENERATE_BASE_FILES", role: "styles", reason: "Shared styles", priority: 98 });
  addFile(files, existingFiles, "assets/js/app.js", { phase: "GENERATE_BASE_FILES", role: "script", reason: "Client script", priority: 97 });
  return { directories: [...directories], files };
}

function buildDotNetFiles({ existingFiles }) {
  const files = [];
  const directories = new Set();
  ["src", "Controllers", "Models", "Services"].forEach(dir => addDirectory(directories, dir));
  addFile(files, existingFiles, "Program.cs", { phase: "BOOTSTRAP_PROJECT", role: "entry", reason: "ASP.NET Core entry point", priority: 100 });
  addFile(files, existingFiles, "appsettings.json", { phase: "GENERATE_BASE_FILES", role: "config", reason: "App configuration", priority: 98 });
  return { directories: [...directories], files };
}

function buildPythonFiles({ profileId, existingFiles }) {
  const files = [];
  const directories = new Set();
  ["app"].forEach(dir => addDirectory(directories, dir));
  if (profileId === "python-fastapi") {
    addFile(files, existingFiles, "main.py", { phase: "BOOTSTRAP_PROJECT", role: "entry", reason: "FastAPI entry point", priority: 100 });
  } else {
    addFile(files, existingFiles, "app.py", { phase: "BOOTSTRAP_PROJECT", role: "entry", reason: "Flask entry point", priority: 100 });
  }
  addFile(files, existingFiles, "requirements.txt", { phase: "GENERATE_BASE_FILES", role: "manifest", reason: "Python dependencies", priority: 98 });
  return { directories: [...directories], files };
}

function buildFlutterFiles({ existingFiles }) {
  const files = [];
  const directories = new Set();
  ["lib"].forEach(dir => addDirectory(directories, dir));
  addFile(files, existingFiles, "pubspec.yaml", { phase: "BOOTSTRAP_PROJECT", role: "manifest", reason: "Flutter manifest", priority: 100 });
  addFile(files, existingFiles, "lib/main.dart", { phase: "GENERATE_BASE_FILES", role: "entry", reason: "Flutter entry point", priority: 98 });
  return { directories: [...directories], files };
}

export function buildProjectStructure({
  goalType = GOAL_TYPES.UNKNOWN,
  bootstrapProfile = {},
  projectIntent = {},
  workspaceState = {},
  projectScan = {}
} = {}) {
  const profileId = String(bootstrapProfile?.id || bootstrapProfile?.framework || "").trim();
  const profileKnowledge = getProfileKnowledge(profileId);
  const goalKnowledge = getGoalKnowledge(goalType);
  const componentKnowledge = getComponentKnowledge({ goalType, profileId });
  const existingFiles = Array.isArray(workspaceState?.existingFiles) ? workspaceState.existingFiles : [];
  const featureNames = unique(goalKnowledge.features || []);
  const prompt = String(projectIntent?.prompt || projectIntent?.objective || "");

  let structure;
  if (profileKnowledge.family === "react") {
    structure = buildReactFiles({ goalType, componentKnowledge, featureNames, prompt, existingFiles });
  } else if (profileKnowledge.family === "next") {
    structure = buildNextFiles({ goalType, componentKnowledge, featureNames, existingFiles });
  } else if (profileKnowledge.family === "node") {
    structure = buildNodeFiles({ goalType, featureNames, existingFiles });
  } else if (profileKnowledge.family === "php") {
    structure = buildPhpFiles({ existingFiles });
  } else if (profileKnowledge.family === "dotnet") {
    structure = buildDotNetFiles({ existingFiles });
  } else if (profileKnowledge.family === "python") {
    structure = buildPythonFiles({ profileId, existingFiles });
  } else if (profileKnowledge.family === "dart") {
    structure = buildFlutterFiles({ existingFiles });
  } else {
    structure = buildStaticFiles({ existingFiles });
  }

  const explicitRequestedFiles = unique([
    ...(Array.isArray(projectIntent?.requestedFiles) ? projectIntent.requestedFiles : []),
    ...(Array.isArray(projectIntent?.explicitFiles) ? projectIntent.explicitFiles : []),
    ...(Array.isArray(projectIntent?.paths) ? projectIntent.paths : [])
  ].map(file => String(file || "").replace(/\\/g, "/").trim()).filter(Boolean));
  const directories = unique([
    ...(profileKnowledge.baseDirectories || []),
    ...(goalKnowledge.directories || []),
    ...(structure.directories || [])
  ]);
  const files = unique((structure.files || []).map(record => JSON.stringify(record))).map(text => JSON.parse(text));
  const targetFiles = unique(files.map(file => file.path));
  const entryFiles = unique(files.filter(file => /BOOTSTRAP_PROJECT|GENERATE_BASE_FILES/.test(String(file.phase || ""))).map(file => file.path));
  const featureFiles = unique(files.filter(file => String(file.phase || "") === "GENERATE_FEATURE_MODULES").map(file => file.path));

  return {
    goalType,
    profileId: profileId || profileKnowledge.fallbackTemplate || "generic-static-html",
    frameworkFamily: profileKnowledge.family || "static",
    directories,
    files,
    targetFiles,
    entryFiles,
    featureFiles,
    componentKnowledge,
    goalKnowledge,
    validationHints: unique([...(goalKnowledge.validationHints || []), ...(componentKnowledge.validationHints || [])])
  };
}

