import { REQUESTED_FILE_KIND } from "../acceptanceCriteria.js";
import { createRuntimePlan } from "../projectIntelligence/runtimePlanningIntelligence.js";
import { buildEvidenceBoundPlanner } from "./evidenceBoundPlanner.js";
import { normalizeCanonicalPath } from "../context/canonicalPath.js";

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

function inferWorkspaceDerivedFilePatterns(goalType = "") {
  const upper = String(goalType || "").toUpperCase();
  if (upper === "LANDING_PAGE" || upper === "SAAS_APP" || upper === "DASHBOARD" || upper === "ADMIN_PANEL" || upper === "FULLSTACK_APP") {
    return [
      /(^|\/)app\.(?:tsx|jsx)$/i,
      /(^|\/)main\.(?:tsx|jsx)$/i,
      /(^|\/)layout\.(?:tsx|jsx)$/i,
      /(^|\/)page\.(?:tsx|jsx)$/i,
      /(^|\/)index\.html$/i,
      /(^|\/)styles\.css$/i,
      /(^|\/)style\.css$/i,
      /(^|\/)globals\.css$/i,
      /(^|\/)navbar\.(?:tsx|jsx)$/i,
      /(^|\/)hero(?:section)?\.(?:tsx|jsx)$/i,
      /(^|\/)feature(?:grid)?\.(?:tsx|jsx)$/i,
      /(^|\/)pricing(?:grid)?\.(?:tsx|jsx)$/i,
      /(^|\/)cta(?:section)?\.(?:tsx|jsx)$/i,
      /(^|\/)footer\.(?:tsx|jsx)$/i
    ];
  }
  if (upper === "API_SERVER") {
    return [
      /(^|\/)server\.js$/i,
      /(^|\/)app\.js$/i,
      /(^|\/)routes\/index\.js$/i,
      /(^|\/)controllers\/.+\.js$/i,
      /(^|\/)middleware\/errorHandler\.js$/i
    ];
  }
  if (upper === "READ_ONLY") {
    return [];
  }
  return [
    /(^|\/)package\.json$/i,
    /(^|\/)app\.(?:tsx|jsx|js)$/i,
    /(^|\/)index\.html$/i
  ];
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
    entry.authoritySource === "planner_derived" ||
    entry.authoritySource === "workspace_derived"
  );

  const hasWorkspaceModification = existing.some(entry =>
    entry.kind === REQUESTED_FILE_KIND.EXPLICIT_MODIFICATION &&
    existingWorkspaceSet.has(canonicalPathKey(entry.path))
  );

  if (existingHasExecutableWrite && !hasWorkspaceModification) {
    console.log("[FILE_INTENT_INFERENCE]", {
      plannerDerived: existing.filter(entry => entry.authoritySource === "planner_derived").length,
      workspaceDerived: existing.filter(entry => entry.authoritySource === "workspace_derived").length,
      explicit: existing.filter(entry => entry.authoritySource === "explicit_user_request").length,
      blocked: 0
    });
    return {
      requestedFileDetails: existing,
      requestedFiles: existing.map(entry => entry.path),
      requestedFileKinds: [...new Set(existing.map(entry => entry.kind).filter(Boolean))],
      explicitRequestedNewFiles: existing
        .filter(entry => entry.kind === REQUESTED_FILE_KIND.EXPLICIT_CREATE && entry.authoritySource === "explicit_user_request")
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
      authoritySource: entry.kind === REQUESTED_FILE_KIND.EXPLICIT_MODIFICATION && existingWorkspaceSet.has(canonicalPathKey(entry.path))
        ? "workspace_derived"
        : String(entry.authoritySource || "explicit_user_request"),
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
    }));
    console.log("[FILE_INTENT_INFERENCE]", {
      plannerDerived: rebased.filter(entry => entry.authoritySource === "planner_derived").length,
      workspaceDerived: rebased.filter(entry => entry.authoritySource === "workspace_derived").length,
      explicit: rebased.filter(entry => entry.authoritySource === "explicit_user_request").length,
      blocked: 0
    });
    return {
      requestedFileDetails: rebased,
      requestedFiles: rebased.map(entry => entry.path),
      requestedFileKinds: [...new Set(rebased.map(entry => entry.kind).filter(Boolean))],
      explicitRequestedNewFiles: rebased
        .filter(entry => entry.kind === REQUESTED_FILE_KIND.EXPLICIT_CREATE && entry.authoritySource === "explicit_user_request")
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
  const workspaceEvidenceAvailable = existingWorkspaceFiles.length > 0 || existing.some(entry => entry.verified === true || entry.authoritySource === "workspace_derived");
  for (const recommendation of recommendationCandidates) {
    const path = preserveCanonicalPath(recommendation.path || recommendation.file || "");
    console.log("[RECOMMENDATION_SKIPPED_FOR_EXECUTION]", {
      path: path || null,
      authoritySource: recommendation.authoritySource || null,
      reason: recommendation.recommendationOnly === true ? "recommendation-only object" : "recommendation pipeline item"
    });

    if (!path) {
      console.log("[EXECUTION_CANDIDATE_REJECTED]", {
        path: null,
        reason: "missing path from recommendation"
      });
      blockedRecommendations.push({
        reason: "missing path from recommendation",
        recommendation
      });
      continue;
    }

    if (recommendation.modelInvented === true || String(recommendation.authoritySource || "").toLowerCase() === "model_invented") {
      console.log("[EXECUTION_CANDIDATE_REJECTED]", {
        path,
        authoritySource: recommendation.authoritySource || null,
        reason: "model invented recommendations cannot become execution"
      });
      blockedRecommendations.push({
        path,
        reason: "model invented recommendations cannot become execution",
        recommendation
      });
      continue;
    }

    if (!workspaceEvidenceAvailable && recommendation.verified !== true && String(recommendation.authoritySource || "").toLowerCase() !== "explicit_user_request") {
      console.log("[EXECUTION_CANDIDATE_REJECTED]", {
        path,
        authoritySource: recommendation.authoritySource || null,
        reason: "workspace evidence required for execution"
      });
      blockedRecommendations.push({
        path,
        reason: "workspace evidence required for execution",
        recommendation
      });
      continue;
    }

    if (existingPaths.has(canonicalPathKey(path))) {
      continue;
    }

    existingPaths.add(canonicalPathKey(path));
    const requestedKind = recommendation.requestedKind || recommendation.kind || (recommendation.verified === true ? REQUESTED_FILE_KIND.EXPLICIT_MODIFICATION : REQUESTED_FILE_KIND.EXPLICIT_CREATE);
    const authoritySource = recommendation.authoritySource || (recommendation.verified === true ? "workspace_derived" : "planner_derived");
    const executableCandidate = {
      ...recommendation,
      path,
      file: path,
      requestedKind,
      kind: recommendation.kind || requestedKind,
      authoritySource,
      recommendationOnly: false,
      executable: true,
      conditional: recommendation.conditional === true,
      explicit: recommendation.explicit === true,
      verified: recommendation.verified === true,
      plannedNewFile: recommendation.plannedNewFile === true || requestedKind === REQUESTED_FILE_KIND.EXPLICIT_CREATE,
      plannerDerived: recommendation.plannerDerived === true || authoritySource === "planner_derived",
      workspaceDerived: recommendation.workspaceDerived === true || authoritySource === "workspace_derived",
      modelInvented: recommendation.modelInvented === true,
      plannerGoal: recommendation.plannerGoal || runtimePlan.goalType || projectIntent?.goalType || null,
      reason: recommendation.reason || (authoritySource === "workspace_derived" ? "Workspace-derived execution candidate" : "Planner-derived execution candidate")
    };
    executionCandidates.push(executableCandidate);
    console.log("[EXECUTION_CANDIDATE_CREATED]", {
      path,
      authoritySource,
      reason: executableCandidate.reason
    });
  }

  const workspacePatterns = inferWorkspaceDerivedFilePatterns(evidenceBoundPlan.goalType || runtimePlan.goalType || projectIntent?.goalType || "");
  for (const file of existingWorkspaceFiles) {
    if (!workspacePatterns.some(pattern => pattern.test(file.path))) continue;
    if (existingPaths.has(canonicalPathKey(file.path))) continue;
    existingPaths.add(canonicalPathKey(file.path));
    executionCandidates.push({
      path: file.path,
      kind: REQUESTED_FILE_KIND.EXPLICIT_MODIFICATION,
      requestedKind: REQUESTED_FILE_KIND.EXPLICIT_MODIFICATION,
      authoritySource: "workspace_derived",
      recommendationOnly: false,
      executable: true,
      conditional: false,
      explicit: false,
      verified: true,
      plannedNewFile: false,
      plannerDerived: false,
      workspaceDerived: true,
      modelInvented: false,
      plannerGoal: evidenceBoundPlan.goalType || runtimePlan.goalType || projectIntent?.goalType || null,
      reason: "Workspace file selected by evidence-bound planner"
    });
    console.log("[EXECUTION_CANDIDATE_CREATED]", {
      path: file.path,
      authoritySource: "workspace_derived",
      reason: "Workspace file selected by evidence-bound planner"
    });
  }

  const merged = [...existing, ...executionCandidates];
  console.log("[FILE_INTENT_INFERENCE]", {
    plannerDerived: executionCandidates.filter(entry => entry.authoritySource === "planner_derived").length,
    workspaceDerived: executionCandidates.filter(entry => entry.authoritySource === "workspace_derived").length,
    explicit: executionCandidates.filter(entry => entry.authoritySource === "explicit_user_request").length,
    blocked: blockedRecommendations.length
  });
  return {
    requestedFileDetails: uniqueNormalized(merged).map(entry => ({
      ...entry,
      authoritySource: entry.kind === REQUESTED_FILE_KIND.EXPLICIT_MODIFICATION && existingWorkspaceSet.has(canonicalPathKey(entry.path))
        ? "workspace_derived"
        : String(entry.authoritySource || "explicit_user_request"),
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
      .filter(entry => entry.kind === REQUESTED_FILE_KIND.EXPLICIT_CREATE && entry.authoritySource === "explicit_user_request")
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
