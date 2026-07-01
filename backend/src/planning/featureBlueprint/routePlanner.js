import { slugify, unique } from "../../agent/projectIntelligence/inference.js";

export function planRoutes(productType, pages = [], workspaceContext = {}) {
  const existingRoutes = Array.isArray(workspaceContext?.uiPlan?.pages) ? workspaceContext.uiPlan.pages : [];
  if (existingRoutes.length > 0) {
    return existingRoutes.map(page => ({
      title: page.title || page.name || "Page",
      route: page.route || page.path || `/${slugify(page.title || page.name || "page")}`,
      entryPoint: page.path || page.entryPoint || null
    }));
  }

  return unique((Array.isArray(pages) ? pages : []).filter(Boolean)).map(page => ({
    title: page,
    route: page === "Home" ? "/" : `/${slugify(page)}`,
    entryPoint: page === "Home" ? "index.html" : `pages/${slugify(page)}.tsx`
  }));
}
