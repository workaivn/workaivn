function normalize(value = "") {
  return String(value || "").replace(/\\/g, "/").trim();
}

function hasExplicitCreateIntent(text = "") {
  const lower = String(text || "").toLowerCase();
  return /\b(?:create|build|make|implement|generate|launch|start|initialize|scaffold|set up|setup)\b/.test(lower);
}

function hasExplicitModificationIntent(text = "") {
  const lower = String(text || "").toLowerCase();
  return /\b(?:modify|update|edit|patch|change|fix|replace|remove|delete|refactor)\b/.test(lower);
}

function hasWorkspaceFiles(workspaceState = {}, projectScan = {}, verifiedPlanningContext = {}) {
  return (
    (Array.isArray(workspaceState?.existingFiles) && workspaceState.existingFiles.length > 0) ||
    (Array.isArray(projectScan?.discoveredFiles) && projectScan.discoveredFiles.length > 0) ||
    (Array.isArray(projectScan?.files) && projectScan.files.length > 0) ||
    (Array.isArray(verifiedPlanningContext?.verifiedFiles) && verifiedPlanningContext.verifiedFiles.length > 0)
  );
}

function countWorkspaceFiles(workspaceState = {}, projectScan = {}, verifiedPlanningContext = {}) {
  const files = [
    ...(Array.isArray(workspaceState?.existingFiles) ? workspaceState.existingFiles : []),
    ...(Array.isArray(projectScan?.discoveredFiles) ? projectScan.discoveredFiles : []),
    ...(Array.isArray(projectScan?.files) ? projectScan.files : []),
    ...(Array.isArray(verifiedPlanningContext?.verifiedFiles) ? verifiedPlanningContext.verifiedFiles : [])
  ];
  return new Set(files.map(normalize).filter(Boolean).map(file => file.toLowerCase())).size;
}

export function detectProjectInitialization({
  workspaceState = {},
  projectScan = {},
  projectIntent = {},
  objective = "",
  verifiedPlanningContext = {}
} = {}) {
  const promptText = normalize(objective || projectIntent?.prompt || projectIntent?.objective || "");
  const workspaceFileCount = countWorkspaceFiles(workspaceState, projectScan, verifiedPlanningContext);
  const workspaceEmpty = workspaceFileCount === 0;
  const workspaceNearlyEmpty = workspaceFileCount > 0 && workspaceFileCount <= 2;
  const explicitCreateObjective = hasExplicitCreateIntent(promptText);
  const explicitModificationObjective = hasExplicitModificationIntent(promptText);

  const initializationMode = (workspaceEmpty || workspaceNearlyEmpty) && explicitCreateObjective && !explicitModificationObjective
    ? "PROJECT_INITIALIZATION"
    : "PROJECT_MODIFICATION";

  const objectiveAuthorityEligible = initializationMode === "PROJECT_INITIALIZATION" && explicitCreateObjective;

  if (initializationMode === "PROJECT_INITIALIZATION") {
    console.log("[PROJECT_INITIALIZATION_DETECTED]", {
      workspaceEmpty,
      workspaceNearlyEmpty,
      workspaceFileCount,
      explicitCreateObjective,
      objective: promptText.slice(0, 120)
    });
  }

  return {
    initializationMode,
    objectiveAuthorityEligible,
    workspaceEmpty,
    workspaceNearlyEmpty,
    explicitCreateObjective,
    explicitModificationObjective
  };
}
