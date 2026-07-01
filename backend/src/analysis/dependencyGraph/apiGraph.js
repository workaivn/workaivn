import { normalizePath, unique } from "./fileGraph.js";
import { DEPENDENCY_EDGE_TYPES, DEPENDENCY_NODE_TYPES } from "./types.js";

function isApiLike(file = "", content = "") {
  const normalized = normalizePath(file).toLowerCase();
  const text = String(content || "").toLowerCase();
  return /(^|\/)(api|routes?|server)(?:\/|\.|$)/.test(normalized) ||
    /\.(?:graphql|gql|ws|sse|rest|router)\b/.test(normalized) ||
    /\b(?:route::|router\.|app\.(?:get|post|put|patch|delete)|graphql|websocket|sse|express\s*\(|fastify\s*\(|nest\s*\()/.test(text);
}

function buildApiDependencyEdges(file = "", content = "", context = {}) {
  const refs = unique(context.fileDependencies || []);
  if (!isApiLike(file, content)) return { nodes: [], edges: [] };

  const node = {
    id: normalizePath(file),
    name: normalizePath(file).split("/").pop().replace(/\.[^.]+$/, ""),
    path: normalizePath(file),
    framework: null,
    type: DEPENDENCY_NODE_TYPES.API,
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

  const edges = [];
  for (const ref of refs) {
    const lower = String(ref || "").toLowerCase();
    if (/(service|controller|model|database|repository)/.test(lower)) {
      edges.push({ from: node.id, to: ref, type: DEPENDENCY_EDGE_TYPES.API, reason: "api-chain" });
    }
  }

  return { nodes: [node], edges };
}

export { buildApiDependencyEdges, isApiLike };
