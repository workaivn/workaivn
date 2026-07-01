import { slugify, unique } from "../../agent/projectIntelligence/inference.js";

function toPosix(value = "") {
  return String(value || "").replace(/\\/g, "/").trim();
}

function addItem(items, seen, item) {
  const targetPath = toPosix(item.targetPath || item.path || "");
  if (!targetPath || seen.has(targetPath.toLowerCase())) return;
  seen.add(targetPath.toLowerCase());
  items.push({ ...item, targetPath });
}

function pageTargetPath(page, stack = {}, workspaceContext = {}) {
  const slug = slugify(page);
  const framework = String(stack.framework || stack.id || "").toLowerCase();
  if (framework === "php-plain") {
    if (page === "Home") return "index.php";
    return `views/${slug}.php`;
  }
  if (framework === "generic-static-html" || stack.surfaceType === "static-html") {
    if (page === "Home") return "index.html";
    return `sections/${slug}.html`;
  }
  if (framework === "aspnet-core") {
    return `Views/${slug}.cshtml`;
  }
  if (framework === "node-express") {
    return `src/routes/${slug}.js`;
  }
  if (framework === "nextjs-ts") {
    if (page === "Home") return "app/page.tsx";
    return `app/${slug}/page.tsx`;
  }
  if (framework === "react-vite-ts") {
    return `src/pages/${slug}.tsx`;
  }
  return `src/pages/${slug}.tsx`;
}

function componentTargetPath(component, stack = {}) {
  const slug = slugify(component);
  const framework = String(stack.framework || stack.id || "").toLowerCase();
  if (framework === "php-plain") return `partials/${slug}.php`;
  if (framework === "generic-static-html" || stack.surfaceType === "static-html") return `partials/${slug}.html`;
  if (framework === "aspnet-core") return `Views/Shared/${slug}.cshtml`;
  if (framework === "node-express") return `src/components/${slug}.js`;
  return `src/components/${slug}.tsx`;
}

function buildBootstrapItems(blueprint, seen) {
  const stack = blueprint.stack || blueprint.bootstrapProfile || {};
  const items = [];
  const files = unique(stack.targetFiles || stack.files || []);
  const validationCommand = blueprint.validation?.command || "";

  for (const file of files) {
    addItem(items, seen, {
      action: "CREATE_BOOTSTRAP_FILE",
      targetPath: toPosix(file),
      reason: `Inferred bootstrap file for ${stack.id || stack.framework || "workspace"}`,
      dependsOn: [],
      expectedExports: [],
      expectedRoutes: [],
      expectedTests: [],
      validationCommand,
      source: "bootstrap"
    });
  }

  return items;
}

export function buildScaffoldPlan(blueprint = {}) {
  const stack = blueprint.stack || blueprint.bootstrapProfile || {};
  const pages = Array.isArray(blueprint.pages) ? blueprint.pages : [];
  const components = Array.isArray(blueprint.components) ? blueprint.components : [];
  const dataModels = Array.isArray(blueprint.dataModels) ? blueprint.dataModels : [];
  const apis = Array.isArray(blueprint.apis) ? blueprint.apis : [];
  const validationCommand = blueprint.validation?.command || blueprint.validationCommand || "";
  const scaffoldPlan = [];
  const seen = new Set();

  for (const bootstrapItem of buildBootstrapItems(blueprint, seen)) {
    scaffoldPlan.push(bootstrapItem);
  }

  for (const model of dataModels) {
    addItem(scaffoldPlan, seen, {
      action: "CREATE_MODEL",
      targetPath: `src/models/${slugify(model)}.ts`,
      reason: `Data model for ${model}`,
      dependsOn: [],
      expectedExports: [model],
      expectedRoutes: [],
      expectedTests: [`${model} model validates`],
      validationCommand,
      source: "model"
    });
  }

  for (const component of components) {
    addItem(scaffoldPlan, seen, {
      action: "CREATE_COMPONENT",
      targetPath: componentTargetPath(component, stack),
      reason: `Shared component ${component}`,
      dependsOn: [...dataModels.slice(0, 1)],
      expectedExports: [component],
      expectedRoutes: [],
      expectedTests: [`${component} renders`],
      validationCommand,
      source: "component"
    });
  }

  for (const page of pages) {
    addItem(scaffoldPlan, seen, {
      action: "CREATE_PAGE",
      targetPath: pageTargetPath(page, stack, blueprint.workspaceContext || {}),
      reason: `Page for ${page}`,
      dependsOn: components.slice(0, 3),
      expectedExports: [page],
      expectedRoutes: [page === "Home" ? "/" : `/${slugify(page)}`],
      expectedTests: [`${page} page renders`],
      validationCommand,
      source: "page"
    });
  }

  for (const api of apis) {
    addItem(scaffoldPlan, seen, {
      action: "CREATE_API",
      targetPath: `src/api/${slugify(api)}.ts`,
      reason: `API surface for ${api}`,
      dependsOn: dataModels.slice(0, 2),
      expectedExports: [],
      expectedRoutes: [api],
      expectedTests: [`${api} contract`],
      validationCommand,
      source: "api"
    });
  }

  return scaffoldPlan;
}

export function buildFilePlan(scaffoldPlan = [], workspaceContext = {}) {
  const existing = new Set((workspaceContext?.workspaceState?.existingFiles || []).map(file => toPosix(file).toLowerCase()));
  const merged = new Map();

  for (const item of scaffoldPlan || []) {
    const pathKey = toPosix(item.targetPath || item.path || "");
    if (!pathKey) continue;
    const key = pathKey.toLowerCase();
    const current = merged.get(key) || {
      operation: existing.has(key) ? "UPDATE_FILE" : "CREATE_FILE",
      path: pathKey,
      reason: "",
      dependsOn: [],
      expectedRoutes: [],
      expectedTests: [],
      validationCommand: ""
    };

    merged.set(key, {
      ...current,
      operation: current.operation === "UPDATE_FILE" || existing.has(key) ? "UPDATE_FILE" : "CREATE_FILE",
      reason: [current.reason, item.reason].filter(Boolean).join("; "),
      dependsOn: unique([...(current.dependsOn || []), ...(item.dependsOn || [])]),
      expectedRoutes: unique([...(current.expectedRoutes || []), ...(item.expectedRoutes || [])]),
      expectedTests: unique([...(current.expectedTests || []), ...(item.expectedTests || [])]),
      validationCommand: current.validationCommand || item.validationCommand || ""
    });
  }

  return [...merged.values()];
}
