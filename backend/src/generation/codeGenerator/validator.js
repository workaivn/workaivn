import path from "node:path";
import { CODE_GENERATION_STATUS } from "./types.js";
import { normalizePath } from "./contextBuilder.js";

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
}

function isInsideWorkspace(workspaceRoot = "", targetPath = "") {
  const root = String(workspaceRoot || "").trim();
  const target = normalizePath(targetPath);
  if (!root || !target) return true;
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(root, target);
  const normalizedRoot = process.platform === "win32" ? resolvedRoot.toLowerCase() : resolvedRoot;
  const normalizedTarget = process.platform === "win32" ? resolvedTarget.toLowerCase() : resolvedTarget;
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
}

function getImportSource(item = "") {
  if (typeof item === "string") return item;
  return item?.source || item?.path || item?.target || item?.file || "";
}

function resolveRelativeImport(targetPath = "", source = "") {
  if (!String(source || "").startsWith(".")) return normalizePath(source);
  const targetDir = path.posix.dirname(normalizePath(targetPath) || ".");
  return normalizePath(path.posix.normalize(path.posix.join(targetDir, source)));
}

export function validateGeneratedOutput(output = {}, context = {}) {
  const reasons = [];
  const status = String(output?.status || "").toUpperCase();
  const targetPath = normalizePath(output?.targetPath || context?.targetPath || "");

  if (!targetPath) reasons.push("MISSING_TARGET_PATH");
  if (!isInsideWorkspace(context.workspaceRoot || context.workspaceState?.workspaceRoot || "", targetPath)) {
    reasons.push("TARGET_OUTSIDE_WORKSPACE");
  }

  if (status === CODE_GENERATION_STATUS.READY) {
    if (output.tool === "WRITE_FILE" && !String(output.content || "").trim()) reasons.push("EMPTY_WRITE_CONTENT");
    if (output.tool === "APPLY_PATCH" && !String(output.patch || "").trim()) reasons.push("EMPTY_PATCH");
    if (!output.tool) reasons.push("MISSING_TOOL");
  }

  if (status === CODE_GENERATION_STATUS.NEEDS_CONTEXT) {
    if (!Array.isArray(output.evidence) || output.evidence.length === 0) reasons.push("NO_EVIDENCE_FOR_CONTEXT_REQUEST");
  }

  const imports = Array.isArray(output.expectedImports) ? output.expectedImports : [];
  const knownFiles = unique([
    ...(Array.isArray(context.workspaceFiles) ? context.workspaceFiles : []),
    ...(Array.isArray(context.planTargets) ? context.planTargets : [])
  ].map(normalizePath));
  for (const imp of imports) {
    const source = normalizePath(getImportSource(imp));
    if (!source) continue;
    if (source.startsWith(".")) {
      const resolved = resolveRelativeImport(targetPath, source);
      if (knownFiles.includes(resolved)) continue;
      reasons.push(`MISSING_RELATIVE_IMPORT:${source}`);
      continue;
    }
    if (knownFiles.includes(source)) continue;
    if (source.includes("node:") || /^[A-Za-z@][A-Za-z0-9@/._-]*$/.test(source)) continue;
    reasons.push(`MISSING_IMPORT:${source}`);
  }

  if (Array.isArray(output.validationHints) && output.validationHints.some(hint => /TODO|lorem ipsum/i.test(String(hint)))) {
    reasons.push("PLACEHOLDER_HINT_PRESENT");
  }

  return {
    valid: reasons.length === 0,
    reasons
  };
}

export function guardGeneratedOutput(output = {}, context = {}) {
  const validation = validateGeneratedOutput(output, context);
  const status = String(output?.status || "").toUpperCase();

  if (!validation.valid && status === CODE_GENERATION_STATUS.READY) {
    return {
      status: CODE_GENERATION_STATUS.SAFETY_BLOCKED,
      reason: validation.reasons.join(", "),
      details: validation.reasons
    };
  }

  if (status === CODE_GENERATION_STATUS.NEEDS_CONTEXT || status === CODE_GENERATION_STATUS.SAFETY_BLOCKED) {
    return {
      status,
      reason: validation.reasons.join(", ") || String(output?.reason || ""),
      details: validation.reasons
    };
  }

  return {
    status: CODE_GENERATION_STATUS.READY,
    reason: "",
    details: []
  };
}
