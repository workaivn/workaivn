import { inferRouteFromPath, normalizePath } from "./resolver.js";

function normalizeRoute(value = "") {
  const route = String(value || "").trim();
  if (!route) return null;
  if (route === "/") return "/";
  return `/${route.replace(/^\/+/, "").replace(/\/+/g, "/")}`.replace(/\/$/, "") || "/";
}

function extractRouteCandidatesFromContent(content = "", file = "") {
  const text = String(content || "");
  const candidates = new Set();

  for (const match of text.matchAll(/\bpath\s*:\s*['"]([^'"]+)['"]/gi)) {
    candidates.add(normalizeRoute(match[1]));
  }
  for (const match of text.matchAll(/\b(?:route|href)\s*=\s*['"]([^'"]+)['"]/gi)) {
    candidates.add(normalizeRoute(match[1]));
  }
  for (const match of text.matchAll(/\bres\.render\s*\(\s*['"]([^'"]+)['"]/gi)) {
    candidates.add(normalizeRoute(match[1]));
  }

  const inferred = inferRouteFromPath(file);
  if (inferred) candidates.add(normalizeRoute(inferred));

  return [...candidates].filter(Boolean);
}

function buildRouteMappings(analyses = []) {
  const routes = [];
  for (const analysis of analyses || []) {
    const routeCandidates = new Set([
      ...(Array.isArray(analysis.routes) ? analysis.routes : []),
      ...extractRouteCandidatesFromContent(analysis.content || "", analysis.file || "")
    ]);
    for (const route of routeCandidates) {
      if (!route) continue;
      routes.push({
        route,
        componentId: analysis.id,
        componentName: analysis.name,
        path: normalizePath(analysis.file),
        framework: analysis.framework
      });
    }
  }
  return routes;
}

export { buildRouteMappings, extractRouteCandidatesFromContent, normalizeRoute };

