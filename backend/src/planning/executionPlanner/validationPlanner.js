import { findCommandsForValidation } from "../../analysis/knowledgeGraph/index.js";
import { unique } from "./utils.js";

function normalizeCommand(command = "") {
  return String(command || "").trim();
}

function commandPriority(command = "") {
  const text = normalizeCommand(command);
  if (!text) return 999;
  if (/build/i.test(text)) return 10;
  if (/test/i.test(text)) return 20;
  if (/lint/i.test(text)) return 30;
  if (/check|analy[sz]e|verify/i.test(text)) return 40;
  return 50;
}

function collectValidationCommandsFromPackageJson(packageJson = {}, workspaceState = {}) {
  const scripts = packageJson?.scripts || {};
  const pm = String(workspaceState?.scan?.packageManager || workspaceState?.packageManager || "").trim();
  const commands = [];
  for (const key of ["build", "test", "lint"]) {
    if (!scripts[key]) continue;
    if (pm) {
      commands.push(`${pm} run ${key}`);
    } else {
      commands.push(String(scripts[key]).trim());
    }
  }
  return commands;
}

export function planValidationCommands({
  prompt = "",
  blueprint = null,
  workspaceState = {},
  tasks = [],
  knowledgeGraph = null,
  impactAnalysis = null,
  existingPlannerState = null,
  toolAvailability = {}
} = {}) {
  const commands = [];
  const checks = [];
  const skipped = [];

  const explicit = unique([
    ...(Array.isArray(blueprint?.validation?.commands) ? blueprint.validation.commands : []),
    ...(String(blueprint?.validation?.command || "").trim() ? [blueprint.validation.command] : []),
    ...(Array.isArray(workspaceState?.scan?.testCommands) ? workspaceState.scan.testCommands : []),
    ...(Array.isArray(workspaceState?.scan?.buildCommands) ? workspaceState.scan.buildCommands : []),
    ...(Array.isArray(workspaceState?.scan?.runCommands) ? workspaceState.scan.runCommands : []),
    ...collectValidationCommandsFromPackageJson(workspaceState?.packageJson || {}, workspaceState),
    ...(knowledgeGraph ? findCommandsForValidation(knowledgeGraph, prompt).map(node => node.command || node.name || node.purpose || "").filter(Boolean) : [])
  ].map(normalizeCommand).filter(Boolean));

  const orderedCommands = explicit.sort((a, b) => commandPriority(a) - commandPriority(b) || a.localeCompare(b));
  for (const command of orderedCommands) {
    if (/^php\s+-l\s+/i.test(command) && toolAvailability.php === false) {
      skipped.push({ type: "command", command, reason: "php executable not found" });
      continue;
    }
    if (/^dotnet\s+/i.test(command) && toolAvailability.dotnet === false) {
      skipped.push({ type: "command", command, reason: "dotnet executable not found" });
      continue;
    }
    if (/^flutter\s+/i.test(command) && toolAvailability.flutter === false) {
      skipped.push({ type: "command", command, reason: "flutter executable not found" });
      continue;
    }
    if (/^python3?\s+/i.test(command) && toolAvailability.python === false) {
      skipped.push({ type: "command", command, reason: "python executable not found" });
      continue;
    }
    commands.push(command);
  }

  const criticalFiles = unique((Array.isArray(tasks) ? tasks : [])
    .flatMap(task => {
      const path = String(task?.toolArgs?.path || task?.toolArgs?.file || task?.toolArgs?.target || "").trim();
      return task?.tool === "WRITE_FILE" || task?.tool === "APPLY_PATCH" || task?.tool === "READ_FILE" ? [path] : [];
    })
    .filter(Boolean));

  if (commands.length === 0 && criticalFiles.length > 0) {
    checks.push({ type: "file-existence", files: criticalFiles });
    if (criticalFiles.some(file => /\.(?:html?|php)$/i.test(file))) {
      checks.push({ type: "local-asset-references", files: criticalFiles });
    }
  } else if (commands.length > 0) {
    checks.push({ type: "file-existence", files: criticalFiles });
  }

  if (Array.isArray(impactAnalysis?.affectedFiles) && impactAnalysis.affectedFiles.length > 0) {
    checks.push({ type: "impact-coverage", files: unique(impactAnalysis.affectedFiles.map(item => String(item.path || item.file || item.targetPath || "").trim()).filter(Boolean)) });
  }

  if (Array.isArray(existingPlannerState?.validatedFiles) && existingPlannerState.validatedFiles.length > 0) {
    checks.push({ type: "validated-existing-files", files: unique(existingPlannerState.validatedFiles.map(file => String(file || "").trim()).filter(Boolean)) });
  }

  return {
    commands,
    checks,
    skipped,
    strategy: commands.length > 0 ? "command" : "file-existence"
  };
}
