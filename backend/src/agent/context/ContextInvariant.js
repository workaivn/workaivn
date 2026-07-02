import { getCanonicalWorkspaceFiles } from "./ProjectScanSnapshot.js";
import { normalizeCanonicalPath } from "./canonicalPath.js";

function toFacts(input = {}) {
  return input?.facts || input?.projectScan || input?.scan || {};
}

function hasPolicy(context = {}, key = "") {
  return context?.policies?.[key] === true || context?.plannerPolicies?.[key] === true;
}

function taskRequiresScanEvidence(task = {}) {
  const tool = String(task.tool || "").toUpperCase();
  if (tool === "RUN_TERMINAL") {
    return { key: "commandSource", kind: "command" };
  }
  if (tool === "READ_FILE" || tool === "WRITE_FILE" || tool === "APPLY_PATCH") {
    return { key: "pathSource", kind: "path" };
  }
  return null;
}

export function buildContextInvariantReport({
  facts = {},
  context = {},
  taskGraph = null,
  reasoning = null
} = {}) {
  const scanFacts = toFacts({ facts, ...context });
  const violations = [];
  const warnings = [];
  const canonicalFiles = getCanonicalWorkspaceFiles(scanFacts);
  const plannedFiles = (context.plannedFiles || []).map(normalizeCanonicalPath).filter(Boolean);
  const plannedSet = new Set(plannedFiles);

  console.log("[CONTEXT_INVARIANT_CHECK]", {
    scanId: scanFacts.scanId || null,
    packageJsonFound: scanFacts.packageJsonFound === true,
    entryFiles: Array.isArray(scanFacts.entryFiles) ? scanFacts.entryFiles.length : 0,
    plannedFiles: plannedFiles.length
  });

  if (scanFacts.packageJsonFound === true && context.packageJsonFound === false) {
    violations.push({
      code: "packageJsonFound_mismatch",
      reason: "context.packageJsonFound contradicts facts.packageJsonFound"
    });
  }

  const verifiedCommands = Array.isArray(context.verifiedCommands) ? context.verifiedCommands : [];
  if (verifiedCommands.some(command => /^npm\s+run\s+build\b/i.test(String(command || ""))) && scanFacts.packageJsonFound !== true) {
    violations.push({
      code: "verified_command_without_package",
      reason: "verified commands cannot be package-derived when packageJsonFound is false"
    });
  }

  if (Array.isArray(scanFacts.entryFiles) && scanFacts.entryFiles.some(file => normalizeCanonicalPath(file) === "src/app.tsx")) {
    const reasoningText = String(reasoning?.reason || reasoning?.message || reasoning?.targetReason || "").toLowerCase();
    if (reasoningText.includes("no existing entry component found")) {
      warnings.push({
        code: "entry_file_reasoning_conflict",
        reason: "reasoning rejected a ProjectScan entry file"
      });
    }
  }

  const contextFiles = [
    ...(Array.isArray(context.discoveredFiles) ? context.discoveredFiles : []),
    ...(Array.isArray(context.verifiedFiles) ? context.verifiedFiles : [])
  ];
  for (const file of contextFiles) {
    const normalized = normalizeCanonicalPath(file);
    if (!normalized) continue;
    if (!canonicalFiles.has(normalized)) {
      if (plannedSet.has(normalized)) {
        console.log("[PLANNED_FILE_ACCEPTED]", { path: normalized });
        continue;
      }
      violations.push({
        code: "CONTEXT_NON_CANONICAL_FILE_VIOLATION",
        reason: `context file ${file} is not in canonical discovered files`
      });
    }
  }

  if (taskGraph && typeof taskGraph.allNodes === "function") {
    for (const task of taskGraph.allNodes()) {
      const tool = String(task?.tool || "").toUpperCase();
      if (tool === "RUN_TERMINAL") {
        const command = String(task?.toolArgs?.command || "").trim();
        const commandSource = task?.verificationEvidence?.commandSource || task?.promotionSource || null;
        if (!commandSource) {
          violations.push({
            code: "task_context_evidence_missing",
            reason: `task ${task.id || "unknown"} missing commandSource evidence`
          });
        }
        if (/npm\s+run\s+build\b/i.test(command) && scanFacts.buildCommands && !scanFacts.buildCommands.some(value => normalizeCanonicalPath(value) === normalizeCanonicalPath(command)) && !hasPolicy(context, "ALLOW_BUILD_COMMAND") && !hasPolicy(context, "ALLOW_VALIDATION_DERIVATION")) {
          violations.push({
            code: "command_not_in_project_scan",
            reason: `RUN command ${command} is not present in project scan facts`
          });
        }
      }
      const evidenceRule = taskRequiresScanEvidence(task);
      if (evidenceRule && !task?.verificationEvidence?.[evidenceRule.key]) {
        violations.push({
          code: "task_context_evidence_missing",
          reason: `task ${task.id || "unknown"} missing ${evidenceRule.key} evidence`
        });
      }
      const targetPath = normalizeCanonicalPath(task?.toolArgs?.path || task?.toolArgs?.file || task?.toolArgs?.target || "");
      if (targetPath === "package.json" && scanFacts.packageJsonFound !== true && !hasPolicy(context, "ALLOW_PACKAGE_CREATION") && !hasPolicy(context, "ALLOW_PROJECT_BOOTSTRAP")) {
        violations.push({
          code: "package_creation_without_policy",
          reason: "Task references package.json while scan facts say it does not exist and no creation policy is set"
        });
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
    warnings
  };
}
