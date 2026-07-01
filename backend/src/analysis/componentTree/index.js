export { buildComponentTree, buildComponentId, getComponentTreeCache } from "./builder.js";
export { loadComponentTree, saveComponentTree } from "./serializer.js";
export { validateComponentTree } from "./validator.js";
export {
  basenameWithoutExtension,
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
  inferRouteFromPath,
  normalizePath,
  pascalize,
  parseSource,
  resolveLocalTarget,
  selectComponentName,
  unique
} from "./resolver.js";
export { buildRouteMappings, extractRouteCandidatesFromContent, normalizeRoute } from "./routeResolver.js";

export function findComponent(tree = null, query = "") {
  const needle = String(query || "").toLowerCase();
  if (!tree || !needle) return null;
  return (Array.isArray(tree.components) ? tree.components : []).find(node =>
    String(node?.name || "").toLowerCase() === needle ||
    String(node?.path || "").toLowerCase() === needle
  ) || null;
}

export function findChildren(tree = null, query = "") {
  const component = findComponent(tree, query);
  if (!component || !Array.isArray(tree?.components)) return [];
  const componentMap = new Map(tree.components.map(node => [node.id, node]));
  return (component.children || []).map(id => componentMap.get(id)).filter(Boolean);
}

export function findParents(tree = null, query = "") {
  const component = findComponent(tree, query);
  if (!component || !Array.isArray(tree?.components)) return [];
  const componentMap = new Map(tree.components.map(node => [node.id, node]));
  return (component.parents || []).map(id => componentMap.get(id)).filter(Boolean);
}

export function findRoute(tree = null, query = "") {
  const needle = String(query || "").toLowerCase();
  if (!tree || !needle) return null;
  return (Array.isArray(tree.routes) ? tree.routes : []).find(route =>
    String(route.route || "").toLowerCase() === needle ||
    String(route.componentName || "").toLowerCase() === needle ||
    String(route.path || "").toLowerCase() === needle
  ) || null;
}

export function findLayout(tree = null, query = "") {
  const needle = String(query || "").toLowerCase();
  if (!tree || !needle) return null;
  return (Array.isArray(tree.components) ? tree.components : []).find(node =>
    node.layout === true &&
    (String(node.name || "").toLowerCase() === needle || String(node.path || "").toLowerCase() === needle)
  ) || null;
}

export function findShared(tree = null) {
  return (Array.isArray(tree?.components) ? tree.components : []).filter(node => node.shared);
}

export function findUnused(tree = null) {
  return (Array.isArray(tree?.components) ? tree.components : []).filter(node => node.unused);
}

export function findCircular(tree = null) {
  return (Array.isArray(tree?.components) ? tree.components : []).filter(node => node.circular);
}

export function searchComponent(tree = null, query = "") {
  const needle = String(query || "").toLowerCase();
  if (!tree || !needle) return [];
  return (Array.isArray(tree?.components) ? tree.components : []).filter(node =>
    String(node?.name || "").toLowerCase().includes(needle) ||
    String(node?.path || "").toLowerCase().includes(needle) ||
    (Array.isArray(node?.imports) && node.imports.some(item => String(item || "").toLowerCase().includes(needle)))
  );
}
