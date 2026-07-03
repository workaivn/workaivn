function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || "").replace(/\\/g, "/").trim()).filter(Boolean))];
}

export function createPlannerRuntimeState() {
  return {
    recommendationCandidates: [],
    blockedRecommendations: [],
    verifiedRecommendations: [],
    generatedFiles: [],
    dependencyReleasedFiles: [],
    plannerApprovedFiles: []
  };
}

export function resetPlannerRuntimeState(state = null) {
  const nextState = state && typeof state === "object" ? state : createPlannerRuntimeState();
  nextState.recommendationCandidates = [];
  nextState.blockedRecommendations = [];
  nextState.verifiedRecommendations = [];
  nextState.generatedFiles = [];
  nextState.dependencyReleasedFiles = [];
  nextState.plannerApprovedFiles = [];
  console.log("[PLANNER_RUNTIME_STATE_RESET]", {
    recommendationCandidates: 0,
    blockedRecommendations: 0,
    verifiedRecommendations: 0,
    generatedFiles: 0,
    dependencyReleasedFiles: 0,
    plannerApprovedFiles: 0
  });
  return nextState;
}

export function mergeRuntimeFiles(state = null, files = []) {
  const current = state && typeof state === "object" ? state : createPlannerRuntimeState();
  current.plannerApprovedFiles = unique([...(current.plannerApprovedFiles || []), ...(Array.isArray(files) ? files : [])]);
  return current;
}
