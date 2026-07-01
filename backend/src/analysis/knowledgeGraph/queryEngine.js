import { KG_NODE_TYPES, KG_EDGE_TYPES, CONFIDENCE_SCORES, KG_LOG_EVENTS } from "./types.js";

const queryLogDedupe = new Set();

function logEvent(eventName, payload = {}, dedupeKey = null) {
  const key = dedupeKey || `${eventName}::${JSON.stringify(payload || {})}`;
  if (queryLogDedupe.has(key)) return false;
  queryLogDedupe.add(key);
  console.log(`[${eventName}]`, payload);
  return true;
}

function normalizeText(value = "") {
  return String(value || "").toLowerCase().trim();
}

function normalizeNodes(graph = null) {
  return Array.isArray(graph?.nodes) ? graph.nodes : [];
}

function normalizeEdges(graph = null) {
  return Array.isArray(graph?.edges) ? graph.edges : [];
}

function lookupNode(graph, query) {
  const needle = normalizeText(query);
  if (!needle) return null;
  return normalizeNodes(graph).find(node =>
    normalizeText(node?.id) === needle ||
    normalizeText(node?.name) === needle ||
    normalizeText(node?.path) === needle
  ) || null;
}

export function findEntity(graph = null, query = "") {
  const node = lookupNode(graph, query);
  logEvent(KG_LOG_EVENTS.QUERY_EXECUTED, { query: "findEntity", needle: query, found: !!node }, `query::findEntity::${normalizeText(query)}`);
  return node;
}

export function queryKnowledgeGraph(graph = null, query = "") {
  const needle = normalizeText(query);
  if (!needle) return [];
  return normalizeNodes(graph).filter(node =>
    normalizeText(node.id).includes(needle) ||
    normalizeText(node.name).includes(needle) ||
    normalizeText(node.path).includes(needle) ||
    (Array.isArray(node.evidence) && node.evidence.some(item => normalizeText(item?.value).includes(needle)))
  );
}

export function findRelations(graph = null, query = "") {
  const node = lookupNode(graph, query);
  if (!node) return [];

  const nodesById = new Map(normalizeNodes(graph).map(item => [item.id, item]));
  const related = [];
  for (const edge of normalizeEdges(graph)) {
    if (edge.from !== node.id && edge.to !== node.id) continue;
    const otherId = edge.from === node.id ? edge.to : edge.from;
    related.push({
      node: nodesById.get(otherId) || { id: otherId, name: otherId, path: otherId, type: KG_NODE_TYPES.UNKNOWN },
      edge: {
        id: edge.id || `${edge.from}->${edge.to}:${edge.type}`,
        type: edge.type,
        direction: edge.from === node.id ? "outgoing" : "incoming",
        evidence: edge.evidence || [],
        confidence: edge.confidence ?? CONFIDENCE_SCORES.MEDIUM
      }
    });
  }

  logEvent(KG_LOG_EVENTS.QUERY_EXECUTED, { query: "findRelations", needle: query, count: related.length }, `query::findRelations::${normalizeText(query)}`);
  return related;
}

export function findFeatureLocation(graph = null, query = "") {
  const needle = normalizeText(query);
  const matches = normalizeNodes(graph).filter(node => {
    const haystack = normalizeText([node.name, node.path, node.type, ...(node.evidence || []).map(item => item.value)].join(" "));
    return haystack.includes(needle);
  });
  logEvent(KG_LOG_EVENTS.QUERY_EXECUTED, { query: "findFeatureLocation", needle: query, count: matches.length }, `query::findFeatureLocation::${needle}`);
  return matches;
}

export function findImpacts(graph = null, query = "") {
  const node = lookupNode(graph, query);
  if (!node) return [];

  const nodes = normalizeNodes(graph);
  const edges = normalizeEdges(graph);
  const impactedIds = new Set();
  const direct = edges.filter(edge => edge.from === node.id);
  for (const edge of direct) {
    impactedIds.add(edge.to);
    for (const childEdge of edges) {
      if (childEdge.from === edge.to) impactedIds.add(childEdge.to);
    }
  }

  const impacted = [...impactedIds]
    .map(id => nodes.find(item => item.id === id) || { id, name: id, path: id, type: KG_NODE_TYPES.UNKNOWN })
    .filter(Boolean);

  logEvent(KG_LOG_EVENTS.IMPACT_RESOLVED, { query, needle: normalizeText(query), count: impacted.length }, `impact::${normalizeText(query)}`);
  return impacted;
}

export function findTestsForChange(graph = null, query = "") {
  const needle = normalizeText(query);
  const nodes = normalizeNodes(graph);
  const edges = normalizeEdges(graph);
  const matches = nodes.filter(node => node.type === KG_NODE_TYPES.TEST && (
    normalizeText(node.name).includes(needle) ||
    normalizeText(node.path).includes(needle) ||
    edges.some(edge => edge.type === KG_EDGE_TYPES.TESTS && (edge.from === node.id || edge.to === node.id))
  ));
  logEvent(KG_LOG_EVENTS.QUERY_EXECUTED, { query: "findTestsForChange", needle: query, count: matches.length }, `query::findTestsForChange::${needle}`);
  return matches;
}

export function findCommandsForValidation(graph = null, query = "") {
  const needle = normalizeText(query);
  const commands = normalizeNodes(graph).filter(node =>
    node.type === KG_NODE_TYPES.COMMAND &&
    (
      normalizeText(node.name).includes("test") ||
      normalizeText(node.name).includes("build") ||
      normalizeText(node.name).includes("lint") ||
      normalizeText(node.purpose).includes("test") ||
      normalizeText(node.purpose).includes("build") ||
      normalizeText(node.purpose).includes("lint") ||
      normalizeText(node.command).includes(needle)
    )
  );
  logEvent(KG_LOG_EVENTS.QUERY_EXECUTED, { query: "findCommandsForValidation", needle: query, count: commands.length }, `query::findCommandsForValidation::${needle}`);
  return commands;
}

export function findFailurePattern(graph = null, query = "") {
  const needle = normalizeText(query);
  return normalizeNodes(graph).find(node =>
    node.type === KG_NODE_TYPES.HISTORY &&
    (
      normalizeText(node.error).includes(needle) ||
      normalizeText(node.cause).includes(needle) ||
      normalizeText(node.signature).includes(needle)
    )
  ) || null;
}

export function summarizeProjectKnowledge(graph = null) {
  const nodes = normalizeNodes(graph);
  const edges = normalizeEdges(graph);
  const summary = {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    typeDistribution: {},
    confidenceDistribution: { high: 0, medium: 0, low: 0 },
    staleNodes: Array.isArray(graph?.staleNodes) ? graph.staleNodes.length : 0,
    invalidatedEdges: Array.isArray(graph?.invalidatedEdges) ? graph.invalidatedEdges.length : 0
  };

  for (const node of nodes) {
    const type = node.type || KG_NODE_TYPES.UNKNOWN;
    summary.typeDistribution[type] = (summary.typeDistribution[type] || 0) + 1;
    const confidence = node.confidence ?? CONFIDENCE_SCORES.MEDIUM;
    if (confidence >= CONFIDENCE_SCORES.HIGH) summary.confidenceDistribution.high += 1;
    else if (confidence >= CONFIDENCE_SCORES.MEDIUM) summary.confidenceDistribution.medium += 1;
    else summary.confidenceDistribution.low += 1;
  }

  return summary;
}
