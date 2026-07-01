import { unique } from "./utils.js";

function lower(value = "") {
  return String(value || "").toLowerCase();
}

export function analyzeRisk({
  tasks = [],
  blueprint = null,
  dependencyGraph = null,
  impactAnalysis = null,
  knowledgeGraph = null,
  workspaceState = {}
} = {}) {
  const allPaths = unique([
    ...(Array.isArray(tasks) ? tasks : []).map(task => String(task?.toolArgs?.path || task?.toolArgs?.file || task?.toolArgs?.target || "").trim()),
    ...(Array.isArray(blueprint?.filePlan) ? blueprint.filePlan.map(item => String(item.path || item.targetPath || "").trim()) : []),
    ...(Array.isArray(impactAnalysis?.affectedFiles) ? impactAnalysis.affectedFiles.map(item => String(item.path || item.file || item.targetPath || "").trim()) : []),
    ...(Array.isArray(dependencyGraph?.nodes) ? dependencyGraph.nodes.map(node => String(node.path || "").trim()) : []),
    ...(Array.isArray(knowledgeGraph?.nodes) ? knowledgeGraph.nodes.map(node => String(node.path || "").trim()) : [])
  ].filter(Boolean));

  const score = {
    count: allPaths.length,
    config: allPaths.filter(path => /(^|\/)(package\.json|tsconfig\.json|vite\.config|next\.config|composer\.json|\.csproj|pubspec\.yaml|requirements\.txt|pyproject\.toml)$/i.test(path)).length,
    runtime: allPaths.filter(path => /(^|\/)(server|app|main|index)\.(?:js|ts|tsx|py|php|cshtml|jsx)$/i.test(path)).length,
    deleteRename: (Array.isArray(tasks) ? tasks : []).some(task => ["delete", "rename"].includes(String(task.kind || "").toLowerCase())),
    largeFanOut: (Array.isArray(dependencyGraph?.edges) ? dependencyGraph.edges.length : 0) > 12,
    sharedness: (Array.isArray(knowledgeGraph?.nodes) ? knowledgeGraph.nodes.filter(node => Number(node.usageCount || 0) > 10).length : 0)
  };

  let riskLevel = "low";
  if (score.deleteRename || score.config > 0 || score.largeFanOut || score.count > 6 || score.sharedness > 0) {
    riskLevel = "high";
  } else if (score.runtime > 0 || score.count > 1) {
    riskLevel = "medium";
  }
  if (allPaths.length === 0 && Array.isArray(tasks) && tasks.length > 0) {
    riskLevel = riskLevel === "low" ? "unknown" : riskLevel;
  }

  const reasons = [];
  if (score.config > 0) reasons.push("config files affected");
  if (score.runtime > 0) reasons.push("runtime files affected");
  if (score.deleteRename) reasons.push("destructive task present");
  if (score.largeFanOut) reasons.push("large dependency fan-out");
  if (score.sharedness > 0) reasons.push("shared components impacted");

  return {
    riskLevel,
    reasons: unique(reasons),
    confidence: riskLevel === "high" ? 0.85 : riskLevel === "medium" ? 0.7 : riskLevel === "low" ? 0.6 : 0.5,
    summary: score
  };
}
