import { kindFromNameOrText, mergeLabels, unique } from "./shared.js";

export function analyzeLayouts({ analyses = [], componentTree = null } = {}) {
  const layouts = [];
  const seen = new Set();
  const componentLayouts = new Map((Array.isArray(componentTree?.components) ? componentTree.components : [])
    .filter(node => node.layout)
    .map(node => [node.path, node]));

  for (const analysis of analyses) {
    const treeLayout = componentLayouts.get(analysis.file);
    const layoutKind = kindFromNameOrText(analysis.file) || (analysis.layout ? "layout" : null);
    if (!analysis.layout && !treeLayout && !layoutKind) continue;
    const key = analysis.file;
    if (seen.has(key)) continue;
    seen.add(key);
    layouts.push({
      id: treeLayout?.id || analysis.file,
      name: analysis.title || treeLayout?.name || analysis.file,
      path: analysis.file,
      framework: analysis.framework,
      kind: layoutKind || "layout",
      nested: /nested|inner|sub/i.test(`${analysis.file}\n${treeLayout?.name || ""}`),
      shell: /shell/i.test(`${analysis.file}\n${analysis.title || ""}`),
      provider: analysis.providers,
      wrapper: /wrapper|container|grid|flex/i.test(`${analysis.file}\n${analysis.title || ""}`),
      components: mergeLabels(treeLayout?.children || [], analysis.widgetLabels, analysis.navigationLabels),
      pageTargets: unique((Array.isArray(componentTree?.routes) ? componentTree.routes : [])
        .filter(route => route.path === analysis.file)
        .map(route => route.componentName || route.route))
    });
  }

  return layouts;
}
