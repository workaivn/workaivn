import { inferPrimaryConcepts, pascalize, unique } from "../../agent/projectIntelligence/inference.js";

function collectExistingPages(workspaceContext = {}) {
  const uiPages = Array.isArray(workspaceContext?.uiPlan?.pages) ? workspaceContext.uiPlan.pages : [];
  const treeRoutes = Array.isArray(workspaceContext?.componentTree?.routes) ? workspaceContext.componentTree.routes : [];
  return unique([
    ...uiPages.map(page => page.title || page.name || page.route || page.path || ""),
    ...treeRoutes.map(route => route.title || route.route || route.path || route.componentName || "")
  ].map(value => pascalize(value)).filter(Boolean));
}

export function planPages(productType, prompt = "", workspaceContext = {}, intent = null) {
  const concepts = inferPrimaryConcepts(
    prompt,
    workspaceContext?.workspaceState || {},
    workspaceContext?.uiPlan || null,
    workspaceContext?.componentTree || null,
    workspaceContext?.dependencyGraph || null
  );
  const pages = collectExistingPages(workspaceContext);
  const lower = String(prompt || "").toLowerCase();

  if (pages.length > 0) return pages;

  const candidates = unique([
    ...concepts,
    ...(lower.includes("read only") || lower.includes("view") ? ["Overview"] : []),
    ...(lower.includes("api") ? ["Health"] : [])
  ].filter(Boolean));

  if (candidates.length > 0) return candidates.slice(0, 6);
  return [pascalize(productType || intent?.intentType || "Main") || "Main"];
}
