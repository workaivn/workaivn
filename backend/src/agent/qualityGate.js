import fs from "fs/promises";
import path from "path";
import { resolveWorkspacePathSafe } from "./workspace.js";

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

  // ── CHAT: always passes ──────────────────────────────
  if (taskType === "CHAT") {
    return {
      passed: true,
      evaluatedAt: new Date(),
      score: 100,
      checks: [{ id: "task_type", passed: true, message: "Chat task — no quality gate required." }],
      failures: [],
      feedback: "Quality gate passed.",
      evidence: { filesChanged: [], filesRead: [], layers: [] }
    };
  }

  // ── SEARCH / ANALYSIS: pass if final answer exists and no files changed ──
  if ((taskType === "SEARCH" || taskType === "ANALYSIS") && changedFiles.length === 0 && finalText) {
    const successfulReads = toolCalls.filter(call => call.tool === "READ_FILE" && call.success);
    return {
      passed: true,
      evaluatedAt: new Date(),
      score: 100,
      checks: [
        { id: "task_type", passed: true, message: `${taskType} task — pass if no files changed and answer exists.` },
        { id: "no_file_changes", passed: true, message: "No files were modified." }
      ],
      failures: [],
      feedback: "Quality gate passed.",
      evidence: {
        filesRead: unique(successfulReads.map(call => call.result?.file || call.args?.path)),
        filesChanged: [],
        layers: []
      }
    };
  }

  // ── Behavior-based read-only pass for CODING prompts that only read ──
  // If the run performed only reads (no write/patch tools), produced a final answer,
  // and changedFiles is empty, treat it as a read-only task and pass.
  {
    const successfulReads = toolCalls.filter(call => call.tool === "READ_FILE" && call.success);
    const writeToolUsed = toolCalls.some(call => call && (call.tool === "WRITE_FILE" || call.tool === "APPLY_PATCH"));
    const isReadOnlyBehavior = !writeToolUsed && successfulReads.length > 0 && changedFiles.length === 0 && !!String(finalText || "").trim();
    if (isReadOnlyBehavior) {
      return {
        passed: true,
        evaluatedAt: new Date(),
        score: 100,
        checks: [
          { id: "behavior_read_only", passed: true, message: "Read-only behavior detected: successful READ_FILE, no writes, non-empty final." },
          { id: "no_file_changes", passed: true, message: "No files were modified." }
        ],
        failures: [],
        feedback: "Quality gate passed.",
        evidence: {
          filesRead: unique(successfulReads.map(call => call.result?.file || call.args?.path)),
          filesChanged: [],
          layers: []
        }
      };
    }
  }

  const meaningfulFiles = unique(changedFiles).filter(isMeaningfulFile);
  const successfulReads = toolCalls.filter(call => call.tool === "READ_FILE" && call.success);
  const successfulToolCalls = toolCalls.filter(call =>
    call.success && ["READ_FILE", "LIST_FILES", "SEARCH_FILES"].includes(call.tool)
  );
  const successfulCommands = toolCalls.filter(call =>
    call.tool === "RUN_TERMINAL" &&
    call.success &&
    isValidationCommand(call.args?.command)
  );
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
  if (taskType === "CODING" || taskType === "product_build") {
    check(
      "workspace_changes",
      meaningfulFiles.length > 0,
      "No meaningful source files were changed.",
      meaningfulFiles
    );

    check(
      "validation_command",
      !criteria.requiresValidationCommand || successfulCommands.length > 0,
      "Run at least one successful validation command from the workspace root.",
      successfulCommands.map(call => call.args?.command)
    );

    check(
      "patch_validation",
      meaningfulFiles.length > 0 &&
        successfulValidations.length > 0 &&
        failedValidations.length === 0,
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

  return {
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
}
