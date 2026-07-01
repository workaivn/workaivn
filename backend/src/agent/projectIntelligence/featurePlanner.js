import { GOAL_TYPES, getGoalKnowledge } from "./planningKnowledgeRegistry.js";
import { pascalize, slugify } from "./inference.js";
import { unique } from "./inference.js";

function feature(name, {
  description = "",
  priority = 50,
  files = [],
  components = [],
  route = null,
  goal = ""
} = {}) {
  return {
    id: slugify(name) || name,
    name,
    description,
    priority,
    files: unique(files),
    components: unique(components),
    route,
    goal
  };
}

function buildReactFeatures(goalType, projectStructure = {}) {
  const base = getGoalKnowledge(goalType);
  const sharedFiles = projectStructure.targetFiles || [];
  const landing = [
    feature("navigation", { description: "Top-level navigation and brand anchor", files: sharedFiles.filter(file => /Navbar|Layout|main|App/i.test(file)), components: ["Navbar", "Layout"], goal: "NAVIGATION" }),
    feature("hero", { description: "Primary hero content", files: sharedFiles.filter(file => /Hero/i.test(file)), components: ["HeroSection"], goal: "HERO" }),
    feature("benefits", { description: "Benefits and feature highlights", files: sharedFiles.filter(file => /FeatureGrid|PricingGrid/i.test(file)), components: ["FeatureGrid", "PricingGrid"], goal: "VALUE_PROPOSITION" }),
    feature("cta", { description: "Call-to-action block", files: sharedFiles.filter(file => /CTA/i.test(file)), components: ["CTASection"], goal: "CALL_TO_ACTION" }),
    feature("footer", { description: "Footer and trust signals", files: sharedFiles.filter(file => /Footer/i.test(file)), components: ["Footer"], goal: "FOOTER" })
  ];

  const dashboard = [
    feature("sidebar_navigation", { description: "Navigation shell for account areas", files: sharedFiles.filter(file => /Sidebar|Layout/i.test(file)), components: ["Sidebar", "Layout"], goal: "SIDEBAR" }),
    feature("topbar", { description: "Top application bar", files: sharedFiles.filter(file => /Topbar|Layout/i.test(file)), components: ["Topbar"], goal: "TOPBAR" }),
    feature("metrics", { description: "Key metrics and summary cards", files: sharedFiles.filter(file => /StatsCards|Metric/i.test(file)), components: ["StatsCards"], goal: "METRICS" }),
    feature("table_view", { description: "Operational table view", files: sharedFiles.filter(file => /Table/i.test(file)), components: ["DataTable", "UserTable"], goal: "TABLE" }),
    feature("activity_feed", { description: "Recent events feed", files: sharedFiles.filter(file => /Activity/i.test(file)), components: ["ActivityFeed"], goal: "ACTIVITY_FEED" })
  ];

  const admin = [
    feature("sidebar_navigation", { description: "Administrative navigation shell", files: sharedFiles.filter(file => /Sidebar|Layout/i.test(file)), components: ["Sidebar", "Layout"], goal: "SIDEBAR" }),
    feature("user_management", { description: "Users and permissions control", files: sharedFiles.filter(file => /User|Role/i.test(file)), components: ["UserTable", "RoleMatrix"], goal: "USER_MANAGEMENT" }),
    feature("audit_log", { description: "Audit and compliance trace", files: sharedFiles.filter(file => /Audit/i.test(file)), components: ["AuditLog"], goal: "AUDIT_LOG" }),
    feature("settings", { description: "System settings and preferences", files: sharedFiles.filter(file => /Settings/i.test(file)), components: ["SettingsPanel"], goal: "SETTINGS" })
  ];

  if (goalType === GOAL_TYPES.DASHBOARD) return dashboard;
  if (goalType === GOAL_TYPES.ADMIN_PANEL) return admin;
  if (goalType === GOAL_TYPES.SAAS_APP || goalType === GOAL_TYPES.LANDING_PAGE) return landing;
  if (goalType === GOAL_TYPES.FULLSTACK_APP) {
    return [
      feature("ui_shell", { description: "User-facing shell", files: sharedFiles.filter(file => /App|Layout|Hero|Footer/i.test(file)), components: ["Layout", "Navbar", "HeroSection", "Footer"], goal: "UI" }),
      feature("api_layer", { description: "Backend endpoints and middleware", files: sharedFiles.filter(file => /server|routes|controller|middleware/i.test(file)), components: ["Server", "Routes", "Middleware", "ErrorHandler"], goal: "API" })
    ];
  }
  return base.features.map(name => feature(name, { description: `${pascalize(name)} feature`, goal: name.toUpperCase() }));
}

function buildNodeFeatures(goalType, projectStructure = {}) {
  const files = projectStructure.targetFiles || [];
  return [
    feature("health_endpoint", { description: "Health probe endpoint", files: files.filter(file => /health/i.test(file)), components: ["HealthRoute"], goal: "HEALTH" }),
    feature("routes", { description: "HTTP route wiring", files: files.filter(file => /routes/i.test(file)), components: ["Routes"], goal: "ROUTES" }),
    feature("middleware", { description: "Shared middleware", files: files.filter(file => /middleware/i.test(file)), components: ["Middleware", "ErrorHandler"], goal: "MIDDLEWARE" })
  ];
}

function buildPhpFeatures(goalType, projectStructure = {}) {
  const files = projectStructure.targetFiles || [];
  return [
    feature("page_shell", { description: "PHP page shell", files: files.filter(file => /index\.php$/i.test(file)), components: ["PageShell"], goal: "PAGE" }),
    feature("assets", { description: "Shared CSS and JS assets", files: files.filter(file => /assets\/(css|js)/i.test(file)), components: ["Styles", "AppScript"], goal: "ASSETS" })
  ];
}

function buildStaticFeatures(goalType, projectStructure = {}) {
  const files = projectStructure.targetFiles || [];
  return [
    feature("static_shell", { description: "Static HTML shell", files: files.filter(file => /index\.html$/i.test(file)), components: ["PageShell"], goal: "PAGE" }),
    feature("assets", { description: "Shared CSS and JS assets", files: files.filter(file => /assets\/(css|js)/i.test(file)), components: ["Styles", "AppScript"], goal: "ASSETS" })
  ];
}

function buildDotNetFeatures(goalType, projectStructure = {}) {
  const files = projectStructure.targetFiles || [];
  return [
    feature("app_host", { description: "ASP.NET Core host", files: files.filter(file => /Program\.cs$/i.test(file)), components: ["Program"], goal: "HOST" }),
    feature("configuration", { description: "Application configuration", files: files.filter(file => /appsettings/i.test(file)), components: ["Configuration"], goal: "CONFIG" })
  ];
}

function buildPythonFeatures(goalType, projectStructure = {}, profileId = "") {
  const files = projectStructure.targetFiles || [];
  const entry = profileId === "python-fastapi" ? "main.py" : "app.py";
  return [
    feature("app_entry", { description: "Python application entry point", files: files.filter(file => new RegExp(`${entry}$`, "i").test(file)), components: [profileId === "python-fastapi" ? "FastAPIApp" : "FlaskApp"], goal: "ENTRY" }),
    feature("dependencies", { description: "Dependency manifest", files: files.filter(file => /requirements\.txt$/i.test(file)), components: ["Requirements"], goal: "DEPENDENCIES" })
  ];
}

function buildFlutterFeatures(goalType, projectStructure = {}) {
  const files = projectStructure.targetFiles || [];
  return [
    feature("flutter_app", { description: "Flutter app entry point", files: files.filter(file => /lib\/main\.dart$/i.test(file)), components: ["FlutterApp"], goal: "ENTRY" }),
    feature("pubspec", { description: "Flutter manifest", files: files.filter(file => /pubspec\.yaml$/i.test(file)), components: ["Pubspec"], goal: "MANIFEST" })
  ];
}

export function planFeatures({
  goalType = GOAL_TYPES.UNKNOWN,
  projectStructure = {},
  bootstrapProfile = {},
  projectIntent = {},
  workspaceState = {}
} = {}) {
  const profileId = String(bootstrapProfile?.id || bootstrapProfile?.framework || "").trim();
  const family = String(bootstrapProfile?.family || "").trim();
  const structureFiles = Array.isArray(projectStructure?.targetFiles) ? projectStructure.targetFiles : [];
  let features;
  if (family === "react" || family === "next") features = buildReactFeatures(goalType, projectStructure);
  else if (family === "node") features = buildNodeFeatures(goalType, projectStructure);
  else if (family === "php") features = buildPhpFeatures(goalType, projectStructure);
  else if (family === "dotnet") features = buildDotNetFeatures(goalType, projectStructure);
  else if (family === "python") features = buildPythonFeatures(goalType, projectStructure, profileId);
  else if (family === "dart") features = buildFlutterFeatures(goalType, projectStructure);
  else features = buildStaticFeatures(goalType, projectStructure);

  const ordered = unique(features)
    .map((entry, index) => ({
      ...entry,
      priority: Number.isFinite(Number(entry.priority)) ? Number(entry.priority) : 50 - index,
      files: unique(entry.files || []),
      components: unique(entry.components || [])
    }))
    .sort((a, b) => Number(b.priority) - Number(a.priority) || a.name.localeCompare(b.name));

  return {
    goalType,
    profileId: profileId || bootstrapProfile?.fallbackTemplate || "generic-static-html",
    family: family || "static",
    features: ordered,
    featureOrder: ordered.map(feature => feature.name),
    conceptSeeds: unique([
      ...(Array.isArray(projectStructure?.componentKnowledge?.components) ? projectStructure.componentKnowledge.components : []),
      ...(Array.isArray(projectStructure?.goalKnowledge?.features) ? projectStructure.goalKnowledge.features : []),
      ...(Array.isArray(structureFiles) ? structureFiles : [])
    ]),
    intentSummary: {
      prompt: String(projectIntent?.prompt || projectIntent?.objective || ""),
      workspaceFiles: Array.isArray(workspaceState?.existingFiles) ? workspaceState.existingFiles.length : 0
    }
  };
}
