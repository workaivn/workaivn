import { KG_NODE_TYPES, KG_EDGE_TYPES } from "./types.js";

export function validateKnowledgeGraph(graph = {}) {
  const errors = [];
  
  if (!graph.graphVersion && !graph.version) errors.push({ field: "graphVersion", message: "Missing graph version" });
  if (!graph.workspaceId && !graph.workspaceRoot) errors.push({ field: "workspaceId", message: "Missing workspace identifier" });
  
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  
  for (const node of nodes) {
    if (!node.id) errors.push({ node: "unknown", field: "id", message: "Missing node id" });
    if (!node.type) errors.push({ node: node.id, field: "type", message: "Missing node type" });
    if (!node.name) errors.push({ node: node.id, field: "name", message: "Missing node name" });
    if (!node.source) errors.push({ node: node.id, field: "source", message: "Missing node source" });
    if (!Array.isArray(node.evidence)) errors.push({ node: node.id, field: "evidence", message: "Missing node evidence" });
    if (node.confidence === undefined) errors.push({ node: node.id, field: "confidence", message: "Missing node confidence" });
    if (!node.discoveredBy) errors.push({ node: node.id, field: "discoveredBy", message: "Missing node discoveredBy" });
  }
  
  for (const edge of edges) {
    if (!edge.id) errors.push({ edge: "unknown", field: "id", message: "Missing edge id" });
    if (!edge.from) errors.push({ edge: "unknown", field: "from", message: "Missing edge source" });
    if (!edge.to) errors.push({ edge: "unknown", field: "to", message: "Missing edge target" });
    if (!edge.type) errors.push({ edge: `${edge.from}->${edge.to}`, field: "type", message: "Missing edge type" });
    if (!edge.name) errors.push({ edge: `${edge.from}->${edge.to}`, field: "name", message: "Missing edge name" });
    if (!edge.source) errors.push({ edge: `${edge.from}->${edge.to}`, field: "source", message: "Missing edge source" });
    if (!Array.isArray(edge.evidence)) errors.push({ edge: `${edge.from}->${edge.to}`, field: "evidence", message: "Missing edge evidence" });
    if (edge.confidence === undefined) errors.push({ edge: `${edge.from}->${edge.to}`, field: "confidence", message: "Missing edge confidence" });
  }
  
  const validNodes = nodes.filter(node => node.id && node.type && node.confidence !== undefined);
  const validEdges = edges.filter(edge => edge.from && edge.to && edge.type);
  
  return {
    valid: errors.length === 0,
    errors,
    nodeCount: validNodes.length,
    edgeCount: validEdges.length
  };
}
