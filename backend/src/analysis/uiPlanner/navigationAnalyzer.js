import { mergeLabels, unique } from "./shared.js";

export function analyzeNavigation({ analyses = [], componentTree = null } = {}) {
  const navigation = [];
  const componentNodes = Array.isArray(componentTree?.components) ? componentTree.components : [];
  const seen = new Set();

  for (const analysis of analyses) {
    const labels = mergeLabels(analysis.navigationLabels, analysis.widgetLabels);
    const routeSignals = unique([
      ...(analysis.dependencies || []),
      ...(analysis.route ? [analysis.route] : []),
      ...labels
    ]);
    if (labels.length === 0 && routeSignals.length === 0) continue;
    const key = analysis.file;
    if (seen.has(key)) continue;
    seen.add(key);
    navigation.push({
      id: analysis.file,
      name: analysis.title,
      path: analysis.file,
      route: analysis.route,
      kind: labels[0] || "navigation",
      labels,
      nestedRoute: /nested route|route group|router-view|router outlet/.test(`${analysis.file}\n${analysis.title}`),
      dynamicRoute: /\[(?:\.{3})?[^\]]+\]|:\w+/.test(analysis.file) || /dynamic route/.test(`${analysis.file}\n${analysis.title}`),
      protectedRoute: analysis.permissions,
      redirect: /redirect/.test(`${analysis.file}\n${analysis.title}`),
      popupNavigation: /dialog|modal|drawer/.test(`${analysis.file}\n${analysis.title}`),
      routeTargets: unique(componentNodes.filter(node => node.route).map(node => node.route))
    });
  }

  return navigation;
}

