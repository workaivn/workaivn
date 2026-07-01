import fs from "node:fs/promises";
import path from "node:path";
import { resolveWorkspacePathSafe } from "../../agent/workspace.js";
import { CODE_GENERATION_STATUS } from "./types.js";

function toPosix(value = "") {
  return String(value || "").replace(/\\/g, "/").trim();
}

function normalizePath(value = "") {
  const normalized = toPosix(value).replace(/^\.\/+/, "");
  return normalized === "." ? "" : normalized;
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
}

function basenameWithoutExtension(value = "") {
  const normalized = normalizePath(value);
  const base = normalized.split("/").pop() || "";
  return base.replace(/\.[^.]+$/, "");
}

function pascalize(value = "") {
  return String(value || "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

function camelize(value = "") {
  const text = pascalize(value);
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : "";
}

function pathLooksLikeTest(value = "") {
  const normalized = normalizePath(value).toLowerCase();
  return /(?:^|\/)(?:tests?|__tests__|specs?)(?:\/|$)/.test(normalized) || /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/.test(normalized);
}

function collectPathLikeValues(value, out = []) {
  if (!value) return out;
  if (typeof value === "string") {
    const normalized = normalizePath(value);
    if (normalized) out.push(normalized);
    return out;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectPathLikeValues(entry, out);
    return out;
  }
  if (typeof value === "object") {
    for (const key of ["path", "file", "target", "targetPath", "sourcePath", "entryPoint", "route", "name"]) {
      if (value[key]) collectPathLikeValues(value[key], out);
    }
    for (const key of ["files", "paths", "targets", "dependencies", "imports", "exports", "children", "nodes", "items"]) {
      if (Array.isArray(value[key])) collectPathLikeValues(value[key], out);
    }
  }
  return out;
}

function collectEvidenceItem(source, value) {
  if (!value) return null;
  if (typeof value === "string") {
    return { source, value: value.slice(0, 240) };
  }
  if (typeof value !== "object") {
    return { source, value: String(value) };
  }
  const pathValue = normalizePath(value.path || value.file || value.target || value.targetPath || value.sourcePath || value.entryPoint || value.route || value.name || "");
  const item = {
    source,
    kind: String(value.kind || value.type || value.role || "").trim() || null
  };
  if (pathValue) item.path = pathValue;
  if (value.name && !item.name) item.name = String(value.name);
  if (value.command) item.command = String(value.command);
  if (value.message) item.message = String(value.message).slice(0, 240);
  if (value.reason) item.reason = String(value.reason).slice(0, 240);
  if (!item.path && !item.name && !item.command && !item.message && !item.reason) {
    item.value = JSON.stringify(value).slice(0, 240);
  }
  return item;
}

function flattenArtifactEvidence(source, artifact, out) {
  if (!artifact) return;
  if (Array.isArray(artifact)) {
    for (const entry of artifact) flattenArtifactEvidence(source, entry, out);
    return;
  }
  if (typeof artifact === "string") {
    const normalized = normalizePath(artifact);
    if (normalized) out.push({ source, path: normalized });
    return;
  }
  if (typeof artifact !== "object") {
    out.push({ source, value: String(artifact) });
    return;
  }
  const item = collectEvidenceItem(source, artifact);
  if (item) out.push(item);
  for (const key of ["files", "paths", "targets", "dependencies", "imports", "exports", "children", "nodes", "items"]) {
    if (Array.isArray(artifact[key])) flattenArtifactEvidence(source, artifact[key], out);
  }
}

async function readTargetContent(workspaceRoot, targetPath, allowDiskRead) {
  if (!workspaceRoot || !allowDiskRead || !targetPath) return null;
  try {
    const resolved = await resolveWorkspacePathSafe(workspaceRoot, targetPath, { allowMissing: false });
    return await fs.readFile(path.join(workspaceRoot, resolved.relativePath), "utf8");
  } catch {
    return null;
  }
}

function collectPlanTasks(executionPlan = {}) {
  return Array.isArray(executionPlan?.tasks) ? executionPlan.tasks : Array.isArray(executionPlan?.graph?.nodes) ? executionPlan.graph.nodes : [];
}

function collectPlanTargets(tasks = []) {
  const targets = [];
  for (const task of tasks) {
    const tool = String(task?.tool || "").toUpperCase();
    if (tool !== "WRITE_FILE" && tool !== "APPLY_PATCH") continue;
    const target = normalizePath(task?.toolArgs?.path || task?.toolArgs?.file || task?.toolArgs?.target || task?.targetPath || "");
    if (target) targets.push(target);
  }
  return unique(targets);
}

function collectRelatedFiles(input = {}, tasks = [], targetPath = "") {
  const related = [];
  const pushRelated = (entry, relation) => {
    const pathValue = normalizePath(entry?.path || entry?.file || entry?.target || entry?.targetPath || entry?.sourcePath || entry?.entryPoint || "");
    if (!pathValue || pathValue === targetPath) return;
    related.push({
      path: pathValue,
      relation,
      content: typeof entry?.content === "string" ? entry.content : null,
      name: entry?.name || null,
      source: entry?.source || relation
    });
  };

  const relatedCandidates = [
    ...(Array.isArray(input.relatedFiles) ? input.relatedFiles : []),
    ...(Array.isArray(input.evidenceFiles) ? input.evidenceFiles : []),
    ...(Array.isArray(input.contextFiles) ? input.contextFiles : []),
    ...(Array.isArray(input.planArtifacts) ? input.planArtifacts : []),
    ...(Array.isArray(input.blueprint?.filePlan) ? input.blueprint.filePlan : []),
    ...(Array.isArray(input.uiPlan?.pages) ? input.uiPlan.pages : []),
    ...(Array.isArray(input.uiPlan?.layouts) ? input.uiPlan.layouts : []),
    ...(Array.isArray(input.uiPlan?.widgets) ? input.uiPlan.widgets : []),
    ...(Array.isArray(input.componentTree?.components) ? input.componentTree.components : []),
    ...(Array.isArray(input.dependencyGraph?.nodes) ? input.dependencyGraph.nodes : []),
    ...(Array.isArray(input.knowledgeGraph?.nodes) ? input.knowledgeGraph.nodes : [])
  ];

  for (const candidate of relatedCandidates) pushRelated(candidate, candidate?.relation || candidate?.source || "evidence");

  const taskMap = new Map(tasks.map(task => [String(task?.id || ""), task]));
  for (const task of tasks) {
    const tool = String(task?.tool || "").toUpperCase();
    const taskTarget = normalizePath(task?.toolArgs?.path || task?.toolArgs?.file || task?.toolArgs?.target || "");
    if (!taskTarget) continue;
    if (tool === "READ_FILE" || tool === "WRITE_FILE" || tool === "APPLY_PATCH") {
      pushRelated({ path: taskTarget, name: task.goal || task.id, source: `task:${tool}` }, `task:${tool}`);
    }
    for (const dependencyId of Array.isArray(task?.dependsOn) ? task.dependsOn : []) {
      const dependencyTask = taskMap.get(String(dependencyId || ""));
      if (!dependencyTask) continue;
      const dependencyTarget = normalizePath(dependencyTask?.toolArgs?.path || dependencyTask?.toolArgs?.file || dependencyTask?.toolArgs?.target || "");
      if (dependencyTarget) {
        pushRelated({ path: dependencyTarget, name: dependencyTask.goal || dependencyTask.id, source: `dependency:${dependencyTask.tool}` }, `dependency:${dependencyTask.tool}`);
      }
    }
  }

  const uniqueByPath = new Map();
  for (const item of related) {
    if (!uniqueByPath.has(item.path)) uniqueByPath.set(item.path, item);
  }
  return [...uniqueByPath.values()];
}

export async function buildCodeContext(input = {}) {
  const task = input.task || input.executionTask || input.plannerTask || {};
  const executionPlan = input.executionPlan || input.plan || {};
  const workspaceState = input.workspaceState || {};
  const workspaceRoot = String(input.workspaceRoot || workspaceState.workspaceRoot || "").trim();
  const targetPath = normalizePath(input.targetPath || task?.toolArgs?.path || task?.toolArgs?.file || task?.toolArgs?.target || task?.targetPath || task?.expectedOutput?.path || "");
  const planTasks = collectPlanTasks(executionPlan);
  const planTargets = collectPlanTargets(planTasks);
  const relatedFiles = collectRelatedFiles(input, planTasks, targetPath);
  const readFiles = unique([
    ...(Array.isArray(input.readFiles) ? input.readFiles : []),
    ...(Array.isArray(executionPlan?.metadata?.plannerReadFiles) ? executionPlan.metadata.plannerReadFiles : []),
    ...(Array.isArray(executionPlan?.summary?.plannerReadFiles) ? executionPlan.summary.plannerReadFiles : [])
  ].map(normalizePath).filter(Boolean));
  const workspaceFiles = unique([
    ...(Array.isArray(workspaceState.existingFiles) ? workspaceState.existingFiles : []),
    ...(Array.isArray(input.workspaceFiles) ? input.workspaceFiles : [])
  ].map(normalizePath).filter(Boolean));
  const targetExists = workspaceFiles.includes(targetPath) || Boolean(input.existingFileContent);
  const existingContent = typeof input.existingFileContent === "string"
    ? input.existingFileContent
    : await readTargetContent(workspaceRoot, targetPath, input.allowDiskRead !== false && targetExists);

  const evidence = [];
  flattenArtifactEvidence("executionPlan", executionPlan, evidence);
  flattenArtifactEvidence("blueprint", input.blueprint, evidence);
  flattenArtifactEvidence("scaffoldPlan", input.scaffoldPlan, evidence);
  flattenArtifactEvidence("uiPlan", input.uiPlan, evidence);
  flattenArtifactEvidence("componentTree", input.componentTree, evidence);
  flattenArtifactEvidence("dependencyGraph", input.dependencyGraph, evidence);
  flattenArtifactEvidence("knowledgeGraph", input.knowledgeGraph, evidence);
  flattenArtifactEvidence("failureMemory", input.failureMemory, evidence);
  flattenArtifactEvidence("validationErrors", input.validationErrors, evidence);
  if (targetPath) evidence.push({ source: "task", path: targetPath });
  if (existingContent) evidence.push({ source: "existingContent", path: targetPath, value: existingContent.slice(0, 120) });

  const missingEvidence = [];
  if (!targetPath) missingEvidence.push("targetPath");
  if ((String(task?.tool || "").toUpperCase() === "APPLY_PATCH" || String(task?.kind || "").toUpperCase().includes("MODIFY")) && !existingContent) {
    missingEvidence.push("existingTargetContent");
  }
  if (!planTasks.length && !targetPath) missingEvidence.push("executionPlan");

  const context = {
    taskId: task?.id || input.taskId || null,
    task,
    executionPlan,
    workspaceRoot,
    workspaceState,
    targetPath,
    targetExists,
    existingContent,
    readFiles,
    workspaceFiles,
    planTasks,
    planTargets,
    relatedFiles,
    evidence,
    failureMemory: Array.isArray(input.failureMemory) ? input.failureMemory : (input.failureMemory ? [input.failureMemory] : []),
    validationErrors: Array.isArray(input.validationErrors) ? input.validationErrors : (input.validationErrors ? [input.validationErrors] : []),
    blueprint: input.blueprint || null,
    scaffoldPlan: input.scaffoldPlan || null,
    uiPlan: input.uiPlan || null,
    componentTree: input.componentTree || null,
    dependencyGraph: input.dependencyGraph || null,
    knowledgeGraph: input.knowledgeGraph || null,
    planScope: Array.isArray(input.planScope) ? input.planScope : planTargets,
    missingEvidence,
    status: missingEvidence.length > 0 ? CODE_GENERATION_STATUS.NEEDS_CONTEXT : CODE_GENERATION_STATUS.READY,
    objective: String(input.objective || task?.goal || executionPlan?.prompt || input.prompt || "").trim(),
    subjectName: pascalize(basenameWithoutExtension(targetPath)),
    subjectBase: basenameWithoutExtension(targetPath),
    sourceExt: path.extname(targetPath).toLowerCase(),
    targetIsTest: pathLooksLikeTest(targetPath)
  };

  return context;
}

export {
  camelize,
  collectEvidenceItem,
  collectPathLikeValues,
  basenameWithoutExtension,
  normalizePath,
  pascalize,
  pathLooksLikeTest,
  toPosix,
  unique
};

