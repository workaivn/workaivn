import { mergeProposals } from "./ProposalMerger.js";

export function resolveProposalConflicts(proposals = []) {
  const merged = mergeProposals(proposals);
  const conflictCount = Math.max(0, (Array.isArray(proposals) ? proposals.length : 0) - merged.length);
  const conflicts = conflictCount > 0 ? Array.from({ length: conflictCount }, (_, index) => ({ index })) : [];

  if (conflictCount > 0) {
    console.log("[PLANNER_CONFLICT_RESOLVED]", {
      conflictCount,
      proposalTypes: [...new Set((Array.isArray(merged) ? merged : []).flatMap(proposal => Array.isArray(proposal.proposalTypes) ? proposal.proposalTypes : [proposal.proposalType]))]
    });
  }

  return {
    proposals: merged,
    conflicts
  };
}
