import fs from "node:fs/promises";
import path from "node:path";
import { Task } from "../planner/task.js";
import { listWorkspaceFiles, getWorkspaceRoot } from "../workspace.js";
import { scanProject } from "../projectScanner.js";
import { matchValidationCommand } from "../validationCommandMatcher.js";
import { bootstrapProfiles, getBootstrapProfileById } from "./bootstrapProfiles/index.js";
import { buildBootstrapTaskGraphFromArchitecture, inferArchitecture } from "./architectureInference.js";
import { buildKnowledgeGraph } from "./knowledgeGraph.js";
import { inferPrimaryConcepts, normalize } from "./inference.js";
import { buildRuntimeTaskGraph, createRuntimePlan } from "./runtimePlanningIntelligence.js";

function normalizeLower(value = "") {
  return normalize(value).toLowerCase();
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
}

function readPromptText(intent = {}) {
  return String(intent.prompt || intent.objective || intent.text || "").trim();
}

function matchAny(text, terms = []) {
  const lower = String(text || "").toLowerCase();
  return terms.some(term => lower.includes(String(term).toLowerCase()));
}

function selectBootstrapProfile(intent = {}, workspaceState = {}, registry = bootstrapProfiles) {
  const profiles = Array.isArray(registry) && registry.length ? registry : bootstrapProfiles;
  const existingFiles = workspaceState.existingFiles || [];
  const requestedFramework = String(intent.requestedFramework || "").toLowerCase();
  const requestedLanguage = String(intent.requestedLanguage || "").toLowerCase();
  const scoredProfiles = profiles
    .map((profile, index) => {
      const detected = typeof profile.detect === "function" ? profile.detect(existingFiles) === true : false;
      const matched = typeof profile.matchIntent === "function" ? profile.matchIntent(intent) === true : false;
      const framework = String(profile.framework || "").toLowerCase();
      const label = String(profile.label || "").toLowerCase();
      const language = String(profile.language || "").toLowerCase();
      const exactFrameworkMatch =
        requestedFramework === String(profile.id || "").toLowerCase() ||
        requestedFramework === framework ||
        requestedFramework === label;
      const languageMatch = requestedLanguage && requestedLanguage === language;
      const score =
        (detected ? 100 : 0) +
        (exactFrameworkMatch ? 80 : 0) +
        (matched ? 50 : 0) +
        (languageMatch ? 10 : 0);
      return { profile, index, score, detected, matched, exactFrameworkMatch };
    })
    .filter(entry => entry.score > 0)
    .sort((a, b) =>
      b.score - a.score ||
      Number(b.detected) - Number(a.detected) ||
      Number(b.matched) - Number(a.matched) ||
      a.index - b.index
    );

  const fallbackProfile = profiles.find(profile => profile.id === "generic-static-html")
    || profiles.find(profile => profile.canBootstrap !== false)
    || profiles[0]
    || null;
  const selected = scoredProfiles[0] || (fallbackProfile ? { profile: fallbackProfile, detected: false, matched: false, exactFrameworkMatch: false } : null);
  const resolved = selected?.profile || null;
  const resolvedBy = selected
    ? (selected.detected ? "workspace" : selected.exactFrameworkMatch ? "framework" : selected.matched ? "intent" : "fallback")
    : "fallback";

  return {
    ...resolved,
    resolvedBy,
    intent,
    workspaceState
  };
}

export function detectProjectIntent(prompt, criteria = {}) {
  const text = readPromptText({ prompt, objective: prompt, text: prompt });
  const lower = text.toLowerCase();

  const requestedFramework =
    /\breact\s+vite\b/i.test(text) ? "react-vite-ts" :
    /\bnext\.?js\b/i.test(text) ? "nextjs-ts" :
    /\bnode\s*[- ]?express\b/i.test(text) ? "node-express" :
    /\bphp\b/i.test(text) ? "php-plain" :
    /\blaravel\b/i.test(text) ? "laravel" :
    /\basp\.?net\b|\baspnet\b|\b\.net\b/i.test(text) ? "aspnet-core" :
    /\bfastapi\b/i.test(text) ? "python-fastapi" :
    /\bflask\b/i.test(text) ? "python-flask" :
    /\bflutter\b/i.test(text) ? "flutter" :
    /\bstatic\s+html\b|\bplain\s+html\b|\bwithout\s+framework\b/i.test(text) ? "generic-static-html" :
    null;

  const goalType =
    matchAny(lower, ["read only", "read-only", "show package", "inspect", "summarize"]) ? "READ_ONLY" :
    matchAny(lower, ["bug fix", "bugfix", "fix bug", "repair", "crash", "broken", "error"]) ? "BUG_FIX" :
    matchAny(lower, ["refactor", "restructure", "clean up", "reorganize", "rewrite"]) ? "REFACTOR" :
    matchAny(lower, ["fullstack", "full-stack", "full stack"]) ? "FULLSTACK_APP" :
    matchAny(lower, ["rest api", "api server", "backend api", "express server", "node api"]) ? "API_SERVER" :
    matchAny(lower, ["php landing page", "php website", "php admin", "php site"]) ? "LANDING_PAGE" :
    matchAny(lower, ["asp.net", "aspnet", ".net"]) ? "ADMIN_PANEL" :
    matchAny(lower, ["dashboard", "admin panel", "admin dashboard"]) ? "DASHBOARD" :
    matchAny(lower, ["saas landing page", "saas", "marketing site"]) ? "SAAS_APP" :
    matchAny(lower, ["landing page", "homepage", "hero"]) ? "LANDING_PAGE" :
    "UNKNOWN";

  return {
    prompt: text,
    goalType,
    requestedFramework,
    requestedLanguage:
      /\btypescript\b|\bts\b/i.test(text) ? "TypeScript" :
      /\bjavascript\b|\bjs\b/i.test(text) ? "JavaScript" :
      /\bphp\b/i.test(text) ? "PHP" :
      /\bc#\b|\basp\.?net\b|\b\.net\b/i.test(text) ? "C#" :
      /\bpython\b/i.test(text) ? "Python" :
      /\bdart\b|\bflutter\b/i.test(text) ? "Dart" :
      null,
    requestedFiles: Array.isArray(criteria.requestedFiles) ? [...criteria.requestedFiles] : [],
    objective: criteria.objective || text
  };
}

export async function detectWorkspaceState(workspaceRoot = "") {
  const root = workspaceRoot ? getWorkspaceRoot(workspaceRoot) : "";
  if (!root) {
    return {
      workspaceRoot: "",
      existingFiles: [],
      packageJson: null,
      scan: { projectType: "generic", packageManager: "npm", entryFiles: [], testCommands: [], buildCommands: [], runCommands: [] }
    };
  }

  const existingFiles = await listWorkspaceFiles(root, { limit: 5000 }).catch(() => []);
  const scan = await scanProject(root).catch(() => ({ projectType: "generic", packageManager: "npm", entryFiles: [], testCommands: [], buildCommands: [], runCommands: [] }));
  let packageJson = null;
  try {
    const text = await fs.readFile(path.join(root, "package.json"), "utf8");
    packageJson = JSON.parse(text);
  } catch {
    packageJson = null;
  }

  const lower = new Set(existingFiles.map(normalizeLower));
  return {
    workspaceRoot: root,
    existingFiles,
    packageJson,
    scan,
    hasPackageJson: lower.has("package.json"),
    hasIndexPhp: existingFiles.some(file => /(^|\/)index\.php$/i.test(String(file || ""))),
    hasCsproj: existingFiles.some(file => /\.csproj$/i.test(file)),
    hasLaravel: existingFiles.some(file => /(^|\/)(artisan|routes\/web\.php)$/i.test(String(file || ""))),
    hasFastapi: existingFiles.some(file => /(^|\/)(main\.py|app\/main\.py|requirements\.txt|pyproject\.toml)$/i.test(String(file || ""))),
    hasFlask: existingFiles.some(file => /(^|\/)(app\.py|requirements\.txt|pyproject\.toml)$/i.test(String(file || ""))),
    hasFlutter: existingFiles.some(file => /(^|\/)(pubspec\.yaml|lib\/main\.dart)$/i.test(String(file || ""))),
    hasReactVite: existingFiles.some(file => /(^|\/)(vite\.config\.(?:ts|js)|src\/main\.(?:tsx|jsx)|src\/App\.(?:tsx|jsx))$/i.test(String(file || ""))),
    hasNext: existingFiles.some(file => /(^|\/)(next\.config\.(?:js|ts)|app\/page\.(?:tsx|jsx)|pages\/index\.(?:tsx|jsx))$/i.test(String(file || ""))),
    hasNodeExpress: existingFiles.some(file => /^(?:src\/(?:server|app)\.js|(?:server|app)\.js)$/i.test(String(file || "").replace(/\\/g, "/"))) || !!packageJson?.dependencies?.express,
    hasStaticHtml: existingFiles.some(file => /(^|\/)(index\.html|public\/index\.html)$/i.test(String(file || "")))
  };
}

export function buildPlannerExecutionMetadata(planner) {
  const plannerNodes = planner?.graph?.allNodes?.();
  const nodes = Array.isArray(plannerNodes) ? plannerNodes : [];
  const plannerReadFiles = [];
  const plannerWriteFiles = [];
  const plannerRunCommands = [];
  const plannerValidationCommands = [];
  const plannerProtectedFiles = [];

  for (const node of nodes) {
    const tool = String(node?.tool || "").toUpperCase();
    const targetPath = normalizeLower(node?.toolArgs?.path || node?.toolArgs?.file || node?.toolArgs?.target || "");
    const command = String(node?.toolArgs?.command || "").trim();

    if (tool === "READ_FILE" && targetPath) {
      plannerReadFiles.push(targetPath);
      if (/package\.json$/i.test(targetPath) && !plannerProtectedFiles.includes(targetPath)) {
        plannerProtectedFiles.push(targetPath);
      }
    }

    if ((tool === "WRITE_FILE" || tool === "APPLY_PATCH") && targetPath) {
      plannerWriteFiles.push(targetPath);
    }

    if (tool === "RUN_TERMINAL" && command) {
      plannerRunCommands.push(command);
      const validationMatch = matchValidationCommand({ terminalCommands: [{ command, success: true, result: { exitCode: 0 } }] });
      if (validationMatch.validationPassed) {
        plannerValidationCommands.push(command);
      }
    }
  }

  const normalized = {
    plannerReadFiles: unique(plannerReadFiles.map(normalizeLower)),
    plannerWriteFiles: unique(plannerWriteFiles.map(normalizeLower)),
    plannerRunCommands: unique(plannerRunCommands.map(command => String(command || "").trim()).filter(Boolean)),
    plannerValidationCommands: unique(plannerValidationCommands.map(command => String(command || "").trim()).filter(Boolean)),
    plannerProtectedFiles: unique(plannerProtectedFiles.map(normalizeLower)),
    plannerTaskFilesByTool: {
      READ_FILE: unique(plannerReadFiles.map(normalizeLower)),
      WRITE_FILE: unique(plannerWriteFiles.map(normalizeLower)),
      RUN_TERMINAL: unique(plannerRunCommands.map(command => String(command || "").trim()).filter(Boolean))
    }
  };

  console.log("[PLANNER_EXECUTION_METADATA_NORMALIZED]", {
    plannerReadFiles: normalized.plannerReadFiles,
    plannerWriteFiles: normalized.plannerWriteFiles,
    plannerRunCommands: normalized.plannerRunCommands,
    plannerProtectedFiles: normalized.plannerProtectedFiles
  });

  return normalized;
}

export function resolveBootstrapProfile(intent = {}, workspaceState = {}, registry = bootstrapProfiles) {
  const selected = selectBootstrapProfile(intent, workspaceState, registry);
  const knowledgeGraph = buildKnowledgeGraph({
    prompt: intent.prompt || intent.objective || "",
    workspaceState,
    projectIntent: intent
  });
  const architecture = inferArchitecture({
    intent,
    workspaceState,
    knowledgeGraph
  });
  const resolvedId = selected?.resolvedBy === "fallback"
    ? architecture.framework
    : selected?.id || architecture.framework;

  return {
    ...selected,
    ...architecture,
    id: resolvedId,
    label: selected?.resolvedBy === "fallback" ? architecture.framework : selected?.label || architecture.framework,
    language: selected?.resolvedBy === "fallback" ? architecture.language || null : selected?.language || architecture.language || null,
    framework: architecture.framework,
    packageManager: selected?.packageManager || architecture.packageManager,
    canBootstrap: selected?.canBootstrap !== false && architecture.canBootstrap !== false,
    resolvedBy: selected?.resolvedBy || architecture.source || "inference",
    source: architecture.source || "inference",
    knowledgeGraph
  };
}

export function createBootstrapTaskGraph(profileInput, {
  objective = "",
  projectIntent = {},
  workspaceState = {},
  criteria = {},
  existingFiles = []
} = {}) {
  const profile = typeof profileInput === "string" ? getBootstrapProfileById(profileInput) : profileInput;
  const intent = projectIntent || {};
  const prompt = objective || intent.prompt || intent.objective || "";
  const knowledgeGraph = buildKnowledgeGraph({
    prompt,
    workspaceState,
    projectIntent: intent,
    criteria
  });
  const resolvedProfile = profile?.targetFiles || profile?.validationCommands
    ? profile
    : inferArchitecture({ intent, workspaceState, knowledgeGraph });
  const runtimePlan = createRuntimePlan({
    prompt,
    projectScan: workspaceState?.scan || {},
    workspaceState,
    projectIntent: intent,
    bootstrapProfile: resolvedProfile,
    toolAvailability: criteria?.toolAvailability || workspaceState?.toolAvailability || {},
    failure: criteria?.failure || null
  });

  if (!runtimePlan) return { profile: null, tasks: [] };

  if (runtimePlan.canBootstrap === false) {
    return { profile: resolvedProfile, tasks: [], validationSkipped: [] };
  }

  const taskGraph = buildRuntimeTaskGraph(runtimePlan, {
    objective,
    projectIntent: intent,
    workspaceState,
    criteria
  });

  console.log("[BOOTSTRAP_TASK_GRAPH_CREATED]", {
    profile: taskGraph.profileId,
    taskCount: taskGraph.tasks.length,
    validationSkipped: taskGraph.validationSkipped || [],
    runtimeGoalType: runtimePlan.goalType,
    runtimeProfile: runtimePlan.targetProfile?.id || null
  });

  return taskGraph;
}

export { buildKnowledgeGraph } from "./knowledgeGraph.js";
export { inferArchitecture } from "./architectureInference.js";
export { inferPrimaryConcepts } from "./inference.js";
export { createRuntimePlan, buildRuntimeTaskGraph } from "./runtimePlanningIntelligence.js";
