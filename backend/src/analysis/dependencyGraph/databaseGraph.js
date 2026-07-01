import { normalizePath, unique } from "./fileGraph.js";
import { DEPENDENCY_EDGE_TYPES, DEPENDENCY_NODE_TYPES } from "./types.js";

function isDatabaseLike(file = "", content = "") {
  const normalized = normalizePath(file).toLowerCase();
  const text = String(content || "").toLowerCase();
  return /(model|entity|repository|migration|schema|seed|orm|sql|query|db|database|prisma|typeorm|mongoose|sequelize)/.test(normalized) ||
    /\b(select|insert|update|delete|where)\b/.test(text) ||
    /\b(prisma|typeorm|sequelize|mongoose|knex|eloquent)\b/.test(text);
}

function buildDatabaseDependencyEdges(file = "", content = "", context = {}) {
  const refs = unique(context.fileDependencies || []);
  if (!isDatabaseLike(file, content)) return { nodes: [], edges: [] };

  const source = normalizePath(file);

  const node = {
    id: `database:${source}`,
    name: `${source.split("/").pop().replace(/\.[^.]+$/, "")}Database`,
    path: source,
    framework: null,
    type: DEPENDENCY_NODE_TYPES.DATABASE,
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
  edges.push({ from: node.id, to: source, type: DEPENDENCY_EDGE_TYPES.DATABASE, reason: "database-layer" });
  for (const ref of refs) {
    const lower = String(ref || "").toLowerCase();
    if (/(model|repository|service|controller|api)/.test(lower)) {
      edges.push({ from: node.id, to: ref, type: DEPENDENCY_EDGE_TYPES.DATABASE, reason: "db-chain" });
    }
  }

  return { nodes: [node], edges };
}

export { buildDatabaseDependencyEdges, isDatabaseLike };
