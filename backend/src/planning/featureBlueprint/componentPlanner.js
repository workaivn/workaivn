import { inferPrimaryConcepts, pascalize, unique } from "../../agent/projectIntelligence/inference.js";

function collectExistingComponents(workspaceContext = {}) {
  const widgets = Array.isArray(workspaceContext?.uiPlan?.widgets) ? workspaceContext.uiPlan.widgets : [];
  const treeNodes = Array.isArray(workspaceContext?.componentTree?.components) ? workspaceContext.componentTree.components : [];
  return unique([
    ...widgets.map(widget => widget.name || widget.kind || widget.path || ""),
    ...treeNodes.map(node => node.name || node.path || "")
  ].map(value => pascalize(value)).filter(Boolean));
}

export function planComponents(productType, pages = [], workspaceContext = {}) {
  const concepts = inferPrimaryConcepts(
    workspaceContext?.prompt || "",
    workspaceContext?.workspaceState || {},
    workspaceContext?.uiPlan || null,
    workspaceContext?.componentTree || null,
    workspaceContext?.dependencyGraph || null
  );
  const existing = collectExistingComponents(workspaceContext);
  const pageComponents = unique((Array.isArray(pages) ? pages : []).map(page => `${pascalize(page)}View`).filter(Boolean));

  return unique([
    ...existing,
    ...pageComponents,
    ...concepts
  ]).slice(0, 24);
}
