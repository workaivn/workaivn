import fs from "fs/promises";
import path from "path";
import { resolveWorkspacePathSafe } from "./workspace.js";
const DEBUG = () => process.env.DEBUG_AGENT === "true" || process.env.WORKAI_AGENT_DEBUG === "true";

const MEANINGFUL_EXTENSIONS = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx",
  ".json", ".css", ".scss", ".html", ".vue", ".svelte",
  ".py", ".java", ".go", ".rs", ".php", ".rb", ".sql"
]);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function isMeaningfulFile(file) {
  const normalized = String(file || "").replace(/\\/g, "/").toLowerCase();
  if (!MEANINGFUL_EXTENSIONS.has(path.extname(normalized))) return false;
  return !/(^|\/)(?:dist|build|coverage|generated|node_modules)\//.test(normalized);
}

function classifyLayer(file) {
  const normalized = String(file || "").toLowerCase();
  if (/test|spec/.test(normalized)) return "test";
  if (/route|controller|service|api|backend|server/.test(normalized)) return "backend";
  if (/component|page|view|frontend|ui|style|css/.test(normalized)) return "frontend";
  if (/model|schema|database|migration|sql/.test(normalized)) return "data";
  if (/package\.json|config|vite|webpack|env\.example/.test(normalized)) return "config";
  return "core";
}

function isValidationCommand(command) {
  const cmd = String(command || "");
  const patterns = [
    /\b(?:npm|pnpm|yarn)\s+test\b/i,
    /\b(?:npm|pnpm|yarn)\s+run\s+[A-Za-z0-9:_\-]+\b/i, // accept any script name like check_test
    // npm run with common silent flags before or after 'run'
    /\bnpm\s+(?:--silent|-s)\s+run\s+[A-Za-z0-9:_\-]+\b/i,
    /\bnpm\s+run\s+(?:--silent|-s)\s*[A-Za-z0-9:_\-]+\b/i,
    // yarn/pnpm allow running scripts without 'run'
    /\b(?:yarn|pnpm)\s+(?:--silent|-s\s+)?[A-Za-z0-9:_\-]+\b/i,
    /\bnode\s+--check\b/i,
    /\bpytest\b/i,
    /\bpython\s+-m\s+(?:pytest|compileall)\b/i,
    /\bcargo\s+(?:test|check)\b/i,
    /\bgo\s+test\b/i,
    /\bdotnet\s+(?:test|build)\b/i,
    /\bmvn\s+test\b/i,
    /\bgradle\w*\s+(?:test|build)\b/i
  ];
  return patterns.some(rx => rx.test(cmd));
}

async function readChangedFileEvidence(workspaceRoot, changedFiles) {
  const evidence = [];

  for (const file of changedFiles) {
    try {
      const resolved = await resolveWorkspacePathSafe(workspaceRoot, file);
      const stats = await fs.stat(resolved.absolutePath);
      if (!stats.isFile() || stats.size > 1024 * 1024) continue;
      evidence.push({
        file,
        content: await fs.readFile(resolved.absolutePath, "utf8")
      });
    } catch {
      // Deleted, binary, or inaccessible files still remain in the diff evidence.
    }
  }

  return evidence;
}

export async function evaluateQualityGate({
  acceptanceCriteria,
  changedFiles = [],
  toolCalls = [],
  workspaceRoot = "",
  finalText = ""
}) {
  const criteria = acceptanceCriteria || {};
  const taskType = criteria.taskType || "CODING";
  const mode = criteria.taskMode || (taskType === "CHAT" ? "qa" : (taskType === "CODING" ? "coding" : "read_only"));
  if (DEBUG()) {
    const filesRead = toolCalls.filter(call => call.tool === "READ_FILE" && call.success).map(call => call.result?.file || call.args?.path);
    const terminals = toolCalls.filter(call => call.tool === "RUN_TERMINAL");
    console.log("[QUALITY_GATE][INPUT]", {
      mode,
      taskType,
      requestedFiles: criteria.requestedFiles || [],
      filesRead,
      changedFiles,
      terminalCommands: terminals.map(c => ({ cmd: c.args?.command, success: c.success }))
    });
  }

  // ── QA mode: final text required only ────────────────
  if (mode === "qa") {
    const out = {
      passed: !!String(finalText || "").trim(),
      evaluatedAt: new Date(),
      score: String(finalText || "").trim() ? 100 : 0,
      checks: [{ id: "qa_final", passed: !!String(finalText || "").trim(), message: "Final answer must be present." }],
      failures: String(finalText || "").trim() ? [] : ["No final text"],
      feedback: String(finalText || "").trim() ? "Quality gate passed." : "No final text",
      evidence: { filesChanged: [], filesRead: [], layers: [] }
    };
    if (DEBUG()) console.log("[QUALITY_GATE][OUTPUT]", { passed: out.passed, score: out.score, failures: out.failures });
    return out;
  }

  // Build successful read set once
  const successfulReads = toolCalls.filter(call => call.tool === "READ_FILE" && call.success);
  const successfulReadPaths = unique(successfulReads.map(call => String(call.result?.file || call.args?.path || "").replace(/\\/g, "/").toLowerCase())).filter(Boolean);

  // ── READ_ONLY mode: require requested files were read and final text exists ──
  if (mode === "read_only") {
    const required = (criteria.requestedFiles || []).map(f => String(f || "").replace(/\\/g, "/").toLowerCase()).filter(Boolean);
    const missing = required.filter(f => !successfulReadPaths.includes(f));
    const nonEmptyFinal = !!String(finalText || "").trim();
    const passed = missing.length === 0 && nonEmptyFinal;
    const out = {
      passed,
      evaluatedAt: new Date(),
      score: passed ? 100 : 0,
      checks: [
        { id: "requested_files_read", passed: missing.length === 0, message: missing.length ? `Missing reads: ${missing.join(", ")}` : "All requested files were read." },
        { id: "final_present", passed: nonEmptyFinal, message: "Final answer must be present." },
        { id: "no_file_changes", passed: changedFiles.length === 0, message: changedFiles.length ? "No file modifications allowed for read-only tasks." : "No files were modified." }
      ],
      failures: passed ? [] : [
        ...(missing.length ? [`Requested files not read: ${missing.join(", ")}`] : []),
        ...(nonEmptyFinal ? [] : ["No final text"]),
        ...(changedFiles.length ? ["Files changed in read-only task"] : [])
      ],
      feedback: passed ? "Quality gate passed." : "Quality gate failed: ensure requested files are read and provide a final answer.",
      evidence: {
        filesRead: unique(successfulReads.map(call => call.result?.file || call.args?.path)),
        filesChanged: [],
        layers: []
      }
    };
    if (DEBUG()) console.log("[QUALITY_GATE][OUTPUT]", { passed: out.passed, score: out.score, failures: out.failures });
    return out;
  }

  // Remove behavior-based pass: explicit modes now handle read-only logic

  const meaningfulFiles = unique(changedFiles).filter(isMeaningfulFile);
  // successfulReads already computed above
  const successfulToolCalls = toolCalls.filter(call =>
    call.success && ["READ_FILE", "LIST_FILES", "SEARCH_FILES"].includes(call.tool)
  );
  const terminalCalls = toolCalls.filter(call => call.tool === "RUN_TERMINAL");
  const successfulCommands = terminalCalls.filter(call => call.success && isValidationCommand(call.args?.command));
  const successfulValidations = toolCalls.filter(call => call.tool === "VALIDATE_PATCH" && call.success);
  const failedValidations = toolCalls.filter(call => call.tool === "VALIDATE_PATCH" && !call.success);
  const packageJsonInspected = successfulReads.some(call =>
    /(^|\/)package\.json$/i.test(call.result?.file || call.args?.path || "")
  );
  const layers = unique(meaningfulFiles.map(classifyLayer));
  const changedEvidence = workspaceRoot
    ? await readChangedFileEvidence(workspaceRoot, meaningfulFiles)
    : [];
  const changedCodeText = changedEvidence.map(item => item.content).join("\n").toLowerCase();
  const combinedText = [
    finalText,
    changedCodeText
  ].join("\n").toLowerCase();
  const failures = [];
  const checks = [];

  function check(id, passed, message, evidence = null) {
    checks.push({ id, passed, message, evidence });
    if (!passed) failures.push(message);
  }

  // ── SEARCH: require at least one successful read/list ──
  if (taskType === "SEARCH") {
    check(
      "files_read",
      successfulToolCalls.length > 0,
      "Read at least one file or list directory contents.",
      successfulToolCalls.map(call => call.result?.file || call.args?.path)
    );
  }

  // ── ANALYSIS: require at least one READ_FILE ──────────
  if (taskType === "ANALYSIS") {
    check(
      "files_read",
      successfulReads.length >= 1,
      "Read at least one file to analyze.",
      successfulReads.map(call => call.result?.file || call.args?.path)
    );
  }

  // ── CODING: existing strict checks ────────────────────
  if (mode === "coding" || taskType === "product_build") {
    // Determine if objective explicitly requests terminal validation
    const objective = String(criteria.objective || "");
    const objectiveRequiresTerminal = /\b(?:npm|pnpm|yarn|node|pytest|go\s+test|cargo\s+(?:test|check)|dotnet|mvn|gradle|build|test|run)\b/i.test(objective);

    const meaningfulChanged = meaningfulFiles.length > 0;
    check(
      "workspace_changes",
      meaningfulChanged,
      "No meaningful source files were changed.",
      meaningfulFiles
    );

    let validationMessage = "Run at least one successful validation command from the workspace root.";
    // Enforce validation for all CODING tasks regardless of criteria flag
    if (successfulCommands.length === 0) {
      const recognized = terminalCalls.filter(c => isValidationCommand(c.args?.command));
      const preview = (s) => String(s || "").replace(/\s+/g, " ").slice(0, 120);
      if (terminalCalls.length > 0) {
        const lines = [];
        if (recognized.length === 0) {
          for (const c of terminalCalls) {
            lines.push(`- Not recognized as validation: "${c.args?.command || "(unknown)"}"`);
          }
        } else {
          for (const c of recognized) {
            const status = c.success ? "OK" : "FAILED";
            const exit = (c.result?.exitCode !== undefined && c.result?.exitCode !== null) ? ` exit ${c.result.exitCode}` : "";
            const err = preview(c.result?.stderr);
            const out = preview(c.result?.stdout);
            const details = [out ? `STDOUT: ${out}` : "", err ? `STDERR: ${err}` : ""].filter(Boolean).join(" | ");
            lines.push(`- ${status}${exit}: "${c.args?.command || "(unknown)"}"${details ? ` — ${details}` : ""}`);
          }
        }
        validationMessage = `${validationMessage}\n${lines.join("\n")}`;
      }
    }
    check(
      "validation_command",
      successfulCommands.length > 0,
      validationMessage,
      successfulCommands.map(call => call.args?.command)
    );

    check(
      "patch_validation",
      (meaningfulFiles.length > 0 &&
        successfulValidations.length > 0 &&
        failedValidations.length === 0),
      "Changed files must pass patch validation.",
      {
        passed: successfulValidations.map(call => call.args?.file),
        failed: failedValidations.map(call => call.args?.file)
      }
    );
  }

  const placeholders = (criteria.forbiddenPlaceholders || [])
    .filter(placeholder => combinedText.includes(placeholder.toLowerCase()));
  check(
    "no_placeholders",
    placeholders.length === 0,
    `Incomplete placeholder text remains: ${placeholders.join(", ") || "none"}.`,
    placeholders
  );

  if (criteria.requiresPackageJsonInspection) {
    check(
      "package_json_inspected",
      packageJsonInspected,
      "Inspect package.json before completing this product build.",
      successfulReads.map(call => call.result?.file || call.args?.path)
    );
  }

  if (criteria.taskClass === "product_build") {
    const enoughFiles = meaningfulFiles.length >= Number(criteria.minimumMeaningfulFiles || 8);
    const realStackIntegration =
      packageJsonInspected &&
      meaningfulFiles.length >= 3 &&
      layers.length >= 2;

    check(
      "implementation_scope",
      enoughFiles || realStackIntegration,
      `Product builds require at least ${criteria.minimumMeaningfulFiles || 8} meaningful files or a real multi-layer integration with the existing stack.`,
      { meaningfulFileCount: meaningfulFiles.length, layers }
    );

    const onlyMinimalFrontend = meaningfulFiles.length <= 2 &&
      meaningfulFiles.every(file => /(?:^|\/)(?:index\.html|app\.(?:js|jsx|ts|tsx))$/i.test(file));
    check(
      "not_minimal_mock",
      !onlyMinimalFrontend,
      "A product build cannot consist only of index.html and app.js.",
      meaningfulFiles
    );
  }

  for (const flow of criteria.requiredFlows || []) {
    const patterns = {
      cart: /\bcart\b|giỏ\s*hàng/i,
      payment: /\bpayment\b|checkout|thanh\s*toán/i,
      qr: /\bqr\b|qrcode|qr\s*code|mã\s*qr/i,
      sepay: /\bsepay\b/i
    };
    const present = patterns[flow]?.test(changedCodeText) || false;
    check(
      `flow_${flow}`,
      present,
      `Requested ${flow} flow is not implemented in the changed code.`,
      changedEvidence.map(item => item.file)
    );
  }

  const out = {
    passed: failures.length === 0,
    evaluatedAt: new Date(),
    score: checks.length
      ? Math.round((checks.filter(item => item.passed).length / checks.length) * 100)
      : 0,
    checks,
    failures,
    feedback: failures.length
      ? `Quality gate failed:\n- ${failures.join("\n- ")}`
      : "Quality gate passed.",
    evidence: {
      meaningfulFiles,
      filesChanged: unique(changedFiles),
      filesRead: unique(successfulReads.map(call => call.result?.file || call.args?.path)),
      validationCommands: successfulCommands.map(call => call.args?.command),
      layers
    }
  };
  if (DEBUG()) console.log("[QUALITY_GATE][OUTPUT]", { passed: out.passed, score: out.score, failures: out.failures });
  return out;
}
