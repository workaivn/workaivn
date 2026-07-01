import { mergeLabels, unique } from "./shared.js";

export function analyzeResponsive({ analyses = [], componentTree = null } = {}) {
  const responsive = [];
  const seen = new Set();
  const nodes = Array.isArray(componentTree?.components) ? componentTree.components : [];

  for (const analysis of analyses) {
    const labels = mergeLabels(analysis.responsiveLabels);
    if (labels.length === 0) continue;
    const key = analysis.file;
    if (seen.has(key)) continue;
    seen.add(key);
    responsive.push({
      id: analysis.file,
      path: analysis.file,
      name: analysis.title,
      labels,
      breakpoints: unique(labels.filter(label => ["desktop", "tablet", "mobile"].includes(label))),
      hiddenComponents: /hidden/.test(labels.join(",")),
      conditionalRender: /conditional render/.test(labels.join(",")) || /if\s*\(|ternary|&&/.test(analysis.file),
      responsiveMenu: /sidebar|menu|navbar/.test(labels.join(",")),
      responsiveSidebar: /sidebar/.test(labels.join(",")),
      responsiveTable: /table|grid/.test(labels.join(",")),
      relatedComponents: unique(nodes.filter(node => node.path === analysis.file || node.route === analysis.route).map(node => node.name))
    });
  }

  return responsive;
}

