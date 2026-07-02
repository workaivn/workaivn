function normalize(value = "") {
  return String(value || "").replace(/\\/g, "/").trim();
}

function hasWorkspaceFiles(context = {}) {
  return Array.isArray(context?.workspaceState?.existingFiles) && context.workspaceState.existingFiles.length > 0;
}

function hasVerifiedPackageManager(context = {}) {
  const facts = context?.facts || context?.projectScan || context?.workspaceState?.scan || {};
  return Boolean(context?.derived?.verifiedPackageManager || context?.verifiedPackageManager || facts.packageManager || context?.workspaceState?.packageManager);
}

function hasVerifiedCommand(context = {}, command = "") {
  const normalized = normalize(command).toLowerCase();
  const verifiedCommands = Array.isArray(context?.derived?.verifiedCommands)
    ? context.derived.verifiedCommands
    : (Array.isArray(context?.verifiedCommands) ? context.verifiedCommands : []);
  return verifiedCommands.some(entry => normalize(entry).toLowerCase() === normalized);
}

function proposalTypes(proposal = {}) {
  return Array.isArray(proposal.proposalTypes) && proposal.proposalTypes.length > 0
    ? proposal.proposalTypes.map(type => String(type || "").toUpperCase())
    : [String(proposal.proposalType || "").toUpperCase()];
}

function hasBootstrapProvenance(proposal = {}) {
  const types = proposalTypes(proposal);
  return types.includes("BOOTSTRAP") || /^(?:architecture|runtime-plan)$/i.test(String(proposal.source || ""));
}

function hasVerifiedPromotion(proposal = {}) {
  const verificationStatus = String(proposal.verificationStatus || proposal.metadata?.verificationStatus || "").toLowerCase();
  const promotionDecision = String(proposal.promotionDecision || proposal.metadata?.promotionDecision || "").toLowerCase();
  return verificationStatus === "verified" && promotionDecision === "promote" && proposal.executable !== false;
}

function normalizePath(value = "") {
  return String(value || "").replace(/\\/g, "/").trim().toLowerCase();
}

function isProtectedScaffoldFile(file = "") {
  const normalized = normalizePath(file);
  if (!normalized) return false;
  const basename = normalized.split("/").pop();
  return /^(?:package\.json|composer\.json|pom\.xml|cargo\.toml|pubspec\.yaml|pyproject\.toml|requirements\.txt|tsconfig(?:\.[^.]+)?\.json|vite\.config\.[^.]+|webpack\.config\.[^.]+|tailwind\.config\.[^.]+|postcss\.config\.[^.]+|eslint\.config\.[^.]+|index\.html|.*\.csproj|.*\.sln)$/i.test(basename);
}

function getPlanningPolicy(context = {}, key = "") {
  return context?.plannerPolicies?.[key] === true || context?.policies?.[key] === true;
}

function hasProposalAuthority(proposal = {}) {
  const authority = proposal?.authority || proposal?.metadata?.authority || null;
  if (!authority || typeof authority !== "object") return false;
  const source = normalizeText(authority.source || "").toLowerCase();
  if (!source) return false;
  const allowed = new Set([
    "workspace_evidence",
    "explicit_user_request",
    "verified_planning_context",
    "planner_dependency",
    "bootstrap_proposal",
    "component_proposal",
    "ui_proposal",
    "recovery_proposal",
    "planner_promoter",
    "dependency_expansion"
  ]);
  return allowed.has(source);
}

function getBlockedAssumptionMatches(context = {}, file = "") {
  const normalized = normalizePath(file);
  if (!normalized) return [];
  const blocked = [];
  const candidates = [
    ...(Array.isArray(context?.blocked?.blockedRecommendations) ? context.blocked.blockedRecommendations : []),
    ...(Array.isArray(context?.blockedRecommendations) ? context.blockedRecommendations : []),
    ...(Array.isArray(context?.rejectedAssumptions) ? context.rejectedAssumptions : []),
    ...(Array.isArray(context?.unverifiedPrerequisites) ? context.unverifiedPrerequisites : [])
  ];
  for (const item of candidates) {
    const candidatePath = normalizePath(item?.path || item?.file || item?.target || item);
    if (candidatePath && candidatePath === normalized) {
      blocked.push(item);
    }
  }
  return blocked;
}

function canCreateFile(proposal = {}, context = {}, file = "") {
  if (proposal.metadata?.explicitUserRequest === true || proposal.metadata?.requestedFile === true) return true;
  if (getPlanningPolicy(context, "ALLOW_PROJECT_BOOTSTRAP")) return true;
  if (getPlanningPolicy(context, "ALLOW_NEW_PROJECT_INITIALIZATION")) return true;
  if (getPlanningPolicy(context, "ALLOW_NEW_FILE_CREATION")) return true;
  if (getPlanningPolicy(context, "ALLOW_EXISTING_PROJECT_MODIFICATION")) return true;
  return false;
}

export function validateProposal(proposal = {}, context = {}) {
  const proposalType = String(proposal.proposalType || "").toUpperCase();
  const files = Array.isArray(proposal.suggestedFiles) ? proposal.suggestedFiles.map(normalize).filter(Boolean) : [];
  const commands = Array.isArray(proposal.suggestedCommands) ? proposal.suggestedCommands.map(normalize).filter(Boolean) : [];
  const validation = {
    valid: true,
    decision: "PROMOTE",
    reason: null
  };

  console.log("[PROPOSAL_DESCRIPTOR_CHECK]", {
    proposalId: proposal.proposalId || null,
    proposalType: proposalType || null,
    descriptorType: proposalType || null,
    path: files[0] || null,
    command: commands[0] || null
  });

  if (!hasProposalAuthority(proposal)) {
    console.log("[PROPOSAL_AUTHORITY_MISSING]", {
      proposalId: proposal.proposalId || null,
      proposalType: proposalType || null,
      source: proposal.authority?.source || proposal.metadata?.authority?.source || null
    });
    validation.valid = false;
    validation.decision = "REJECT";
    validation.reason = "missing proposal authority";
    return validation;
  }

  console.log("[AUTHORITY_VALIDATED]", {
    proposalId: proposal.proposalId || null,
    proposalType: proposalType || null,
    source: proposal.authority?.source || proposal.metadata?.authority?.source || null
  });

  if (!proposalType) {
    validation.valid = false;
    validation.decision = "REJECT";
    validation.reason = "missing proposalType";
    return validation;
  }

  for (const file of files) {
    const blockedMatches = getBlockedAssumptionMatches(context, file);
    if (blockedMatches.length > 0 && !canCreateFile(proposal, context, file)) {
      console.log("[PROMOTION_DEPENDS_ON_REJECTED_ASSUMPTION]", {
        proposalId: proposal.proposalId || null,
        proposalType: proposalType || null,
        descriptorType: proposalType || null,
        path: file,
        reason: "depends_on_rejected_assumption"
      });
      validation.valid = false;
      validation.decision = "REJECT";
      validation.reason = "depends_on_rejected_assumption";
      validation.blockedBy = blockedMatches;
      return validation;
    }
  }

  if (proposal.required === false) {
    validation.decision = "DEFER";
    validation.reason = "proposal optional";
    return validation;
  }

  if (!hasVerifiedPromotion(proposal) && !proposal.metadata?.explicitUserRequest) {
    console.log("[PLANNER_PROMOTION_BLOCKED_UNVERIFIED]", {
      proposalId: proposal.proposalId || null,
      proposalType: proposalType || null,
      descriptorType: proposalType || null,
      proposalSource: proposal.proposalSource || proposal.source || null,
      verificationStatus: proposal.verificationStatus || proposal.metadata?.verificationStatus || null,
      promotionDecision: proposal.promotionDecision || proposal.metadata?.promotionDecision || null,
      evidenceRefs: proposal.evidenceRefs || proposal.metadata?.evidenceRefs || [],
      reason: "proposal must be verified before promotion"
    });
    validation.valid = false;
    validation.decision = "REJECT";
    validation.reason = "proposal must be verified before promotion";
    return validation;
  }

  if (proposalType === "BOOTSTRAP" || proposalType === "PROJECT_STRUCTURE" || proposalType === "FILE") {
    const fileIsExplicitlyRequested = proposal.metadata?.explicitUserRequest === true || proposal.metadata?.requestedFile === true;
    const bootstrapAllowed = getPlanningPolicy(context, "ALLOW_PROJECT_BOOTSTRAP");
    const newProjectAllowed = getPlanningPolicy(context, "ALLOW_NEW_PROJECT_INITIALIZATION");
    const newFileAllowed = getPlanningPolicy(context, "ALLOW_NEW_FILE_CREATION");
    const workspaceModificationAllowed = getPlanningPolicy(context, "ALLOW_EXISTING_PROJECT_MODIFICATION");
    for (const file of files) {
      const blockedMatches = getBlockedAssumptionMatches(context, file);
      if (blockedMatches.length > 0 && !canCreateFile(proposal, context, file)) {
        console.log("[PROMOTION_DEPENDS_ON_REJECTED_ASSUMPTION]", {
          proposalId: proposal.proposalId || null,
          proposalType: proposalType || null,
          descriptorType: proposalType || null,
          path: file,
          reason: "depends_on_rejected_assumption"
        });
        validation.valid = false;
        validation.decision = "REJECT";
        validation.reason = "depends_on_rejected_assumption";
        validation.blockedBy = blockedMatches;
        return validation;
      }
      if (isProtectedScaffoldFile(file) && !fileIsExplicitlyRequested && !bootstrapAllowed && !newProjectAllowed && !newFileAllowed && !workspaceModificationAllowed && !hasBootstrapProvenance(proposal)) {
        console.log("[PROMOTION_POLICY_REQUIRED]", {
          proposalId: proposal.proposalId || null,
          proposalType: proposalType || null,
          descriptorType: proposalType || null,
          path: file,
          policy: "ALLOW_PROJECT_BOOTSTRAP|ALLOW_NEW_PROJECT_INITIALIZATION|ALLOW_NEW_FILE_CREATION"
        });
        validation.valid = false;
        validation.decision = "REJECT";
        validation.reason = "promotion policy required";
        return validation;
      }
    }
    if (files.includes("package.json") && !bootstrapAllowed && proposal.metadata?.explicitUserRequest !== true && !hasBootstrapProvenance(proposal)) {
      console.log("[PROMOTION_POLICY_REQUIRED]", {
        proposalId: proposal.proposalId || null,
        proposalType: proposalType || null,
        descriptorType: proposalType || null,
        path: "package.json",
        policy: "ALLOW_PROJECT_BOOTSTRAP"
      });
      validation.valid = false;
      validation.decision = "REJECT";
      validation.reason = "bootstrap not authorized";
      return validation;
    }
    if (files.includes("index.html") && hasWorkspaceFiles(context) && !newProjectAllowed && proposal.metadata?.explicitUserRequest !== true && !hasBootstrapProvenance(proposal)) {
      console.log("[PROMOTION_FILE_UNVERIFIED]", {
        proposalId: proposal.proposalId || null,
        proposalType: proposalType || null,
        descriptorType: proposalType || null,
        path: "index.html",
        reason: "project modification mode"
      });
      validation.valid = false;
      validation.decision = "REJECT";
      validation.reason = "project modification mode";
      return validation;
    }
  }

  if (proposalType === "EXECUTION") {
    const bootstrapAllowed = getPlanningPolicy(context, "ALLOW_PROJECT_BOOTSTRAP") && hasBootstrapProvenance(proposal);
    const blocked = commands.find(command => !hasVerifiedCommand(context, command));
    if (blocked && !bootstrapAllowed) {
      console.log("[PROMOTION_COMMAND_UNVERIFIED]", {
        proposalId: proposal.proposalId || null,
        proposalType: proposalType || null,
        descriptorType: proposalType || null,
        command: blocked,
        reason: /^(?:npm|yarn|pnpm)\s+install\b/i.test(blocked) ? "unverified package manager" : "unverified execution command"
      });
      validation.valid = false;
      validation.decision = "REJECT";
      validation.blockedBy = blocked;
      validation.reason = /^(?:npm|yarn|pnpm)\s+install\b/i.test(blocked)
        ? "unverified package manager"
        : "unverified execution command";
      return validation;
    }
  }

  if (proposalType === "VALIDATION") {
    const blocked = commands.find(command => !hasVerifiedCommand(context, command) && context?.plannerPolicies?.ALLOW_VALIDATION_DERIVATION !== true);
    const bootstrapAllowed = getPlanningPolicy(context, "ALLOW_PROJECT_BOOTSTRAP") && hasBootstrapProvenance(proposal);
    if (blocked && !bootstrapAllowed) {
      console.log("[PROMOTION_COMMAND_UNVERIFIED]", {
        proposalId: proposal.proposalId || null,
        proposalType: proposalType || null,
        descriptorType: proposalType || null,
        command: blocked,
        reason: "unverified validation command"
      });
      validation.valid = false;
      validation.decision = "REJECT";
      validation.blockedBy = blocked;
      validation.reason = "unverified validation command";
      return validation;
    }
  }

  return validation;
}
