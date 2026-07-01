import { unique } from "./utils.js";

function baseRepair({ repairType, confidence, action, tool, args = {}, retryCommand = null, reason = "" }) {
  return { repairType, confidence, action, tool, args, retryCommand, reason };
}

export function classifyFailure(failure = {}) {
  const text = `${failure.error || ""}\n${failure.stderr || ""}\n${failure.message || ""}`.toLowerCase();
  const path = String(failure.path || failure.file || failure.targetPath || "").trim();
  const command = String(failure.retryCommand || failure.command || "").trim();

  if (/cannot find module|module not found|missing dependency/.test(text)) {
    return baseRepair({
      repairType: "missing_dependency",
      confidence: 0.98,
      action: "install_dependency",
      tool: "RUN_TERMINAL",
      args: command ? { command } : {},
      retryCommand: command,
      reason: "Dependency resolution failed"
    });
  }

  if (/missing script|script not found|no such script/.test(text)) {
    return baseRepair({
      repairType: "missing_script",
      confidence: 0.95,
      action: "patch_package_json",
      tool: "APPLY_PATCH",
      args: { path: "package.json" },
      retryCommand: command || null,
      reason: "Package script missing"
    });
  }

  if (/unterminated string|unexpected token|syntax error|parse error|jsx syntax error/.test(text)) {
    return baseRepair({
      repairType: "syntax_error",
      confidence: 0.9,
      action: path ? "patch_file" : "inspect_file",
      tool: path ? "APPLY_PATCH" : "READ_FILE",
      args: path ? { path } : {},
      retryCommand: command || null,
      reason: "Syntax-level failure"
    });
  }

  if (/failed import|cannot find name|cannot resolve|import error/.test(text)) {
    return baseRepair({
      repairType: "import_failure",
      confidence: 0.88,
      action: path ? "patch_file" : "read_file",
      tool: path ? "APPLY_PATCH" : "READ_FILE",
      args: path ? { path } : {},
      retryCommand: command || null,
      reason: "Import or symbol resolution failure"
    });
  }

  if (/eaddrinuse/.test(text)) {
    return baseRepair({
      repairType: "port_conflict",
      confidence: 0.9,
      action: "skip_validation",
      tool: "VALIDATE",
      args: { skipped: true, reason: "EADDRINUSE is non-fatal for build validation" },
      retryCommand: command || null,
      reason: "Port already in use"
    });
  }

  if (/php.*(executable|not found)/.test(text)) {
    return baseRepair({
      repairType: "php_missing",
      confidence: 0.95,
      action: "skip_validation",
      tool: "VALIDATE",
      args: { skipped: true, reason: "php executable not found" },
      retryCommand: command || null,
      reason: "PHP executable unavailable"
    });
  }

  if (/php.*(syntax error|parse error)/.test(text)) {
    return baseRepair({
      repairType: "php_syntax_error",
      confidence: 0.9,
      action: path ? "patch_file" : "inspect_file",
      tool: path ? "APPLY_PATCH" : "READ_FILE",
      args: path ? { path } : {},
      retryCommand: command || null,
      reason: "PHP syntax failure"
    });
  }

  if (/broken asset reference|missing include|include error/.test(text)) {
    return baseRepair({
      repairType: "broken_reference",
      confidence: 0.85,
      action: path ? "patch_file" : "inspect_file",
      tool: path ? "APPLY_PATCH" : "READ_FILE",
      args: path ? { path } : {},
      retryCommand: command || null,
      reason: "Broken reference detected"
    });
  }

  return baseRepair({
    repairType: "unknown",
    confidence: 0.5,
    action: path ? "inspect_file" : "revalidate",
    tool: path ? "READ_FILE" : "VALIDATE",
    args: path ? { path } : {},
    retryCommand: command || null,
    reason: "Fallback repair classification"
  });
}

export function summarizeRepairKnowledge(failures = []) {
  return unique((Array.isArray(failures) ? failures : []).map(failure => classifyFailure(failure).repairType));
}
