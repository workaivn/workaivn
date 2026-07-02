const PROPOSAL_AUTHORITY_SOURCES = new Set([
  'workspace_evidence',
  'explicit_user_request',
  'verified_planning_context',
  'planner_dependency',
  'bootstrap_proposal',
  'component_proposal',
  'ui_proposal',
  'recovery_proposal',
  'planner_promoter',
  'dependency_expansion'
]);

const FORBIDDEN_PROPOSAL_AUTHORITY_SOURCES = new Set([
  'model_output',
  'model output',
  'model_reasoning',
  'model-reasoning',
  'heuristic extraction',
  'framework guess',
  'template',
  'project type guess',
  'component guess',
  'natural language alone',
  'failure text alone',
  'stacktrace alone',
  'legacy parser',
  'unknown'
]);

function normalize(value = '') {
  return String(value || '').replace(/\\/g, '/').trim();
}

function normalizeSource(value = '') {
  return normalize(value).toLowerCase();
}

function getProposalAuthoritySource(proposal = {}) {
  const authority = proposal?.authority || proposal?.metadata?.authority || {};
  return normalizeSource(
    authority.source ||
    proposal.source ||
    proposal.proposalSource ||
    proposal.metadata?.authoritySource ||
    ''
  );
}

function getProposalAuthorityState(proposal = {}) {
  const authority = proposal?.authority || proposal?.metadata?.authority || {};
  return normalizeSource(
    authority.approvalState ||
    proposal.authorityState ||
    proposal.metadata?.authorityState ||
    ''
  );
}

export function checkProposalAuthority(proposal = {}) {
  const source = getProposalAuthoritySource(proposal);
  const state = getProposalAuthorityState(proposal);

  if (!source) {
    console.log('[MODEL_PROPOSAL_CANDIDATE_ONLY]', {
      proposalId: proposal.proposalId || null,
      source: source || 'none',
      reason: 'No authority source — proposal is candidate-only'
    });
    console.log('[MODEL_PROPOSAL_AUTHORITY_REJECTED]', {
      proposalId: proposal.proposalId || null,
      source: source || 'none',
      reason: 'No authority source'
    });
    return { valid: false, reason: 'no authority source', source: null };
  }

  if (FORBIDDEN_PROPOSAL_AUTHORITY_SOURCES.has(source)) {
    console.log('[MODEL_PROPOSAL_CANDIDATE_ONLY]', {
      proposalId: proposal.proposalId || null,
      source,
      reason: 'Forbidden authority source — proposal is candidate-only'
    });
    console.log('[MODEL_PROPOSAL_AUTHORITY_REJECTED]', {
      proposalId: proposal.proposalId || null,
      source,
      reason: 'Forbidden authority source'
    });
    return { valid: false, reason: 'forbidden authority source', source };
  }

  if (!PROPOSAL_AUTHORITY_SOURCES.has(source)) {
    console.log('[MODEL_PROPOSAL_CANDIDATE_ONLY]', {
      proposalId: proposal.proposalId || null,
      source,
      reason: 'Unrecognized authority source — proposal is candidate-only'
    });
    console.log('[MODEL_PROPOSAL_AUTHORITY_REJECTED]', {
      proposalId: proposal.proposalId || null,
      source,
      reason: 'Unrecognized authority source'
    });
    return { valid: false, reason: 'unrecognized authority source', source };
  }

  if (state !== 'approved' && state !== '') {
    console.log('[MODEL_PROPOSAL_CANDIDATE_ONLY]', {
      proposalId: proposal.proposalId || null,
      source,
      state,
      reason: 'Proposal not in approved state'
    });
    console.log('[MODEL_PROPOSAL_AUTHORITY_REJECTED]', {
      proposalId: proposal.proposalId || null,
      source,
      state,
      reason: 'Proposal not in approved state'
    });
    return { valid: false, reason: 'proposal not approved', source, state };
  }

  console.log('[MODEL_PROPOSAL_AUTHORITY_APPROVED]', {
    proposalId: proposal.proposalId || null,
    source,
    state: state || 'approved'
  });

  return { valid: true, reason: null, source, state: state || 'approved' };
}

export function checkProposalGraphAuthority(proposalGraph = {}) {
  const proposalList = Array.isArray(proposalGraph?.proposals)
    ? proposalGraph.proposals
    : Array.isArray(proposalGraph)
      ? proposalGraph
      : [];

  if (proposalList.length === 0) {
    console.log('[MODEL_PROPOSAL_AUTHORITY_REJECTED]', {
      reason: 'No proposals in graph',
      proposalCount: 0
    });
    return { valid: false, reason: 'no proposals' };
  }

  const results = proposalList.map(proposal => ({
    proposalId: proposal.proposalId || null,
    result: checkProposalAuthority(proposal)
  }));

  const rejected = results.filter(r => !r.result.valid);
  if (rejected.length > 0) {
    return {
      valid: false,
      reason: `${rejected.length} of ${results.length} proposals lack authority`,
      rejected: rejected.map(r => ({ proposalId: r.proposalId, reason: r.result.reason })),
      results
    };
  }

  return { valid: true, reason: null, results };
}

export function checkValidationCommandCandidate(candidate = {}) {
  const command = String(candidate.command || candidate.candidate || '').trim();
  const source = normalizeSource(candidate.source || 'raw_prompt');

  if (!command) {
    return { valid: false, reason: 'no command', status: 'empty' };
  }

  if (source === 'raw_prompt') {
    console.log('[RAW_VALIDATION_COMMAND_CANDIDATE]', {
      command,
      source,
      reason: 'Extracted from raw prompt — candidate only'
    });
    console.log('[RAW_VALIDATION_COMMAND_BLOCKED]', {
      command,
      source,
      reason: 'Raw prompt validation command cannot execute directly — must go through planner authority'
    });
    return { valid: false, reason: 'raw prompt validation command', status: 'candidate_blocked', command };
  }

  if (source === 'workspace_scan' || source === 'verified_context') {
    console.log('[VALIDATION_COMMAND_AUTHORITY_APPROVED]', {
      command,
      source,
      reason: 'Validation command from trusted source'
    });
    return { valid: true, reason: null, status: 'approved', command };
  }

  console.log('[RAW_VALIDATION_COMMAND_CANDIDATE]', {
    command,
    source,
    reason: `Unknown source "${source}" — candidate only`
  });
  console.log('[RAW_VALIDATION_COMMAND_BLOCKED]', {
    command,
    source,
    reason: 'Validation command from unknown source cannot execute directly'
  });
  return { valid: false, reason: `unknown source: ${source}`, status: 'candidate_blocked', command };
}


