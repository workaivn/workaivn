import { pascalize } from "../projectIntelligence/inference.js";

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

function detectLandingSignals(text = "") {
  const lower = String(text || "").toLowerCase();
  const signals = [];
  const patterns = [
    [/hero/, "hero"],
    [/pricing/, "pricing"],
    [/testimonial/, "testimonials"],
    [/\bfaq\b/, "faq"],
    [/\bcta\b|call to action/, "cta"],
    [/footer/, "footer"],
    [/navbar|navigation/, "navbar"],
    [/feature/, "features"],
    [/landing page|homepage|marketing site/, "landing_page"]
  ];

  for (const [pattern, signal] of patterns) {
    if (pattern.test(lower)) signals.push(signal);
  }

  return unique(signals);
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

function inferExtension(existingFiles = [], projectIntent = {}, objective = "") {
  const normalized = unique(existingFiles.map(normalizePath));
  if (normalized.some(file => /\.jsx$/i.test(file))) return "jsx";
  if (normalized.some(file => /\.tsx$/i.test(file))) return "tsx";
  if (normalized.some(file => /\.html$/i.test(file))) return "html";
  if (normalized.some(file => /\.php$/i.test(file))) return "php";
  const lower = String(objective || projectIntent?.prompt || projectIntent?.objective || "").toLowerCase();
  if (/\b(?:landing page|homepage|hero|pricing|faq|testimonial|cta|footer)\b/.test(lower)) return "jsx";
  return null;
}

function inferNamingStyle(existingFiles = []) {
  const names = unique(existingFiles.map(file => normalizePath(file).split("/").pop() || ""));
  if (names.some(name => /^[A-Z]/.test(name))) return "pascal";
  return "lower";
}

function buildSectionNameTokens(objective = "") {
  const lower = String(objective || "").toLowerCase();
  const sections = [];
  const push = (name) => { if (!sections.includes(name)) sections.push(name); };
  if (/\bnavbar\b|\bnavigation\b/.test(lower)) push("navbar");
  if (/\bhero\b/.test(lower)) push("hero");
  if (/\bpricing\b/.test(lower)) push("pricing");
  if (/\bfeature\b/.test(lower)) push("features");
  if (/\btestimonial(?:s)?\b/.test(lower)) push("testimonials");
  if (/\bfaq\b/.test(lower)) push("faq");
  if (/\bcta\b|call to action/.test(lower)) push("cta");
  if (/\bfooter\b/.test(lower)) push("footer");
  if (sections.length === 0 && /\blanding page\b|\bhomepage\b|\bmarketing site\b/.test(lower)) {
    return ["hero", "features", "pricing", "testimonials", "faq", "cta", "footer"];
  }
  return sections;
}

function buildFilePath(root, name, extension, style = "lower") {
  const fileName = style === "pascal" ? `${pascalize(name)}.${extension}` : `${name}.${extension}`;
  return normalizePath(`${root}/${fileName}`);
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
  const goalType = inferGoalType(projectIntent, objective);
  const normalizedExisting = unique([
    ...(Array.isArray(existingFiles) ? existingFiles : []),
    ...(Array.isArray(projectScanSnapshot?.discoveredFiles) ? projectScanSnapshot.discoveredFiles : []),
    ...(Array.isArray(projectScanSnapshot?.entryFiles) ? projectScanSnapshot.entryFiles : []),
    ...(Array.isArray(projectScanSnapshot?.styleFiles) ? projectScanSnapshot.styleFiles : []),
    ...(Array.isArray(detectedEntryFiles) ? detectedEntryFiles : []),
    ...(Array.isArray(detectedStyleFiles) ? detectedStyleFiles : [])
  ].map(normalizePath));
  const existingSet = new Set(normalizedExisting.map(pathKey));
  const sourceRoot = inferSourceRoot(normalizedExisting);
  const extension = inferExtension(normalizedExisting, projectIntent, objective);
  const style = inferNamingStyle(normalizedExisting);
  const landingSignals = detectLandingSignals(lowerObjective);
  const hasLandingSemantics = goalType === "LANDING_PAGE" || goalType === "SAAS_APP" || landingSignals.length > 0;
  const hasEvidenceForSections = normalizedExisting.some(file => /\.(?:jsx|tsx|html|php)$/i.test(file)) || normalizedExisting.some(file => /(^|\/)(hero|features?|pricing|testimonials?|faq|cta|footer|navbar)(?:\.[^.]+)?$/i.test(file));
  const recommendationCandidates = [];
  const blockedTemplateRecommendations = [];

  if (Array.isArray(requestedFileDetails) && requestedFileDetails.some(detail => detail && (detail.kind === "EXPLICIT_CREATE" || detail.kind === "EXPLICIT_MODIFICATION"))) {
    return {
      goalType,
      recommendationCandidates: [],
      blockedTemplateRecommendations: [],
      matchedSignals: landingSignals,
      blockedSignals: []
    };
  }

  if (hasLandingSemantics && extension) {
    const sectionTokens = buildSectionNameTokens(lowerObjective);
    const defaultTokens = sectionTokens.length > 0 ? sectionTokens : ["hero", "features", "pricing", "testimonials", "faq", "cta", "footer"];
    for (const token of defaultTokens) {
      const path = buildFilePath(sourceRoot, token, extension, style);
      const lowerPath = pathKey(path);
      const exists = existingSet.has(lowerPath);
      const authoritySource = exists ? "workspace_derived" : "planner_derived";
      const requestedKind = exists ? "EXPLICIT_MODIFICATION" : "EXPLICIT_CREATE";
      const evidence = {
        goalType,
        sourceRoot,
        extension,
        style,
        landingSignals,
        existingEvidence: normalizedExisting.filter(file => file.startsWith(`${sourceRoot}/`))
      };
      const candidate = {
        path,
        file: path,
        kind: requestedKind,
        requestedKind,
        authoritySource,
        recommendationOnly: true,
        executable: false,
        conditional: false,
        explicit: false,
        verified: exists,
        plannedNewFile: !exists,
        plannerDerived: authoritySource === "planner_derived",
        workspaceDerived: authoritySource === "workspace_derived",
        modelInvented: false,
        plannerGoal: goalType,
        reason: exists ? `Workspace evidence supports ${token}` : `Landing page objective supports ${token}`,
        feature: token,
        phase: exists ? "GENERATE_FEATURE_MODULES" : "GENERATE_BASE_FILES",
        priority: exists ? 80 : 70,
        evidence
      };
      recommendationCandidates.push(candidate);
      console.log("[RECOMMENDATION_PIPELINE_CREATED]", {
        path: candidate.path,
        authoritySource: candidate.authoritySource,
        evidence: candidate.evidence,
        reason: candidate.reason
      });
      console.log("[CASE_PRESERVATION_CHECK]", {
        original: path,
        normalized: candidate.path,
        preserved: path === candidate.path
      });
    }
  }

  if (hasLandingSemantics && !hasEvidenceForSections) {
    const profileId = /react|vite|landing page|saas|marketing site/.test(lowerObjective)
      ? "react-vite-ts"
      : (bootstrapProfile?.id || bootstrapProfile?.framework || "generic-static-html");
    console.log("[FILE_INTENT_PROMOTION_BLOCKED]", {
      path: null,
      reason: "No workspace evidence for executable file intent",
      source: "template"
    });
    blockedTemplateRecommendations.push({
      profileId,
      reason: "No workspace evidence for React/Vite bootstrap",
      evidenceRequired: ["react evidence", "entry files", "existing section files"],
      evidenceFound: {
        entryFiles: Array.isArray(projectScanSnapshot?.entryFiles) ? projectScanSnapshot.entryFiles : [],
        styleFiles: Array.isArray(projectScanSnapshot?.styleFiles) ? projectScanSnapshot.styleFiles : [],
        detectedFrameworkEvidence: unique(detectedFrameworkEvidence)
      }
    });
    console.log("[BOOTSTRAP_REINTRODUCTION_BLOCKED]", {
      path: profileId,
      source: "template",
      reason: "No workspace evidence for React/Vite bootstrap"
    });
    recommendationCandidates.push({
      profileId,
      path: buildFilePath(sourceRoot, "hero", extension || "jsx", style),
      executable: false,
      recommendationOnly: true,
      reason: "No React/Vite evidence in workspace"
    });
    console.log("[TEMPLATE_RECOMMENDATION_BLOCKED]", {
      profileId,
      reason: "No React/Vite evidence in workspace",
      evidenceRequired: ["react evidence", "entry files", "existing section files"],
      evidenceFound: {
        entryFiles: Array.isArray(projectScanSnapshot?.entryFiles) ? projectScanSnapshot.entryFiles : [],
        styleFiles: Array.isArray(projectScanSnapshot?.styleFiles) ? projectScanSnapshot.styleFiles : [],
        detectedFrameworkEvidence: unique(detectedFrameworkEvidence)
      }
    });
  }

  return {
    goalType,
    recommendationCandidates,
    blockedTemplateRecommendations,
    matchedSignals: landingSignals,
    blockedSignals: hasLandingSemantics && !hasEvidenceForSections ? ["template"] : []
  };
}
