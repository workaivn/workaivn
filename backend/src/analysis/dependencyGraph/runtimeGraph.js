import { normalizePath, unique } from "./fileGraph.js";
import { DEPENDENCY_EDGE_TYPES, DEPENDENCY_NODE_TYPES } from "./types.js";

function isRuntimeLike(file = "", content = "") {
  const normalized = normalizePath(file).toLowerCase();
  const text = String(content || "").toLowerCase();
  if (/(?:^|\/)(?:package\.json|composer\.json|pom\.xml|build\.gradle|cargo\.toml|go\.mod|requirements\.txt|pubspec\.yaml)$/.test(normalized)) return false;
  return /(worker|workers|job|jobs|queue|queues|cron|scheduler|pubsub|socket|realtime|background|task)/.test(normalized) ||
    /\b(setinterval|settimeout|cron|queue|worker|socket|pubsub|schedule)\b/.test(text);
}

function buildRuntimeDependencyEdges(file = "", content = "", context = {}) {
  const refs = unique(context.fileDependencies || []);
  if (!isRuntimeLike(file, content)) return { nodes: [], edges: [] };

  const node = {
    id: normalizePath(file),
    name: normalizePath(file).split("/").pop().replace(/\.[^.]+$/, ""),
    path: normalizePath(file),
    framework: null,
    type: DEPENDENCY_NODE_TYPES.RUNTIME,
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
    if (/(queue|job|worker|cron|socket|realtime|scheduler|event)/.test(lower)) {
      edges.push({ from: node.id, to: ref, type: DEPENDENCY_EDGE_TYPES.RUNTIME, reason: "runtime-chain" });
    }
  }

  return { nodes: [node], edges };
}

export { buildRuntimeDependencyEdges, isRuntimeLike };
