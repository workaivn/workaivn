import { REQUESTED_FILE_KIND } from "../acceptanceCriteria.js";
import { createRuntimePlan } from "../projectIntelligence/runtimePlanningIntelligence.js";
import { buildEvidenceBoundPlanner } from "./evidenceBoundPlanner.js";
import { normalizeCanonicalPath } from "../context/canonicalPath.js";
import { AuthoritySource, isExecutableAuthoritySource, normalizeAuthoritySource } from "../../planner/authority/AuthoritySource.js";
import { assertNoDomainKnowledgeLeak } from "./domainKnowledgeLeakDetector.js";

function preserveCanonicalPath(value = "") {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "")
    .trim();
}

function canonicalPathKey(value = "") {
  return preserveCanonicalPath(value).toLowerCase();
}

function uniqueNormalized(entries = []) {
  const seen = new Set();
  const output = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const path = preserveCanonicalPath(entry?.path || entry?.file || entry?.target || entry?.name || entry || "");
    if (!path) continue;
    const key = canonicalPathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ ...entry, path });
  }
  return output;
}

function normalizeRequestedFileDetails(classifierRequestedFiles = []) {
  return (Array.isArray(classifierRequestedFiles) ? classifierRequestedFiles : [])
    .map(entry => {
      if (typeof entry === "string") {
        return {
          path: preserveCanonicalPath(entry),
          kind: null,
          authoritySource: "classifier",
          conditional: false,
          explicit: true,
          verified: false
        };
      }

      const path = preserveCanonicalPath(entry?.path || entry?.file || entry?.target || entry?.name || "");
      return {
        path,
        kind: entry?.kind || entry?.requestedKind || null,
        authoritySource: entry?.authoritySource || "classifier",
        conditional: entry?.conditional === true,
        explicit: entry?.explicit !== false,
        verified: entry?.verified === true,
        plannedNewFile: entry?.plannedNewFile === true || entry?.plannedNewFile === false ? entry.plannedNewFile === true : undefined
      };
    })
    .filter(entry => entry.path);
}

function uniqueNormalizedPaths(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => preserveCanonicalPath(value)).filter(Boolean))];
}

function canonicalExecutionAuthoritySource(source = "", { initialization = false } = {}) {
  const normalized = normalizeAuthoritySource(source);
  if (normalized === AuthoritySource.OBJECTIVE_AUTHORITY) return AuthoritySource.OBJECTIVE_AUTHORITY;
  if (normalized === AuthoritySource.VERIFIED_PLANNING_CONTEXT) return AuthoritySource.VERIFIED_PLANNING_CONTEXT;
  if (normalized === AuthoritySource.WORKSPACE_AUTHORITY) return AuthoritySource.WORKSPACE_AUTHORITY;
  if (initialization && normalized === AuthoritySource.RECOMMENDATION_ONLY) {
    return AuthoritySource.OBJECTIVE_AUTHORITY;
  }
  return normalized;
}

function createRejectedRecommendation(recommendation, reason, path = null) {
  return {
    reason,
    path,
    recommendation
  };
}

export function inferFileIntentCandidates({
  objective = "",
  projectIntent = {},
  workspaceState = {},
  projectScan = {},
  bootstrapProfile = null,
  requestedFileDetails = []
} = {}) {
  const existing = uniqueNormalized(requestedFileDetails);
  const existingPaths = new Set(existing.map(entry => canonicalPathKey(entry.path)));
  const existingWorkspaceFiles = uniqueNormalized(Array.isArray(workspaceState?.existingFiles) ? workspaceState.existingFiles : []);
  const existingWorkspaceSet = new Set(existingWorkspaceFiles.map(entry => canonicalPathKey(entry.path)));
  const existingHasExecutableWrite = existing.some(entry =>
    [REQUESTED_FILE_KIND.EXPLICIT_CREATE, REQUESTED_FILE_KIND.EXPLICIT_MODIFICATION].includes(entry.kind) ||
    normalizeAuthoritySource(entry.authoritySource) === AuthoritySource.MODEL_SUGGESTION ||
    normalizeAuthoritySource(entry.authoritySource) === AuthoritySource.WORKSPACE_AUTHORITY ||
    entry.explicit === true
  );

  const hasWorkspaceModification = existing.some(entry =>
    (entry.kind === REQUESTED_FILE_KIND.EXPLICIT_MODIFICATION || entry.explicit === true) &&
    existingWorkspaceSet.has(canonicalPathKey(entry.path))
  );

  if (existingHasExecutableWrite && !hasWorkspaceModification) {
    console.log("[FILE_INTENT_INFERENCE]", {
      plannerDerived: existing.filter(entry => normalizeAuthoritySource(entry.authoritySource) === AuthoritySource.MODEL_SUGGESTION).length,
      workspaceDerived: existing.filter(entry => normalizeAuthoritySource(entry.authoritySource) === AuthoritySource.WORKSPACE_AUTHORITY).length,
      explicit: existing.filter(entry => normalizeAuthoritySource(entry.authoritySource) === AuthoritySource.WORKSPACE_AUTHORITY).length,
      blocked: 0
    });
    return {
      requestedFileDetails: existing,
      requestedFiles: existing.map(entry => entry.path),
      requestedFileKinds: [...new Set(existing.map(entry => entry.kind).filter(Boolean))],
      explicitRequestedNewFiles: existing
        .filter(entry => entry.kind === REQUESTED_FILE_KIND.EXPLICIT_CREATE && normalizeAuthoritySource(entry.authoritySource) === AuthoritySource.WORKSPACE_AUTHORITY)
        .map(entry => entry.path),
      conditionalRequestedFiles: existing.filter(entry => entry.kind === REQUESTED_FILE_KIND.CONDITIONAL || entry.conditional === true).map(entry => entry.path),
      discoverIfExistsFiles: existing.filter(entry => entry.kind === REQUESTED_FILE_KIND.DISCOVER_IF_EXISTS).map(entry => entry.path),
      referenceOnlyFiles: existing.filter(entry => entry.kind === REQUESTED_FILE_KIND.REFERENCE_ONLY).map(entry => entry.path),
      derivedFiles: existing.filter(entry => entry.kind === REQUESTED_FILE_KIND.DERIVED).map(entry => entry.path),
      plannedNewFiles: existing.filter(entry => entry.kind === REQUESTED_FILE_KIND.EXPLICIT_CREATE).map(entry => entry.path),
      executionCandidates: existing,
      recommendationCandidates: [],
      blockedRecommendations: [],
      goalType: projectIntent?.goalType || null
    };
  }

  if (existingHasExecutableWrite && hasWorkspaceModification) {
    const rebased = uniqueNormalized(existing).map(entry => ({
      ...entry,
      authoritySource: canonicalExecutionAuthoritySource(
        existingWorkspaceSet.has(canonicalPathKey(entry.path))
          ? AuthoritySource.WORKSPACE_AUTHORITY
          : (entry.authoritySource || AuthoritySource.WORKSPACE_AUTHORITY)
      ),
      kind: entry.kind || entry.requestedKind || (existingWorkspaceSet.has(canonicalPathKey(entry.path)) ? REQUESTED_FILE_KIND.EXPLICIT_MODIFICATION : null),
      requestedKind: entry.requestedKind || entry.kind || (existingWorkspaceSet.has(canonicalPathKey(entry.path)) ? REQUESTED_FILE_KIND.EXPLICIT_MODIFICATION : null),
      explicit: existingWorkspaceSet.has(canonicalPathKey(entry.path))
        ? false
        : entry.explicit === true,
      verified: existingWorkspaceSet.has(canonicalPathKey(entry.path)),
      plannedNewFile: entry.plannedNewFile === true,
      plannerDerived: entry.plannerDerived === true,
      workspaceDerived: existingWorkspaceSet.has(canonicalPathKey(entry.path)),
      modelInvented: entry.modelInvented === true
    }));
    console.log("[FILE_INTENT_INFERENCE]", {
      plannerDerived: rebased.filter(entry => normalizeAuthoritySource(entry.authoritySource) === AuthoritySource.MODEL_SUGGESTION).length,
      workspaceDerived: rebased.filter(entry => normalizeAuthoritySource(entry.authoritySource) === AuthoritySource.WORKSPACE_AUTHORITY).length,
      explicit: rebased.filter(entry => normalizeAuthoritySource(entry.authoritySource) === AuthoritySource.WORKSPACE_AUTHORITY).length,
      blocked: 0
    });
    return {
      requestedFileDetails: rebased,
      requestedFiles: rebased.map(entry => entry.path),
      requestedFileKinds: [...new Set(rebased.map(entry => entry.kind).filter(Boolean))],
      explicitRequestedNewFiles: rebased
        .filter(entry => entry.kind === REQUESTED_FILE_KIND.EXPLICIT_CREATE && normalizeAuthoritySource(entry.authoritySource) === AuthoritySource.WORKSPACE_AUTHORITY)
        .map(entry => entry.path),
      conditionalRequestedFiles: rebased.filter(entry => entry.kind === REQUESTED_FILE_KIND.CONDITIONAL || entry.conditional === true).map(entry => entry.path),
      discoverIfExistsFiles: rebased.filter(entry => entry.kind === REQUESTED_FILE_KIND.DISCOVER_IF_EXISTS).map(entry => entry.path),
      referenceOnlyFiles: rebased.filter(entry => entry.kind === REQUESTED_FILE_KIND.REFERENCE_ONLY).map(entry => entry.path),
      derivedFiles: rebased.filter(entry => entry.kind === REQUESTED_FILE_KIND.DERIVED).map(entry => entry.path),
      plannedNewFiles: rebased.filter(entry => entry.kind === REQUESTED_FILE_KIND.EXPLICIT_CREATE).map(entry => entry.path),
      executionCandidates: rebased,
      recommendationCandidates: [],
      blockedRecommendations: [],
      goalType: projectIntent?.goalType || null
    };
  }

  const runtimePlan = createRuntimePlan({
    prompt: objective || projectIntent?.prompt || projectIntent?.objective || "",
    projectScan,
    workspaceState,
    projectIntent,
    bootstrapProfile
  });
  const evidenceBoundPlan = buildEvidenceBoundPlanner({
    objective,
    projectScanSnapshot: projectScan,
    verifiedPlanningContext: {
      verifiedFiles: existingWorkspaceFiles.map(entry => entry.path)
    },
    requestedFileDetails: existing,
    existingFiles: workspaceState?.existingFiles || [],
    packageScripts: workspaceState?.packageJson?.scripts || {},
    detectedEntryFiles: projectScan?.entryFiles || [],
    detectedStyleFiles: projectScan?.styleFiles || [],
    detectedFrameworkEvidence: [
      projectScan?.projectType || null,
      workspaceState?.hasReactVite ? "react-vite" : null,
      workspaceState?.hasNext ? "next" : null,
      workspaceState?.hasNodeExpress ? "node-express" : null,
      workspaceState?.hasIndexPhp ? "php" : null
    ].filter(Boolean),
    projectIntent,
    bootstrapProfile
  });

  const executionCandidates = [];
  const recommendationCandidates = Array.isArray(evidenceBoundPlan.recommendationCandidates) ? evidenceBoundPlan.recommendationCandidates : [];
  const blockedRecommendations = Array.isArray(evidenceBoundPlan.blockedTemplateRecommendations) ? [...evidenceBoundPlan.blockedTemplateRecommendations] : [];
  const workspaceEvidenceAvailable = existingWorkspaceFiles.length > 0 || existing.some(entry => entry.verified === true || normalizeAuthoritySource(entry.authoritySource) === AuthoritySource.WORKSPACE_AUTHORITY);
  for (const recommendation of recommendationCandidates) {
    const path = preserveCanonicalPath(recommendation.path || recommendation.file || "");
    const requestedAuthoritySource = normalizeAuthoritySource(
      recommendation.authoritySource ||
      recommendation.metadata?.authoritySource ||
      recommendation.promotion?.authoritySource ||
      recommendation.source ||
      ""
    );
    const canPromote = recommendation.canPromote === true || recommendation.isExecutable === true;
    console.log("[AUTHORITY_SOURCE_SELECTED]", {
      path: path || null,
      authoritySource: requestedAuthoritySource || null,
      recommendationOnly: recommendation.recommendationOnly === true,
      canPromote
    });

    if (!path) {
      console.log("[AUTHORITY_SOURCE_REJECTED]", {
        path: null,
        authoritySource: requestedAuthoritySource || null,
        reason: "missing path from recommendation"
      });
      blockedRecommendations.push(createRejectedRecommendation(recommendation, "missing path from recommendation"));
      continue;
    }

    if (recommendation.modelInvented === true || requestedAuthoritySource === AuthoritySource.MODEL_SUGGESTION) {
      console.log("[AUTHORITY_SOURCE_REJECTED]", {
        path,
        authoritySource: requestedAuthoritySource || null,
        reason: "model invented recommendations cannot become execution"
      });
      blockedRecommendations.push(createRejectedRecommendation(recommendation, "model invented recommendations cannot become execution", path));
      continue;
    }

    if (!isExecutableAuthoritySource(requestedAuthoritySource)) {
      console.log("[AUTHORITY_SOURCE_REJECTED]", {
        path,
        authoritySource: requestedAuthoritySource || null,
        reason: "recommendation authority is not executable"
      });
      blockedRecommendations.push(createRejectedRecommendation(recommendation, "recommendation authority is not executable", path));
      continue;
    }

    if (!workspaceEvidenceAvailable && recommendation.verified !== true && requestedAuthoritySource !== AuthoritySource.OBJECTIVE_AUTHORITY) {
      console.log("[AUTHORITY_SOURCE_REJECTED]", {
        path,
        authoritySource: requestedAuthoritySource || null,
        reason: "workspace evidence required for execution"
      });
      blockedRecommendations.push(createRejectedRecommendation(recommendation, "workspace evidence required for execution", path));
      continue;
    }

    if (existingPaths.has(canonicalPathKey(path))) {
      continue;
    }

    existingPaths.add(canonicalPathKey(path));
    const requestedKind = recommendation.requestedKind || recommendation.kind || (recommendation.verified === true ? REQUESTED_FILE_KIND.EXPLICIT_MODIFICATION : REQUESTED_FILE_KIND.EXPLICIT_CREATE);
    const authoritySource = canonicalExecutionAuthoritySource(requestedAuthoritySource, {
      initialization: recommendation.initializationMode === "PROJECT_INITIALIZATION"
    });
    if (!isExecutableAuthoritySource(authoritySource)) {
      console.log("[AUTHORITY_SOURCE_REJECTED]", {
        path,
        authoritySource,
        reason: "promoted recommendation must resolve to executable authority"
      });
      blockedRecommendations.push(createRejectedRecommendation(recommendation, "promoted recommendation must resolve to executable authority", path));
      continue;
    }
    const leakCheck = assertNoDomainKnowledgeLeak(recommendation, { executionCandidates }, "promote_recommendation_to_execution");
    if (leakCheck.blocked) {
      blockedRecommendations.push(createRejectedRecommendation(recommendation, `domain knowledge leak: ${leakCheck.reason}`, path));
      continue;
    }
    const executableCandidate = {
      ...recommendation,
      path,
      file: path,
      requestedKind,
      kind: recommendation.kind || requestedKind,
      authoritySource,
      recommendationOnly: false,
      executable: true,
      isExecutable: true,
      canPromote: true,
      conditional: recommendation.conditional === true,
      explicit: recommendation.explicit === true,
      verified: recommendation.verified === true,
      plannedNewFile: recommendation.plannedNewFile === true || requestedKind === REQUESTED_FILE_KIND.EXPLICIT_CREATE,
      plannerDerived: recommendation.plannerDerived === true || normalizeAuthoritySource(recommendation.metadata?.originAuthoritySource || "") === AuthoritySource.MODEL_SUGGESTION,
      workspaceDerived: recommendation.workspaceDerived === true || authoritySource === AuthoritySource.WORKSPACE_AUTHORITY,
      modelInvented: recommendation.modelInvented === true,
      plannerGoal: recommendation.plannerGoal || runtimePlan.goalType || projectIntent?.goalType || null,
      reason: recommendation.reason || (authoritySource === AuthoritySource.OBJECTIVE_AUTHORITY ? "Objective authority execution candidate" : "Verified execution candidate")
    };
    executionCandidates.push(executableCandidate);
    console.log("[AUTHORITY_PROMOTION]", {
      path,
      from: requestedAuthoritySource || null,
      to: authoritySource,
      reason: executableCandidate.reason
    });
    console.log("[EXECUTION_CANDIDATE_CREATED]", {
      path,
      authoritySource,
      reason: executableCandidate.reason
    });
  }

  const merged = [...existing];
  console.log("[FILE_INTENT_INFERENCE]", {
    plannerDerived: 0,
    workspaceDerived: existing.filter(entry => normalizeAuthoritySource(entry.authoritySource) === AuthoritySource.WORKSPACE_AUTHORITY).length,
    explicit: existing.filter(entry => normalizeAuthoritySource(entry.authoritySource) === AuthoritySource.WORKSPACE_AUTHORITY).length,
    blocked: blockedRecommendations.length
  });
  return {
    requestedFileDetails: uniqueNormalized(merged).map(entry => ({
      ...entry,
      authoritySource: canonicalExecutionAuthoritySource(
        entry.kind === REQUESTED_FILE_KIND.EXPLICIT_MODIFICATION && existingWorkspaceSet.has(canonicalPathKey(entry.path))
          ? AuthoritySource.WORKSPACE_AUTHORITY
          : entry.authoritySource || AuthoritySource.WORKSPACE_AUTHORITY
      ),
      kind: entry.kind || entry.requestedKind || null,
      requestedKind: entry.requestedKind || entry.kind || null,
      explicit: entry.kind === REQUESTED_FILE_KIND.EXPLICIT_MODIFICATION && existingWorkspaceSet.has(canonicalPathKey(entry.path))
        ? false
        : entry.explicit === true,
      verified: entry.kind === REQUESTED_FILE_KIND.EXPLICIT_MODIFICATION && existingWorkspaceSet.has(canonicalPathKey(entry.path))
        ? true
        : entry.verified === true,
      plannedNewFile: entry.plannedNewFile === true,
      plannerDerived: entry.plannerDerived === true,
      workspaceDerived: entry.kind === REQUESTED_FILE_KIND.EXPLICIT_MODIFICATION && existingWorkspaceSet.has(canonicalPathKey(entry.path))
        ? true
        : entry.workspaceDerived === true,
      modelInvented: entry.modelInvented === true
    })),
    requestedFiles: uniqueNormalized(merged).map(entry => entry.path),
    requestedFileKinds: [...new Set(uniqueNormalized(merged).map(entry => entry.kind).filter(Boolean))],
    explicitRequestedNewFiles: uniqueNormalized(merged)
      .filter(entry => entry.kind === REQUESTED_FILE_KIND.EXPLICIT_CREATE && normalizeAuthoritySource(entry.authoritySource) === AuthoritySource.WORKSPACE_AUTHORITY)
      .map(entry => entry.path),
    conditionalRequestedFiles: uniqueNormalized(merged).filter(entry => entry.kind === REQUESTED_FILE_KIND.CONDITIONAL || entry.conditional === true).map(entry => entry.path),
    discoverIfExistsFiles: uniqueNormalized(merged).filter(entry => entry.kind === REQUESTED_FILE_KIND.DISCOVER_IF_EXISTS).map(entry => entry.path),
    referenceOnlyFiles: uniqueNormalized(merged).filter(entry => entry.kind === REQUESTED_FILE_KIND.REFERENCE_ONLY).map(entry => entry.path),
    derivedFiles: uniqueNormalized(merged).filter(entry => entry.kind === REQUESTED_FILE_KIND.DERIVED).map(entry => entry.path),
    plannedNewFiles: uniqueNormalized(merged).filter(entry => entry.kind === REQUESTED_FILE_KIND.EXPLICIT_CREATE).map(entry => entry.path),
    executionCandidates,
    recommendationCandidates,
    blockedRecommendations,
    goalType: evidenceBoundPlan.goalType || runtimePlan.goalType || projectIntent?.goalType || null
  };
}

export { inferFileIntentCandidates as inferFileIntentDetails };

export function createDerivedRequestedFileDetails(options = {}) {
  return inferFileIntentCandidates(options).requestedFileDetails;
}
