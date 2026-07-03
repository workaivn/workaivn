import { pascalize } from "../projectIntelligence/inference.js";
import { AuthoritySource, createRecommendationAuthority } from "../../planner/authority/AuthoritySource.js";
import { consumeTaskIntent } from "./taskIntent.js";

function normalizePath(value = "") {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "")
    .trim();
}

function pathKey(value = "") {
  return normalizePath(value).toLowerCase();
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || "").trim()).filter(Boolean))];
}

function hasSignal(text = "", signals = []) {
  const lower = String(text || "").toLowerCase();
  return signals.some(signal => lower.includes(String(signal).toLowerCase()));
}

function inferGoalType(projectIntent = {}, objective = "") {
  const goalType = String(projectIntent?.goalType || "").toUpperCase();
  if (goalType) return goalType;
  const lower = String(objective || projectIntent?.prompt || projectIntent?.objective || "").toLowerCase();
  if (/\b(?:landing page|homepage|hero section|marketing site)\b/.test(lower)) return "LANDING_PAGE";
  if (/\b(?:saas app|saas platform|saas product)\b/.test(lower)) return "SAAS_APP";
  if (/\b(?:dashboard|admin panel|admin dashboard|analytics portal|metrics portal)\b/.test(lower)) return "DASHBOARD";
  return "UNKNOWN";
}

function inferSourceRoot(existingFiles = []) {
  const normalized = unique(existingFiles.map(normalizePath));
  const srcEntries = normalized.filter(file => /^src\//i.test(file) || /^app\//i.test(file));
  if (srcEntries.length > 0) return srcEntries[0].split("/")[0];
  const firstDirectory = normalized
    .map(file => file.includes("/") ? file.split("/")[0] : "")
    .find(Boolean);
  return firstDirectory || "src";
}

function inferNamingStyle(existingFiles = []) {
  const names = unique(existingFiles.map(file => normalizePath(file).split("/").pop() || ""));
  if (names.some(name => /^[A-Z]/.test(name))) return "pascal";
  return "lower";
}

export function buildEvidenceBoundPlanner({
  objective = "",
  projectScanSnapshot = {},
  verifiedPlanningContext = {},
  requestedFileDetails = [],
  existingFiles = [],
  packageScripts = {},
  detectedEntryFiles = [],
  detectedStyleFiles = [],
  detectedFrameworkEvidence = [],
  projectIntent = {},
  bootstrapProfile = null
} = {}) {
  const lowerObjective = String(objective || projectIntent?.prompt || projectIntent?.objective || "").toLowerCase();
  const taskIntent = verifiedPlanningContext?.taskIntent || projectIntent?.taskIntent || null;
  const goalType = String(taskIntent?.goalType || projectIntent?.goalType || inferGoalType(projectIntent, objective)).toUpperCase();
  if (taskIntent) {
    consumeTaskIntent("evidenceBoundPlanner", taskIntent);
  }

  if (bootstrapProfile) {
    console.log("[BOOTSTRAP_RECOMMENDATION_STRIPPED]", {
      profileId: bootstrapProfile?.id || null,
      framework: bootstrapProfile?.framework || null,
      note: "Bootstrap profile is recommendation-only; not used for candidate generation"
    });
  }

  console.log("[EVIDENCE_BOUND_PLANNER_NEUTRAL]", {
    goalType,
    existingFileCount: existingFiles.length,
    requestedFileDetailCount: requestedFileDetails.length,
    note: "Planner no longer generates domain candidates from static mappings"
  });

  return {
    goalType,
    recommendationCandidates: [],
    blockedTemplateRecommendations: [],
    matchedSignals: [],
    blockedSignals: []
  };
}
