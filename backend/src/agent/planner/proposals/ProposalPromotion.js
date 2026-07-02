import { Task } from "../task.js";
import { TaskKind } from "../plannerTypes.js";
import { resolveProposalConflicts } from "./ProposalConflictResolver.js";
import { validateProposal } from "./ProposalValidator.js";
import { createExecutionPlanner } from "../../executionPlanner/executionPlanner.js";
import { checkProposalGraphAuthority } from "../context/PlannerAuthorityFirewall.js";

function normalize(value = "") {
  return String(value || "").replace(/\\/g, "/").trim();
}

function getFacts(context = {}) {
  return context?.facts || context?.projectScan || context?.workspaceState?.scan || {};
}

function buildPromotionId(proposal, descriptorType, value) {
  return `promotion:${proposal.proposalId || "proposal"}:${descriptorType}:${normalize(value).toLowerCase()}`;
}

function isPromotedDescriptor(descriptor = {}) {
  return descriptor && descriptor.promoted === true && Boolean(descriptor.promotionId) && Boolean(descriptor.promotionSource) && descriptor.verificationEvidence && typeof descriptor.verificationEvidence === "object";
}

function isRecommendationOnlyProposal(proposal = {}) {
  const promotionDecision = String(proposal.promotionDecision || proposal.metadata?.promotionDecision || "").toLowerCase();
  return proposal.recommendationOnly === true ||
    proposal.metadata?.recommendationOnly === true ||
    proposal.executable === false ||
    promotionDecision === "recommendation";
}

function createFileTaskDescriptor(proposal, file, context = {}) {
  const facts = getFacts(context);
  const existing = new Set((Array.isArray(context?.workspaceState?.existingFiles) ? context.workspaceState.existingFiles : []).map(normalize).map(value => value.toLowerCase()));
  const normalizedFile = normalize(file);
  const tool = existing.has(normalizedFile.toLowerCase()) ? "APPLY_PATCH" : "WRITE_FILE";
  const evidence = {
    pathSource: facts.scanId || context?.scanId || proposal?.proposalId || null,
    commandSource: null
  };
  return {
    id: buildPromotionId(proposal, "file", normalizedFile),
    kind: TaskKind.CODING,
    tool,
    goal: `${tool === "WRITE_FILE" ? "Write" : "Update"} file: ${normalizedFile}`,
    toolArgs: { path: normalizedFile, file: normalizedFile, content: proposal.metadata?.contentByFile?.[normalizedFile] || proposal.metadata?.content || null },
    dependencies: [],
    promotionSource: proposal.proposalType,
    proposalSource: proposal.proposalSource || proposal.source || null,
    evidenceRefs: Array.isArray(proposal.evidenceRefs) ? [...proposal.evidenceRefs] : [],
    verificationStatus: proposal.verificationStatus || null,
    promotionDecision: proposal.promotionDecision || null,
    verificationEvidence: evidence,
    plannerReason: proposal.description || proposal.proposalType,
    source: proposal.source || "planner",
    proposalId: proposal.proposalId,
    proposalType: proposal.proposalType,
    promoted: true,
    promotionId: buildPromotionId(proposal, "file", normalizedFile),
    contextScanId: facts.scanId || context?.scanId || null
  };
}

function createCommandTaskDescriptor(proposal, command, context = {}) {
  const normalized = normalize(command);
  const facts = getFacts(context);
  return {
    id: buildPromotionId(proposal, "command", normalized),
    kind: TaskKind.CODING,
    tool: "RUN_TERMINAL",
    goal: `Run command: ${normalized}`,
    toolArgs: { command: normalized },
    dependencies: [],
    promotionSource: proposal.proposalType,
    proposalSource: proposal.proposalSource || proposal.source || null,
    evidenceRefs: Array.isArray(proposal.evidenceRefs) ? [...proposal.evidenceRefs] : [],
    verificationStatus: proposal.verificationStatus || null,
    promotionDecision: proposal.promotionDecision || null,
    verificationEvidence: {
      commandSource: facts.scanId || proposal?.proposalId || null
    },
    plannerReason: proposal.description || proposal.proposalType,
    source: proposal.source || "planner",
    proposalId: proposal.proposalId,
    proposalType: proposal.proposalType,
    promoted: true,
    promotionId: buildPromotionId(proposal, "command", normalized),
    contextScanId: facts.scanId || null
  };
}

export function promoteProposalToDescriptors(proposal = {}, context = {}) {
  console.log("[PROPOSAL_PROMOTION_START]", {
    proposalId: proposal.proposalId || null,
    proposalType: proposal.proposalType || null,
    descriptorType: proposal.proposalType || null,
    scanId: getFacts(context).scanId || null
  });
  if (isRecommendationOnlyProposal(proposal)) {
    console.log("[RECOMMENDATION_SKIPPED_FOR_EXECUTION]", {
      proposalId: proposal.proposalId || null,
      proposalType: proposal.proposalType || null,
      reason: "recommendation objects must not be promoted to executable descriptors"
    });
    return {
      decision: "REJECT",
      descriptors: [],
      proposal,
      reason: "recommendation objects must not be promoted to executable descriptors",
      promotedDescriptors: [],
      rejectedDescriptors: [],
      deferredDescriptors: [],
      conflicts: [],
      diagnostics: [{
        proposalId: proposal.proposalId || null,
        proposalType: proposal.proposalType || null,
        descriptorType: proposal.proposalType || null,
        reason: "recommendation objects must not be promoted to executable descriptors"
      }]
    };
  }
  const validation = validateProposal(proposal, context);
  if (!validation.valid) {
    if (String(validation.reason || "").toLowerCase().includes("verified before promotion")) {
      console.log("[TEMPLATE_RECOMMENDATION_ONLY]", {
        proposalId: proposal.proposalId || null,
        proposalType: proposal.proposalType || null,
        proposalSource: proposal.proposalSource || proposal.source || null,
        evidenceRefs: Array.isArray(proposal.evidenceRefs) ? [...proposal.evidenceRefs] : [],
        reason: validation.reason
      });
    }
    const rejectedDescriptors = [...(Array.isArray(proposal.suggestedFiles) ? proposal.suggestedFiles : []), ...(Array.isArray(proposal.suggestedCommands) ? proposal.suggestedCommands : [])]
      .map(value => normalize(value))
      .filter(Boolean)
      .map(value => ({
        descriptor: value,
        reason: validation.reason,
        blockedBy: validation.blockedBy || null,
        sourceProposalId: proposal.proposalId || null,
        sourceProposalType: proposal.proposalType || null,
        requiredPolicy: context?.plannerPolicies || {},
        verificationEvidence: proposal.suggestedValidation || []
      }));
    console.log("[PROPOSAL_REJECTED]", {
      proposalId: proposal.proposalId || null,
      proposalType: proposal.proposalType || null,
      descriptorType: proposal.proposalType || null,
      reason: validation.reason,
      blockedBy: validation.blockedBy || null
    });
    return {
      decision: validation.decision,
      descriptors: [],
      proposal,
      reason: validation.reason,
      promotedDescriptors: [],
      rejectedDescriptors,
      deferredDescriptors: [],
      conflicts: [],
      diagnostics: [{
        proposalId: proposal.proposalId || null,
        proposalType: proposal.proposalType || null,
        descriptorType: proposal.proposalType || null,
        reason: validation.reason,
        blockedBy: validation.blockedBy || null
      }]
    };
  }

  const descriptors = [];
  for (const file of Array.isArray(proposal.suggestedFiles) ? proposal.suggestedFiles : []) {
    descriptors.push(createFileTaskDescriptor(proposal, file, context));
  }
  for (const command of Array.isArray(proposal.suggestedCommands) ? proposal.suggestedCommands : []) {
    descriptors.push(createCommandTaskDescriptor(proposal, command, context));
  }

  if (validation.decision === "DEFER") {
    console.log("[PROPOSAL_DEFERRED]", {
      proposalId: proposal.proposalId || null,
      proposalType: proposal.proposalType || null,
      descriptorType: proposal.proposalType || null,
      reason: validation.reason
    });
  } else {
    console.log("[PROPOSAL_PROMOTED]", {
      proposalId: proposal.proposalId || null,
      proposalType: proposal.proposalType || null,
      descriptorType: proposal.proposalType || null,
      descriptorCount: descriptors.length
    });
  }

  return {
    decision: validation.decision,
    descriptors,
    proposal,
    reason: validation.reason,
    promotedDescriptors: descriptors,
    rejectedDescriptors: [],
    deferredDescriptors: validation.decision === "DEFER" ? descriptors : [],
    conflicts: [],
    diagnostics: [{
      proposalId: proposal.proposalId || null,
      proposalType: proposal.proposalType || null,
      descriptorType: proposal.proposalType || null,
      reason: validation.reason,
      promotedCount: descriptors.length
    }]
  };
}

export function promoteProposalGraphToTasks(proposalGraph = {}, context = {}) {
  const normalizedProposalGraph = Array.isArray(proposalGraph?.proposals) ? proposalGraph : { ...proposalGraph, proposals: proposalGraph?.proposals || [] };
  const proposalList = Array.isArray(normalizedProposalGraph.proposals) ? normalizedProposalGraph.proposals : [];

  // Phase 4.29-HF2: Check proposal authority via PlannerAuthorityFirewall
  const authorityCheck = checkProposalGraphAuthority(normalizedProposalGraph);
  if (!authorityCheck.valid) {
    console.log('[MODEL_PROPOSAL_AUTHORITY_REJECTED]', {
      reason: authorityCheck.reason,
      proposalCount: proposalList.length,
      rejected: authorityCheck.rejected?.length || 0
    });
    console.log('[LEGACY_DEPRECATED]', {
      source: 'promoteProposalGraphToTasks',
      replacement: 'createExecutionPlanner',
      rejection: 'proposal authority rejected'
    });
    return {
      tasks: [],
      rejected: (authorityCheck.rejected || []).map(r => ({ proposalId: r.proposalId, reason: r.reason })),
      promotedDescriptors: [],
      rejectedDescriptors: [],
      deferredDescriptors: [],
      conflicts: [],
      diagnostics: [{
        type: 'authority_rejection',
        reason: authorityCheck.reason,
        rejected: authorityCheck.rejected || []
      }],
      proposalGraph: normalizedProposalGraph,
      executionPlanner: null
    };
  }

  const proposalFileHints = [];
  const proposalCommandHints = [];
  for (const proposal of proposalList) {
    for (const file of Array.isArray(proposal?.suggestedFiles) ? proposal.suggestedFiles : []) {
      const normalized = normalize(file);
      if (normalized) proposalFileHints.push(normalized);
    }
    for (const command of Array.isArray(proposal?.suggestedCommands) ? proposal.suggestedCommands : []) {
      const normalized = normalize(command);
      if (normalized) proposalCommandHints.push(normalized);
    }
  }
  const objective = String(
    context?.objective ||
    proposalGraph?.objective ||
    proposalGraph?.goal ||
    proposalGraph?.description ||
    proposalFileHints.map(file => `Write file: ${file}`).join('; ') ||
    proposalCommandHints.map(command => `Run command: ${command}`).join('; ') ||
    ''
  ).trim();
  const verifiedPlanningContext = context?.verifiedPlanningContext || context?.planningContext || null;
  // Phase 4.29-HF2: Do not synthesize planning context from proposal hints
  // Only pass through existing verified context — no approved files/commands from raw hints
  const promotedPlanningContext = verifiedPlanningContext || {
    verifiedFiles: [],
    verifiedCommands: []
  };
  const executionPlanner = createExecutionPlanner({
    objective,
    verifiedPlanningContext: promotedPlanningContext,
    knowledgeGraph: context?.knowledgeGraph || null,
    canonicalFileUniverse: Array.isArray(context?.canonicalFileUniverse)
      ? context.canonicalFileUniverse
      : Array.isArray(context?.workspaceState?.existingFiles)
        ? context.workspaceState.existingFiles
        : [],
    plannerPolicies: context?.plannerPolicies || {},
    projectIntent: context?.projectIntent || {},
    projectScan: context?.projectScan || context?.workspaceState?.scan || {},
    explicitRequestedNewFiles: verifiedPlanningContext?.explicitRequestedNewFiles || context?.explicitRequestedNewFiles || []
  });
  console.log('[LEGACY_PLANNER_REDIRECT]', {
    source: 'promoteProposalGraphToTasks',
    target: 'createExecutionPlanner',
    taskCount: executionPlanner.tasks.length
  });
  console.log('[LEGACY_DEPRECATED]', {
    source: 'promoteProposalGraphToTasks',
    replacement: 'createExecutionPlanner'
  });
  return {
    tasks: executionPlanner.tasks,
    rejected: [],
    promotedDescriptors: [],
    rejectedDescriptors: [],
    deferredDescriptors: [],
    conflicts: [],
    diagnostics: [],
    proposalGraph: normalizedProposalGraph,
    executionPlanner
  };

  const resolution = resolveProposalConflicts(Array.isArray(proposalGraph?.proposals) ? proposalGraph.proposals : []);
  const tasks = [];
  const rejected = [];
  const promotedDescriptors = [];
  const rejectedDescriptors = [];
  const deferredDescriptors = [];
  const diagnostics = [];
  for (const proposal of resolution.proposals) {
    const promotion = promoteProposalToDescriptors(proposal, context);
    if (promotion.decision === "REJECT") {
      rejected.push({ proposalId: proposal.proposalId, reason: promotion.reason });
      rejectedDescriptors.push(...(promotion.rejectedDescriptors || []));
      diagnostics.push(...(promotion.diagnostics || []));
      continue;
    }
    if (promotion.decision === "DEFER") {
      deferredDescriptors.push(...(promotion.deferredDescriptors || []));
      diagnostics.push(...(promotion.diagnostics || []));
      continue;
    }
    const descriptorList = Array.isArray(promotion.promotedDescriptors) ? promotion.promotedDescriptors : (Array.isArray(promotion.descriptors) ? promotion.descriptors : []);
    for (const descriptor of descriptorList) {
      if (!isPromotedDescriptor(descriptor)) {
        console.log("[TASK_GRAPH_UNPROMOTED_DESCRIPTOR_BLOCKED]", {
          proposalId: proposal.proposalId || null,
          proposalType: proposal.proposalType || null,
          descriptorType: proposal.proposalType || null,
          path: descriptor?.toolArgs?.path || descriptor?.toolArgs?.file || null,
          command: descriptor?.toolArgs?.command || null,
          reason: "descriptor missing promotion contract"
        });
        diagnostics.push({
          proposalId: proposal.proposalId || null,
          proposalType: proposal.proposalType || null,
          descriptorType: proposal.proposalType || null,
          reason: "descriptor missing promotion contract"
        });
        continue;
      }
      promotedDescriptors.push(descriptor);
      tasks.push(new Task(descriptor));
    }
    if (Array.isArray(promotion.deferredDescriptors) && promotion.deferredDescriptors.length > 0) {
      deferredDescriptors.push(...promotion.deferredDescriptors);
    }
    diagnostics.push(...(promotion.diagnostics || []));
  }
  console.log("[PLANNER_PROMOTION_SUMMARY]", {
    promotedCount: promotedDescriptors.length,
    rejectedCount: rejected.length,
    deferredCount: deferredDescriptors.length,
    conflictCount: resolution.conflicts.length
  });
  console.log("[PLANNER_PROMOTION]", {
    promotedCount: tasks.length,
    rejectedCount: rejected.length,
    conflictCount: resolution.conflicts.length
  });
  return {
    tasks,
    rejected,
    promotedDescriptors,
    rejectedDescriptors,
    deferredDescriptors,
    conflicts: resolution.conflicts,
    diagnostics,
    proposalGraph: {
      ...proposalGraph,
      proposals: resolution.proposals
    }
  };
}
