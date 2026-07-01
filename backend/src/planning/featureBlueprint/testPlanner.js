import { inferPrimaryConcepts, unique } from "../../agent/projectIntelligence/inference.js";

export function planTests(productType, pages = [], workspaceContext = {}) {
  const prompt = workspaceContext?.prompt || "";
  const concepts = inferPrimaryConcepts(
    prompt,
    workspaceContext?.workspaceState || {},
    workspaceContext?.uiPlan || null,
    workspaceContext?.componentTree || null,
    workspaceContext?.dependencyGraph || null
  );
  const tests = [];

  for (const page of unique(pages).slice(0, 8)) {
    tests.push(`Render ${page}`);
  }
  for (const concept of concepts.slice(0, 6)) {
    tests.push(`Validate ${concept}`);
  }

  return unique(tests);
}
