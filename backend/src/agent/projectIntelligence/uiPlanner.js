import { GOAL_TYPES } from "./planningKnowledgeRegistry.js";
import { pascalize, slugify, unique } from "./inference.js";

function makePage(title, route, path, {
  layout = null,
  kind = "page",
  primaryFeature = null
} = {}) {
  return {
    title,
    name: title,
    route,
    path,
    layout,
    kind,
    primaryFeature
  };
}

function makeWidget(name, {
  kind = "section",
  path = null,
  route = "/",
  dynamic = false,
  shared = false
} = {}) {
  return {
    name,
    kind,
    path,
    route,
    dynamic,
    shared
  };
}

function buildReactUI(features = [], projectStructure = {}, goalType = GOAL_TYPES.UNKNOWN) {
  const featureNames = features.map(feature => feature.name);
  const isDashboard = goalType === GOAL_TYPES.DASHBOARD || goalType === GOAL_TYPES.ADMIN_PANEL;
  const layoutName = isDashboard ? "DashboardLayout" : "RootLayout";
  const route = isDashboard ? "/dashboard" : "/";
  const pagePath = projectStructure.profileId === "nextjs-ts" ? "app/page.tsx" : "src/App.tsx";
  const layoutPath = projectStructure.profileId === "nextjs-ts" ? "app/layout.tsx" : "src/components/layout/Layout.tsx";
  const pages = [
    makePage(isDashboard ? "Dashboard" : "Home", route, pagePath, {
      layout: layoutName,
      primaryFeature: featureNames[0] || goalType
    })
  ];
  const layouts = [
    {
      name: layoutName,
      path: layoutPath,
      kind: "layout",
      shared: true,
      root: true,
      route
    }
  ];
  const widgets = [];

  const widgetDefinitions = isDashboard
    ? [
        ["Sidebar", "navigation", "src/components/navigation/Sidebar.tsx"],
        ["Topbar", "navigation", "src/components/navigation/Topbar.tsx"],
        ["StatsCards", "widget", "src/components/widgets/StatsCards.tsx"],
        ["DataTable", "widget", "src/components/widgets/DataTable.tsx"],
        ["ActivityFeed", "widget", "src/components/widgets/ActivityFeed.tsx"]
      ]
    : [
        ["Navbar", "navigation", "src/components/navigation/Navbar.tsx"],
        ["HeroSection", "section", "src/components/sections/HeroSection.tsx"],
        ["FeatureGrid", "section", "src/components/sections/FeatureGrid.tsx"],
        ["PricingGrid", "section", "src/components/sections/PricingGrid.tsx"],
        ["CTASection", "section", "src/components/sections/CTASection.tsx"],
        ["Footer", "section", "src/components/sections/Footer.tsx"]
      ];

  for (const [name, kind, path] of widgetDefinitions) {
    widgets.push(makeWidget(name, { kind, path, shared: /Navbar|Footer|CTASection/.test(name) }));
  }

  return {
    pages,
    layouts,
    widgets,
    navigation: widgets.filter(widget => widget.kind === "navigation"),
    flows: [
      {
        name: isDashboard ? "authenticate_to_operate" : "discover_to_convert",
        path: pagePath,
        labels: isDashboard ? ["auth", "dashboard", "operations"] : ["landing", "conversion", "hero"]
      }
    ],
    routes: pages.map(page => ({ route: page.route, title: page.title, path: page.path, layout: page.layout })),
    responsive: [
      {
        path: layoutPath,
        labels: isDashboard ? ["desktop", "tablet", "mobile", "sidebar"] : ["desktop", "tablet", "mobile", "stacked"]
      }
    ]
  };
}

function buildNodeUI(features = [], projectStructure = {}) {
  const pages = [
    makePage("API", "/health", "src/routes/health.js", { kind: "route", primaryFeature: "health_endpoint" })
  ];
  return {
    pages,
    layouts: [],
    widgets: [],
    navigation: [],
    flows: [
      { name: "request_to_response", path: "src/server.js", labels: ["http", "route", "middleware"] }
    ],
    routes: pages.map(page => ({ route: page.route, title: page.title, path: page.path })),
    responsive: []
  };
}

function buildTextUI(features = [], projectStructure = {}, profileId = "") {
  const isPhp = profileId === "php-plain";
  const entry = isPhp ? "index.php" : "index.html";
  return {
    pages: [makePage("Home", "/", entry, { kind: "template", primaryFeature: features[0]?.name || "page_shell" })],
    layouts: [
      {
        name: isPhp ? "PageShell" : "StaticShell",
        path: entry,
        kind: "template",
        shared: true,
        root: true,
        route: "/"
      }
    ],
    widgets: [
      makeWidget("Header", { kind: "template-part", path: entry, shared: true }),
      makeWidget("Footer", { kind: "template-part", path: entry, shared: true })
    ],
    navigation: [],
    flows: [{ name: "entry_to_read", path: entry, labels: ["content", "template"] }],
    routes: [{ route: "/", title: "Home", path: entry }],
    responsive: [{ path: entry, labels: ["desktop", "tablet", "mobile"] }]
  };
}

export function planUI({
  goalType = GOAL_TYPES.UNKNOWN,
  features = [],
  projectStructure = {},
  bootstrapProfile = {},
  projectIntent = {},
  workspaceState = {}
} = {}) {
  const profileId = String(bootstrapProfile?.id || bootstrapProfile?.framework || "").trim();
  const family = String(bootstrapProfile?.family || "").trim();
  let uiPlan;
  if (family === "react" || family === "next") {
    uiPlan = buildReactUI(features, projectStructure, goalType);
  } else if (family === "node") {
    uiPlan = buildNodeUI(features, projectStructure);
  } else if (family === "php" || family === "static") {
    uiPlan = buildTextUI(features, projectStructure, profileId);
  } else if (family === "dotnet") {
    uiPlan = {
      pages: [makePage("Admin", "/admin", "Program.cs", { kind: "route", primaryFeature: "app_host" })],
      layouts: [],
      widgets: [makeWidget("Controller", { kind: "route", path: "Program.cs", shared: true })],
      navigation: [],
      flows: [{ name: "request_to_endpoint", path: "Program.cs", labels: ["endpoint", "controller"] }],
      routes: [{ route: "/health", title: "Health", path: "Program.cs" }],
      responsive: []
    };
  } else if (family === "python" || family === "dart") {
    uiPlan = {
      pages: [makePage("App", "/", profileId === "python-fastapi" ? "main.py" : "lib/main.dart", { kind: "entry", primaryFeature: features[0]?.name || "app_entry" })],
      layouts: [],
      widgets: [],
      navigation: [],
      flows: [{ name: "boot_to_run", path: profileId === "python-fastapi" ? "main.py" : "lib/main.dart", labels: ["entry"] }],
      routes: [{ route: "/", title: "App", path: profileId === "python-fastapi" ? "main.py" : "lib/main.dart" }],
      responsive: []
    };
  } else {
    uiPlan = buildTextUI(features, projectStructure, profileId);
  }

  return {
    ...uiPlan,
    summary: {
      pageCount: uiPlan.pages.length,
      layoutCount: uiPlan.layouts.length,
      widgetCount: uiPlan.widgets.length,
      routeCount: uiPlan.routes.length
    },
    intentSummary: {
      prompt: String(projectIntent?.prompt || projectIntent?.objective || ""),
      workspaceFiles: Array.isArray(workspaceState?.existingFiles) ? workspaceState.existingFiles.length : 0
    }
  };
}
