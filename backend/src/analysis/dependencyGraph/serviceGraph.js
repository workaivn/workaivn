import { normalizePath, unique } from "./fileGraph.js";
import { DEPENDENCY_EDGE_TYPES, DEPENDENCY_NODE_TYPES } from "./types.js";

function inferServiceRole(file = "", content = "") {
  const normalized = normalizePath(file).toLowerCase();
  const text = String(content || "").toLowerCase();
  if (/(controller|controllers)/.test(normalized) || /\bcontroller\b/.test(text)) return DEPENDENCY_NODE_TYPES.CONTROLLER;
  if (/(service|services)/.test(normalized) || /\bservice\b/.test(text)) return DEPENDENCY_NODE_TYPES.SERVICE;
  if (/(repository|repositories|repo)/.test(normalized) || /\brepository\b/.test(text)) return DEPENDENCY_NODE_TYPES.REPOSITORY;
  if (/(model|models|entity|entities)/.test(normalized) || /\bmodel\b/.test(text)) return DEPENDENCY_NODE_TYPES.MODEL;
  return null;
}

function buildServiceDependencyEdges(file = "", content = "", context = {}) {
  const edges = [];
  const role = inferServiceRole(file, content);
  const refs = unique(context.fileDependencies || []);
  if (!role) return { nodes: [], edges };

  const node = {
    id: normalizePath(file),
    name: normalizePath(file).split("/").pop().replace(/\.[^.]+$/, ""),
    path: normalizePath(file),
    framework: null,
    type: role,
    dependencies: refs,
    dependents: [],
    dependencyCount: refs.length,
    dependentCount: 0,
    fanIn: 0,
    fanOut: refs.length,
    criticalScore: 0,
    impactScore: 0,
    reuseScore: 0,
    changeFrequency: 0,
    unused: false,
    circular: false
  };

  for (const ref of refs) {
    const lower = String(ref || "").toLowerCase();
    if (/(service|repository|model|entity)/.test(lower)) {
      edges.push({ from: node.id, to: ref, type: DEPENDENCY_EDGE_TYPES.COMPONENT, reason: "service-chain" });
    }
  }

  return { nodes: [node], edges };
}

export { buildServiceDependencyEdges, inferServiceRole };

