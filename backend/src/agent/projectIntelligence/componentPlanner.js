import { GOAL_TYPES, getComponentKnowledge } from "./planningKnowledgeRegistry.js";
import { normalizeLower, pascalize, slugify, unique } from "./inference.js";

function componentId(name, path) {
  return slugify(`${name}-${path || ""}`) || name;
}

function addComponent(components, node) {
  components.push({
    id: node.id || componentId(node.name, node.path),
    name: node.name,
    path: node.path,
    framework: node.framework || null,
    type: node.type || "component",
    parent: node.parent || null,
    children: unique(node.children || []),
    imports: unique(node.imports || []),
    exports: unique(node.exports || []),
    props: unique(node.props || []),
    hooks: unique(node.hooks || []),
    context: unique(node.context || []),
    provider: !!node.provider,
    consumer: !!node.consumer,
    lazy: !!node.lazy,
    dynamic: !!node.dynamic,
    route: node.route || null,
    layout: !!node.layout,
    shared: !!node.shared,
    usageCount: Number.isFinite(Number(node.usageCount)) ? Number(node.usageCount) : 1,
    unused: !!node.unused,
    circular: !!node.circular,
    dependencies: unique(node.dependencies || []),
    dependents: unique(node.dependents || []),
    lastModified: node.lastModified || null,
    hash: node.hash || null,
    root: !!node.root
  });
}

function linkChild(components, parentName, childName) {
  const parent = components.find(component => component.name === parentName);
  const child = components.find(component => component.name === childName);
  if (!parent || !child) return;
  parent.children = unique([...(parent.children || []), child.id]);
  child.parent = parent.id;
}

function buildReactComponents({ goalType, uiPlan, projectStructure, featurePlan }) {
  const knowledge = getComponentKnowledge({ goalType, profileId: projectStructure.profileId });
  const components = [];
  const isDashboard = goalType === GOAL_TYPES.DASHBOARD || goalType === GOAL_TYPES.ADMIN_PANEL;
  const layoutName = isDashboard ? "DashboardLayout" : "Layout";
  const route = isDashboard ? "/dashboard" : "/";
  const hasPathAuthority = Array.isArray(projectStructure?.targetFiles) && projectStructure.targetFiles.length > 0;
  const componentPath = (value) => hasPathAuthority ? value : null;
  addComponent(components, {
    name: "App",
    path: componentPath(projectStructure.profileId === "nextjs-ts" ? "app/page.tsx" : "src/App.tsx"),
    framework: projectStructure.profileId,
    type: "page",
    route,
    root: true,
    children: [],
    imports: [layoutName],
    exports: ["default"],
    usageCount: 1,
    shared: false
  });
  addComponent(components, {
    name: layoutName,
    path: componentPath(projectStructure.profileId === "nextjs-ts" ? "app/layout.tsx" : "src/components/layout/Layout.tsx"),
    framework: projectStructure.profileId,
    type: "layout",
    layout: true,
    route,
    shared: true,
    children: []
  });

  const widgetDefs = isDashboard
    ? [
        ["Sidebar", "src/components/navigation/Sidebar.tsx", true],
        ["Topbar", "src/components/navigation/Topbar.tsx", true],
        ["StatsCards", "src/components/widgets/StatsCards.tsx", false],
        ["DataTable", "src/components/widgets/DataTable.tsx", false],
        ["ActivityFeed", "src/components/widgets/ActivityFeed.tsx", false],
        ["SettingsPanel", "src/components/widgets/SettingsPanel.tsx", false]
      ]
    : [
        ["Navbar", "src/components/navigation/Navbar.tsx", true],
        ["HeroSection", "src/components/sections/HeroSection.tsx", false],
        ["FeatureGrid", "src/components/sections/FeatureGrid.tsx", false],
        ["PricingGrid", "src/components/sections/PricingGrid.tsx", false],
        ["CTASection", "src/components/sections/CTASection.tsx", true],
        ["Footer", "src/components/sections/Footer.tsx", true]
      ];

  for (const [name, path, shared] of widgetDefs) {
    addComponent(components, {
      name,
      path: componentPath(path),
      framework: projectStructure.profileId,
      type: "component",
      route,
      shared,
      usageCount: shared ? 2 : 1,
      imports: shared ? ["Layout"] : [layoutName]
    });
  }

  if (isDashboard) {
    linkChild(components, layoutName, "Sidebar");
    linkChild(components, layoutName, "Topbar");
    linkChild(components, layoutName, "StatsCards");
    linkChild(components, layoutName, "DataTable");
    linkChild(components, layoutName, "ActivityFeed");
    linkChild(components, layoutName, "SettingsPanel");
  } else {
    linkChild(components, layoutName, "Navbar");
    linkChild(components, layoutName, "HeroSection");
    linkChild(components, layoutName, "FeatureGrid");
    linkChild(components, layoutName, "PricingGrid");
    linkChild(components, layoutName, "CTASection");
    linkChild(components, layoutName, "Footer");
  }

  const sharedNames = knowledge.sharedComponents || [];
  for (const component of components) {
    if (sharedNames.includes(component.name)) {
      component.shared = true;
      component.usageCount = Math.max(component.usageCount, 2);
    }
  }

  return {
    components,
    root: components.filter(component => component.root),
    shared: components.filter(component => component.shared),
    unused: components.filter(component => component.unused),
    circular: components.filter(component => component.circular),
    summary: {
      componentCount: components.length,
      sharedCount: components.filter(component => component.shared).length
    }
  };
}

function buildNodeComponents({ projectStructure }) {
  const components = [];
  const hasPathAuthority = Array.isArray(projectStructure?.targetFiles) && projectStructure.targetFiles.length > 0;
  const componentPath = (value) => hasPathAuthority ? value : null;
  addComponent(components, { name: "Server", path: componentPath("src/server.js"), type: "server", root: true, route: "/health", framework: projectStructure.profileId, imports: ["Routes"], exports: ["default"] });
  addComponent(components, { name: "Routes", path: componentPath("src/routes/index.js"), type: "route-group", parent: componentId("Server", "src/server.js"), route: "/health", framework: projectStructure.profileId, imports: ["HealthRoute"] });
  addComponent(components, { name: "HealthRoute", path: componentPath("src/routes/health.js"), type: "route", parent: componentId("Routes", "src/routes/index.js"), route: "/health", framework: projectStructure.profileId, shared: true, usageCount: 2 });
  addComponent(components, { name: "Middleware", path: componentPath("src/middleware/errorHandler.js"), type: "middleware", framework: projectStructure.profileId, shared: true, usageCount: 2 });
  addComponent(components, { name: "ErrorHandler", path: componentPath("src/middleware/errorHandler.js"), type: "middleware", framework: projectStructure.profileId, shared: true, usageCount: 2 });
  return {
    components,
    root: components.filter(component => component.root),
    shared: components.filter(component => component.shared),
    unused: [],
    circular: [],
    summary: {
      componentCount: components.length,
      sharedCount: components.filter(component => component.shared).length
    }
  };
}

function buildTextComponents({ projectStructure, profileId }) {
  const components = [];
  const isPhp = profileId === "php-plain";
  const entry = isPhp ? "index.php" : "index.html";
  const hasPathAuthority = Array.isArray(projectStructure?.targetFiles) && projectStructure.targetFiles.length > 0;
  const componentPath = (value) => hasPathAuthority ? value : null;
  addComponent(components, { name: "PageShell", path: componentPath(entry), type: "template", root: true, framework: profileId, route: "/", shared: true, usageCount: 2 });
  addComponent(components, { name: "Header", path: componentPath(entry), type: "template-part", framework: profileId, route: "/", shared: true, usageCount: 2 });
  addComponent(components, { name: "Footer", path: componentPath(entry), type: "template-part", framework: profileId, route: "/", shared: true, usageCount: 2 });
  return {
    components,
    root: components.filter(component => component.root),
    shared: components.filter(component => component.shared),
    unused: [],
    circular: [],
    summary: {
      componentCount: components.length,
      sharedCount: components.filter(component => component.shared).length
    }
  };
}

export function planComponents({
  goalType = GOAL_TYPES.UNKNOWN,
  uiPlan = {},
  projectStructure = {},
  bootstrapProfile = {},
  featurePlan = {}
} = {}) {
  const profileId = String(bootstrapProfile?.id || bootstrapProfile?.framework || projectStructure.profileId || "").trim();
  const family = String(bootstrapProfile?.family || projectStructure.frameworkFamily || "").trim();
  if (family === "react" || family === "next") {
    return buildReactComponents({ goalType, uiPlan, projectStructure, featurePlan });
  }
  if (family === "node") {
    return buildNodeComponents({ projectStructure });
  }
  return buildTextComponents({ projectStructure, profileId });
}
