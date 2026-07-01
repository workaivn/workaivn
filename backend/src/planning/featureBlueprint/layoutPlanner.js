import { inferPrimaryConcepts, pascalize } from "../../agent/projectIntelligence/inference.js";

export function planLayouts(productType, workspaceContext = {}, pages = []) {
  const conceptSeed = inferPrimaryConcepts(
    workspaceContext?.prompt || "",
    workspaceContext?.workspaceState || {},
    workspaceContext?.uiPlan || null,
    workspaceContext?.componentTree || null,
    workspaceContext?.dependencyGraph || null
  );

  const existingLayouts = Array.isArray(workspaceContext?.uiPlan?.layouts) ? workspaceContext.uiPlan.layouts : [];
  if (existingLayouts.length > 0) {
    return existingLayouts.map(layout => ({
      name: layout.name || pascalize(layout.path || "Layout"),
      kind: layout.kind || "layout",
      pathHint: layout.path || layout.name || "layout"
    }));
  }

  const inferred = conceptSeed.find(concept => /layout|shell|wrapper|frame|portal|panel/i.test(concept));
  const layoutName = inferred ? `${pascalize(inferred)}Layout` : `${pascalize(pages[0] || productType || "Main")}Layout`;
  return [
    { name: layoutName, kind: "layout", pathHint: `src/components/layout/${layoutName}.tsx` }
  ];
}
