import crypto from "node:crypto";

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeList(value = []) {
  return [...new Set(toArray(value).map(item => normalizeText(item)).filter(Boolean))];
}

function normalizeKey(value = "") {
  return normalizeText(value).replace(/\\/g, "/").toLowerCase();
}

function normalizeEvidenceRefs(value = []) {
  return normalizeList(value).map(entry => normalizeText(entry));
}

function normalizeAuthoritySource(source = "") {
  const normalized = normalizeText(source).toLowerCase();
  if (!normalized) return "unknown";
  if (normalized === "architecture") return "bootstrap_proposal";
  if (normalized === "runtime-plan") return "ui_proposal";
  if (normalized === "model-reasoning") return "model_output";
  if (normalized === "planner") return "planner_promoter";
  if (normalized === "explicit_user_request") return "explicit_user_request";
  if (normalized === "workspace_evidence") return "workspace_evidence";
  if (normalized === "verified_planning_context") return "verified_planning_context";
  if (normalized === "bootstrap_proposal" || normalized === "component_proposal" || normalized === "ui_proposal" || normalized === "planner_promoter" || normalized === "dependency_expansion") {
    return normalized;
  }
  return normalized;
}

function deriveProposalAuthority(input = {}) {
  const metadata = input.metadata && typeof input.metadata === "object" ? { ...input.metadata } : {};
  const explicitSource = normalizeText(input.authority?.source || metadata.authority?.source || "");
  const source = normalizeAuthoritySource(
    explicitSource ||
    (metadata.explicitUserRequest === true ? "explicit_user_request" : "") ||
    (metadata.workspaceEvidence === true ? "workspace_evidence" : "") ||
    input.source ||
    input.proposalSource ||
    "planner_promoter"
  );
  const confidence = normalizeText(input.authority?.confidence || metadata.authority?.confidence || "");
  const authorityConfidence = confidence || (
    source === "workspace_evidence" || source === "explicit_user_request" || source === "verified_planning_context"
      ? "verified"
      : source === "planner_promoter"
        ? "planner_approved"
        : "derived"
  );
  return {
    source,
    sourceId: normalizeText(input.authority?.sourceId || metadata.authority?.sourceId || input.proposalId || ""),
    confidence: authorityConfidence,
    evidence: input.authority?.evidence || metadata.authority?.evidence || (Array.isArray(input.evidenceRefs) ? [...input.evidenceRefs] : []),
    approvalState: normalizeText(input.authority?.approvalState || metadata.authority?.approvalState || (input.verificationStatus === "verified" && input.promotionDecision === "promote" ? "approved" : "pending")).toLowerCase() || "pending",
    approvedBy: normalizeText(input.authority?.approvedBy || metadata.authority?.approvedBy || ""),
    createdAt: normalizeText(input.authority?.createdAt || metadata.authority?.createdAt || new Date().toISOString())
  };
}

function proposalKey(proposal = {}) {
  const targets = normalizeList([
    ...toArray(proposal.suggestedFiles),
    ...toArray(proposal.suggestedCommands)
  ]).map(normalizeKey);
  return targets.length > 0 ? targets.join("|") : normalizeText(proposal.proposalId);
}

export function createProposal(input = {}) {
  const source = normalizeText(input.source) || "planner";
  const proposalSource = normalizeText(input.proposalSource) || source;
  const evidenceRefs = normalizeEvidenceRefs(input.evidenceRefs || input.metadata?.evidenceRefs || []);
  const verificationStatus = normalizeText(
    input.verificationStatus ||
    input.metadata?.verificationStatus ||
    (input.metadata?.explicitUserRequest === true ? "verified" : "")
  ).toLowerCase() || "unverified";
  const promotionDecision = normalizeText(
    input.promotionDecision ||
    input.metadata?.promotionDecision ||
    (verificationStatus === "verified" ? "promote" : "recommendation")
  ).toLowerCase();
  const proposal = {
    proposalId: normalizeText(input.proposalId) || `proposal:${crypto.randomUUID()}`,
    proposalType: normalizeText(input.proposalType).toUpperCase() || "UNKNOWN",
    source,
    proposalSource,
    confidence: Number.isFinite(Number(input.confidence)) ? Number(input.confidence) : 0.5,
    required: input.required !== false,
    description: normalizeText(input.description),
    proposalTypes: normalizeList((Array.isArray(input.proposalTypes) && input.proposalTypes.length > 0) ? input.proposalTypes : [input.proposalType]).map(value => value.toUpperCase()),
    suggestedFiles: normalizeList(input.suggestedFiles).map(file => file.replace(/\\/g, "/")),
    suggestedCommands: normalizeList(input.suggestedCommands),
    suggestedValidation: normalizeList(input.suggestedValidation),
    dependencies: normalizeList(input.dependencies),
    metadata: input.metadata && typeof input.metadata === "object" ? { ...input.metadata } : {},
    evidenceRefs,
    verificationStatus,
    promotionDecision,
    executable: input.executable === true || promotionDecision === "promote",
    status: normalizeText(input.status).toUpperCase() || "PROPOSED",
    authority: deriveProposalAuthority(input)
  };

  console.log("[PROPOSAL_CREATED]", {
    proposalId: proposal.proposalId,
    proposalType: proposal.proposalType,
    source: proposal.source,
    proposalSource: proposal.proposalSource,
    authoritySource: proposal.authority.source,
    verificationStatus: proposal.verificationStatus,
    promotionDecision: proposal.promotionDecision,
    fileCount: proposal.suggestedFiles.length,
    commandCount: proposal.suggestedCommands.length,
    validationCount: proposal.suggestedValidation.length
  });

  console.log("[PROPOSAL_AUTHORITY_ATTACHED]", {
    proposalId: proposal.proposalId,
    proposalType: proposal.proposalType,
    source: proposal.authority.source,
    confidence: proposal.authority.confidence,
    approvalState: proposal.authority.approvalState
  });

  if (proposal.verificationStatus !== "verified" || proposal.executable === false || proposal.promotionDecision !== "promote") {
    console.log("[EVIDENCE_PLANNING_RECOMMENDATION]", {
      proposalId: proposal.proposalId,
      proposalType: proposal.proposalType,
      proposalSource: proposal.proposalSource,
      verificationStatus: proposal.verificationStatus,
      promotionDecision: proposal.promotionDecision,
      evidenceRefs: proposal.evidenceRefs
    });
  }

  return proposal;
}

export function createProposalRegistry(initial = []) {
  const proposals = new Map();

  return {
    add(proposal) {
      const normalized = createProposal(proposal);
      const key = proposalKey(normalized);
      const existing = proposals.get(key);
      if (existing) {
        const merged = {
          ...existing,
          confidence: Math.max(existing.confidence, normalized.confidence),
          required: existing.required || normalized.required,
          description: existing.description || normalized.description,
          proposalSource: existing.proposalSource || normalized.proposalSource,
          proposalTypes: normalizeList([...(existing.proposalTypes || [existing.proposalType]), normalized.proposalType]),
          suggestedFiles: normalizeList([...existing.suggestedFiles, ...normalized.suggestedFiles]).map(file => file.replace(/\\/g, "/")),
          suggestedCommands: normalizeList([...existing.suggestedCommands, ...normalized.suggestedCommands]),
          suggestedValidation: normalizeList([...existing.suggestedValidation, ...normalized.suggestedValidation]),
          dependencies: normalizeList([...existing.dependencies, ...normalized.dependencies]),
          metadata: { ...existing.metadata, ...normalized.metadata },
          evidenceRefs: normalizeEvidenceRefs([...(existing.evidenceRefs || []), ...(normalized.evidenceRefs || [])]),
          verificationStatus: existing.verificationStatus === "verified" || normalized.verificationStatus === "verified" ? "verified" : (existing.verificationStatus || normalized.verificationStatus || "unverified"),
          promotionDecision: existing.promotionDecision === "promote" || normalized.promotionDecision === "promote" ? "promote" : (existing.promotionDecision || normalized.promotionDecision || "recommendation"),
          executable: existing.executable === true || normalized.executable === true,
          status: "MERGED"
        };
        proposals.set(key, merged);
        console.log("[PROPOSAL_MERGED]", {
          proposalType: merged.proposalType,
          proposalId: merged.proposalId,
          mergedCount: merged.suggestedFiles.length + merged.suggestedCommands.length
        });
        return merged;
      }
      proposals.set(key, normalized);
      return normalized;
    },
    list() {
      return [...proposals.values()];
    },
    get(key) {
      return proposals.get(normalizeText(key)) || null;
    }
  };
}

export function getProposalKey(proposal = {}) {
  return proposalKey(proposal);
}

export { normalizeKey as normalizeProposalKey };
