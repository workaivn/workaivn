import crypto from "node:crypto";
import { createProposalRegistry, getProposalKey } from "./ProposalRegistry.js";
import { validateProposal } from "./ProposalValidator.js";

function normalizeList(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || "").trim()).filter(Boolean))];
}

export function createProposalGraph({
  proposals = [],
  metadata = {}
} = {}) {
  const registry = createProposalRegistry();
  const nodes = [];
  for (const proposal of Array.isArray(proposals) ? proposals : []) {
    const validated = validateProposal(proposal, metadata.context || metadata || {});
    const node = registry.add({
      ...proposal,
      status: validated.valid ? proposal.status || "PROPOSED" : "REJECTED"
    });
    nodes.push(node);
  }

  const graph = {
    id: metadata.id || `proposal-graph:${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
    nodes: registry.list(),
    edges: normalizeList(metadata.edges || []),
    metadata: { ...metadata }
  };

  console.log("[PROPOSAL_GRAPH_CREATED]", {
    graphId: graph.id,
    proposalCount: graph.nodes.length
  });

  return graph;
}

export function validateProposalGraph(graph = {}, context = {}) {
  const errors = [];
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const seen = new Map();
  for (const proposal of nodes) {
    const key = getProposalKey(proposal);
    if (seen.has(key)) {
      errors.push(`Duplicate proposal key: ${key}`);
      continue;
    }
    seen.set(key, proposal);
    const validation = validateProposal(proposal, context);
    if (!validation.valid) {
      errors.push(validation.reason || `Invalid proposal: ${proposal.proposalId || "unknown"}`);
    }
  }
  return { valid: errors.length === 0, errors };
}
