import { buildKnowledgeGraph as buildWorkspaceKnowledgeGraph, summarizeProjectKnowledge } from "../../analysis/knowledgeGraph/index.js";
import { inferPrimaryConcepts, pascalize, slugify, unique } from "./inference.js";

function collectNodeNames(graph = null, predicate = null) {
  return unique((Array.isArray(graph?.nodes) ? graph.nodes : [])
    .filter(node => (typeof predicate === "function" ? predicate(node) : true))
    .map(node => node?.name || node?.path || "")
    .map(value => pascalize(value))
    .filter(Boolean));
}

function collectSurfaces(graph = null, nodes = []) {
  const routeNames = unique([
    ...collectNodeNames(graph, node => node.type === "route"),
    ...nodes.filter(node => /route|page|view|screen|screen/i.test(String(node?.type || ""))).map(node => node.name || node.path || "")
  ].map(value => pascalize(value)).filter(Boolean));

  const componentNames = unique([
    ...collectNodeNames(graph, node => node.type === "ui" || node.type === "module" || node.type === "file"),
    ...nodes.filter(node => /component|layout|widget|panel|modal|drawer|sidebar|header|footer/i.test(String(node?.name || ""))).map(node => node.name || "")
  ].map(value => pascalize(value)).filter(Boolean));

  const layoutNames = unique([
    ...collectNodeNames(graph, node => node.type === "ui" && /layout|shell|wrapper|frame|provider/i.test(String(node.name || ""))),
    ...nodes.filter(node => /layout|shell|wrapper|frame|provider/i.test(String(node?.name || ""))).map(node => node.name || "")
  ].map(value => pascalize(value)).filter(Boolean));

  const modelNames = unique(collectNodeNames(graph, node => node.type === "data"));
  const apiNames = unique(collectNodeNames(graph, node => node.type === "api"));

  return {
    pages: routeNames,
    components: componentNames,
    layouts: layoutNames,
    routes: routeNames.map(name => `/${slugify(name)}`),
    models: modelNames,
    apis: apiNames
  };
}

export function buildKnowledgeGraph({
  prompt = "",
  workspaceState = {},
  projectIntent = {},
  uiPlan = null,
  componentTree = null,
  dependencyGraph = null,
  criteria = {}
} = {}) {
  const workspaceRoot = workspaceState?.workspaceRoot || projectIntent?.workspaceRoot || criteria?.workspaceRoot || null;
  const graph = buildWorkspaceKnowledgeGraph(workspaceRoot || ".", {
    prompt,
    workspaceState,
    projectIntent,
    uiPlan,
    componentTree,
    dependencyGraph,
    criteria,
    save: false
  });

  const concepts = unique([
    ...inferPrimaryConcepts(prompt, workspaceState, uiPlan, componentTree, dependencyGraph),
    ...collectNodeNames(graph),
    ...(Array.isArray(graph?.nodes) ? graph.nodes.map(node => node.name || node.path || "") : [])
  ].map(value => pascalize(value)).filter(Boolean));

  const surfaces = collectSurfaces(graph, Array.isArray(graph?.nodes) ? graph.nodes : []);
  const summary = summarizeProjectKnowledge(graph);

  return {
    ...graph,
    prompt,
    projectIntent,
    workspaceState,
    uiPlan,
    componentTree,
    dependencyGraph,
    criteria,
    concepts,
    surfaces,
    currentArchitecture: workspaceState?.scan?.projectType || null,
    summary
  };
}

export { buildKnowledgeGraph as buildWorkspaceKnowledgeGraph };
