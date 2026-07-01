import { kindFromNameOrText, mergeLabels, unique } from "./shared.js";

export function analyzeWidgets({ analyses = [], componentTree = null } = {}) {
  const widgets = [];
  const nodes = Array.isArray(componentTree?.components) ? componentTree.components : [];
  const seen = new Set();

  for (const node of nodes) {
    const kind = kindFromNameOrText(node.name) || kindFromNameOrText(node.path) || null;
    if (!kind && !node.shared && !node.layout) continue;
    const key = node.path || node.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    widgets.push({
      id: node.id,
      name: node.name,
      path: node.path,
      kind: kind || "widget",
      shared: !!node.shared,
      usageCount: node.usageCount || 0,
      dynamic: !!node.dynamic,
      route: node.route || null,
      labels: mergeLabels([kind], node.dynamic ? ["dynamic"] : [], node.layout ? ["layout"] : []),
      dependents: unique(node.dependents || []),
      children: unique(node.children || [])
    });
  }

  for (const analysis of analyses) {
    const kind = kindFromNameOrText(analysis.title) || kindFromNameOrText(analysis.file) || null;
    const labels = mergeLabels(analysis.widgetLabels, analysis.navigationLabels);
    if (!kind && labels.length === 0) continue;
    const key = analysis.file;
    if (seen.has(key)) continue;
    seen.add(key);
    widgets.push({
      id: analysis.file,
      name: analysis.title,
      path: analysis.file,
      kind: kind || labels[0] || "widget",
      shared: false,
      usageCount: 0,
      dynamic: false,
      route: analysis.route || null,
      labels,
      dependents: [],
      children: []
    });
  }

  return widgets;
}

