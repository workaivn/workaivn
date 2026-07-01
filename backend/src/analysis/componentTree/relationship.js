import path from "node:path";
import {
  buildWorkspaceIndex,
  detectComponentType,
  detectFrameworkFromContent,
  extractDynamicImports,
  extractExportsFromAst,
  extractHooksFromAst,
  extractJsxTags,
  extractLocalImportRecords,
  extractPropsFromAst,
  extractTemplateReferences,
  hashContent,
  inferLayoutRole,
  normalizePath,
  parseSource,
  pascalize,
  resolveLocalTarget,
  selectComponentName,
  unique
} from "./resolver.js";

function createAnalysisRecord(file, content, workspaceIndex, allFiles = []) {
  const normalizedFile = normalizePath(file);
  const hash = hashContent(content);
  const ast = /\.(?:js|jsx|ts|tsx|mjs|cjs|mts|cts)$/i.test(normalizedFile) ? parseSource(content) : null;
  const framework = detectFrameworkFromContent(content, normalizedFile) || "custom";
  const exports = extractExportsFromAst(ast);
  const imports = extractLocalImportRecords(ast);
  const jsxTags = extractJsxTags(ast);
  const dynamicImports = extractDynamicImports(ast, content);
  const templateRefs = extractTemplateReferences(content, framework);
  const props = extractPropsFromAst(ast);
  const hooks = extractHooksFromAst(ast);
  const name = selectComponentName(normalizedFile, content, exports);
  const type = detectComponentType(normalizedFile, content, framework);
  const layout = inferLayoutRole(normalizedFile, content, framework);
  const routes = [];

  const isNextRouteFile = /^(?:src\/)?(?:app|pages)\//i.test(normalizedFile) || framework === "next";
  const basename = normalizedFile.split("/").pop() || "";
  const isLayoutFile = /^(?:layout|_layout|master|shell|wrapper)\.[^.]+$/i.test(basename);
  if (isNextRouteFile && !isLayoutFile) {
    const route = normalizedFile
      .replace(/^src\/pages\//i, "")
      .replace(/^src\/app\//i, "")
      .replace(/^pages\//i, "")
      .replace(/^app\//i, "")
      .replace(/\/page\.[^.]+$/i, "")
      .replace(/\/index\.[^.]+$/i, "")
      .replace(/\.[^.]+$/i, "");
    const finalRoute = route ? `/${route.replace(/\/+/g, "/")}`.replace(/\/index$/, "/") : "/";
    routes.push(finalRoute);
  }

  if (type === "page") {
    const inferred = normalizedFile
      .replace(/^.*\/(?:pages|app|views|templates)\//i, "")
      .replace(/\.[^.]+$/, "");
    if (inferred) routes.push(`/${inferred.replace(/\/index$/i, "")}`);
  }

  const importFiles = unique(imports.flatMap(entry => entry.source ? resolveLocalTarget(workspaceIndex, normalizedFile, entry.source) : []));
  const renderRefs = unique([
    ...jsxTags,
    ...templateRefs
  ]);

  const dynamicRefs = unique(dynamicImports.flatMap(reference => resolveLocalTarget(workspaceIndex, normalizedFile, reference)));
  const templateTargets = unique(templateRefs.flatMap(reference => resolveLocalTarget(workspaceIndex, normalizedFile, reference)));

  const componentLike = type !== "unknown" || ast || jsxTags.length > 0 || templateRefs.length > 0 || dynamicImports.length > 0;
  if (!componentLike) return null;

  const explicitNameCandidates = [
    ...renderRefs,
    ...imports.flatMap(entry => entry.specifiers || []),
    name
  ];

  const resolvedImports = unique(importFiles);
  const resolvedRenderTargets = unique([
    ...resolvedImports,
    ...templateTargets,
    ...dynamicRefs
  ]);

  const provider = /provider$/i.test(name) || /\bprovider\b/.test(content);
  const consumer = /consumer$/i.test(name) || /\bconsumer\b/.test(content);

  return {
    id: hash.slice(0, 12),
    name,
    path: normalizedFile,
    framework,
    type,
    parent: null,
    parents: [],
    children: [],
    imports: resolvedImports,
    exports: exports.length > 0 ? exports : (name ? [name] : []),
    props,
    hooks,
    context: { provider, consumer },
    provider,
    consumer,
    lazy: dynamicImports.length > 0,
    dynamic: dynamicImports.length > 0 || templateTargets.length > 0,
    route: routes[0] || null,
    routes,
    layout,
    shared: false,
    usageCount: 0,
    unused: false,
    circular: false,
    dependencies: resolvedRenderTargets,
    dependents: [],
    lastModified: null,
    hash,
    content,
    analysis: {
      file: normalizedFile,
      framework,
      type,
      imports: resolvedImports,
      renderRefs,
      dynamicRefs,
      templateTargets,
      routes,
      props,
      hooks,
      provider,
      consumer,
      layout
    }
  };
}

function createWorkspaceIndex(files = []) {
  return buildWorkspaceIndex(files);
}

function createComponentAnalyses(files = [], contents = new Map()) {
  const index = createWorkspaceIndex(files);
  const analyses = [];
  for (const file of files || []) {
    const content = contents.get(normalizePath(file)) || contents.get(normalizePath(file).toLowerCase()) || "";
    const analysis = createAnalysisRecord(file, content, index, files);
    if (analysis) analyses.push(analysis);
  }
  return { analyses, index };
}

function buildRelationshipGraph(analyses = [], workspaceIndex = null) {
  const nodesByPath = new Map();
  const nodesByName = new Map();

  for (const node of analyses || []) {
    nodesByPath.set(node.path.toLowerCase(), node);
    const names = new Set([node.name, pascalize(path.posix.basename(node.path).replace(/\.[^.]+$/, ""))]);
    for (const name of names) {
      if (!name) continue;
      const key = String(name).toLowerCase();
      if (!nodesByName.has(key)) nodesByName.set(key, []);
      nodesByName.get(key).push(node);
    }
  }

  const edges = [];
  for (const node of analyses || []) {
    const dependencies = new Set(node.dependencies || []);
    for (const dep of dependencies) {
      const target = nodesByPath.get(normalizePath(dep).toLowerCase()) || nodesByName.get(pascalize(path.posix.basename(dep).replace(/\.[^.]+$/, "")).toLowerCase())?.[0] || null;
      if (!target || target.id === node.id) continue;
      edges.push({ from: node.id, to: target.id, kind: "render" });
      node.children.push(target.id);
      target.parents.push(node.id);
      target.dependents.push(node.id);
      target.usageCount += 1;
    }
    for (const imp of node.imports || []) {
      const target = nodesByPath.get(normalizePath(imp).toLowerCase()) || nodesByName.get(pascalize(path.posix.basename(imp).replace(/\.[^.]+$/, "")).toLowerCase())?.[0] || null;
      if (!target || target.id === node.id) continue;
      if (!node.children.includes(target.id)) node.children.push(target.id);
      if (!target.parents.includes(node.id)) target.parents.push(node.id);
      if (!target.dependents.includes(node.id)) target.dependents.push(node.id);
      target.usageCount += 1;
      edges.push({ from: node.id, to: target.id, kind: "import" });
    }
  }

  return { nodesByPath, nodesByName, edges };
}

export {
  buildRelationshipGraph,
  createAnalysisRecord,
  createComponentAnalyses,
  createWorkspaceIndex
};
