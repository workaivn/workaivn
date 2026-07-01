import { mergeLabels, unique } from "./shared.js";

export function analyzeFlows({ analyses = [], componentTree = null } = {}) {
  const flows = [];
  const seen = new Set();
  const nodes = Array.isArray(componentTree?.components) ? componentTree.components : [];

  for (const analysis of analyses) {
    const labels = mergeLabels(analysis.flowLabels, analysis.navigationLabels);
    if (labels.length === 0) continue;
    const key = analysis.file;
    if (seen.has(key)) continue;
    seen.add(key);
    flows.push({
      id: analysis.file,
      name: analysis.title,
      path: analysis.file,
      labels,
      interactions: labels,
      routeFlow: !!analysis.route,
      dialogFlow: /dialog|modal/.test(labels.join(",")),
      pageTargets: unique(nodes.filter(node => node.route).map(node => node.route))
    });
  }

  return flows;
}

