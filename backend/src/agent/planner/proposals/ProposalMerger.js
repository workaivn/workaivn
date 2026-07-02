import { createProposalRegistry } from "./ProposalRegistry.js";

export function mergeProposals(proposals = []) {
  const registry = createProposalRegistry();
  for (const proposal of Array.isArray(proposals) ? proposals : []) {
    registry.add(proposal);
  }
  return registry.list();
}
