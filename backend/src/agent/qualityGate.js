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

function getValidationMatch(command) {
  const cmd = String(command || "").trim();
  const rules = [
    { rule: "npm-test", rx: /^npm\s+(?:--silent|-s\s+)?test\b/i },
    { rule: "npm-run", rx: /^npm\s+(?:--silent|-s\s+)?run\s+[A-Za-z0-9:_\-]+\b/i },
    { rule: "npm-build", rx: /^npm\s+(?:--silent|-s\s+)?run\s+build\b/i },

    { rule: "pnpm-test", rx: /^pnpm\s+(?:--silent|-s\s+)?test\b/i },
    { rule: "pnpm-run", rx: /^pnpm\s+(?:--silent|-s\s+)?run\s+[A-Za-z0-9:_\-]+\b/i },
    { rule: "pnpm-build", rx: /^pnpm\s+(?:--silent|-s\s+)?build\b/i },

    { rule: "yarn-test", rx: /^yarn\s+(?:--silent|-s\s+)?test\b/i },
    { rule: "yarn-run", rx: /^yarn\s+(?:--silent|-s\s+)?run\s+[A-Za-z0-9:_\-]+\b/i },
    { rule: "yarn-build", rx: /^yarn\s+(?:--silent|-s\s+)?build\b/i },

    { rule: "node-check", rx: /\bnode\s+--check\b/i },
    { rule: "node-file", rx: /^node\s+[^\s]+\.m?js\b/i },

    { rule: "python-script", rx: /^python\s+[^-\s][^\n]*\.py\b/i },
    { rule: "python3-script", rx: /^python3\s+[^-\s][^\n]*\.py\b/i },
    { rule: "pytest", rx: /\bpytest\b/i },
    { rule: "python-m-pytest", rx: /^python\s+-m\s+pytest\b/i },

    { rule: "cargo-test", rx: /\bcargo\s+test\b/i },
    { rule: "cargo-check", rx: /\bcargo\s+check\b/i },
    { rule: "go-test", rx: /\bgo\s+test\b/i },
    { rule: "dotnet-test", rx: /\bdotnet\s+test\b/i },
    { rule: "dotnet-build", rx: /\bdotnet\s+build\b/i },
    { rule: "mvn-test", rx: /\bmvn\s+test\b/i },
    { rule: "gradle-test", rx: /\bgradle\w*\s+test\b/i },
    { rule: "gradle-build", rx: /\bgradle\w*\s+build\b/i },

    { rule: "flutter-test", rx: /^flutter\s+test\b/i },
    { rule: "flutter-analyze", rx: /^flutter\s+analy[sz]e\b/i },
    { rule: "dart-test", rx: /^dart\s+test\b/i }
  ];
  for (const { rule, rx } of rules) {
    if (rx.test(cmd)) return { matched: true, rule };
  }
  return { matched: false, rule: "" };
}

function isValidationCommand(command) {
  return getValidationMatch(command).matched;
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

export async function evaluateQualityGate(input = {}) {
  const {
    acceptanceCriteria,
    changedFiles = [],
    toolCalls = [],
    workspaceRoot = "",
    finalText = "",
  } = input;
  const packageJsonValid = input.packageJsonValid !== false;
  const criteria = acceptanceCriteria || {};
  const requiredCommands = input.requiredCommands || criteria.requiredCommands || [];
  const taskType = criteria.taskType || "CODING";
  // Intent-aware mode override
  let mode = criteria.taskMode || (taskType === "CHAT" ? "qa" : (taskType === "CODING" ? "coding" : "read_only"));
  const intentMode = String(criteria.intentMode || "");
  if (intentMode === "READ_ONLY") mode = "read_only";
  if ((intentMode === "WRITE" || intentMode === "WRITE_AND_RUN") && !criteria.doNotModify) mode = "coding";
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
  const successfulReadBasenames = successfulReadPaths.map(p => p.split("/").pop());

  // ── READ_ONLY mode: require requested files were read and final text exists ──
  if (mode === "read_only") {
    const required = (criteria.requestedFiles || []).map(f => String(f || "").replace(/\\/g, "/").toLowerCase()).filter(Boolean);
    const missing = required.filter(f => {
      // If requester provided a path with slashes, require exact path read
      if (f.includes("/")) return !successfulReadPaths.includes(f);
      // Otherwise, accept by basename match
      return !successfulReadBasenames.includes(f);
    });
    const nonEmptyFinal = !!String(finalText || "").trim();
    const terminalCalls = toolCalls.filter(call => call.tool === "RUN_TERMINAL");
    const requiredCommandStates = requiredCommands.map(cmd => {
      const expected = String(cmd || "").trim();
      const matchingCalls = terminalCalls.filter(call =>
        String(call.args?.command || call.result?.command || "").trim() === expected
      );
      const succeeded = matchingCalls.some(call =>
        call.success === true &&
        (call.result?.exitCode === 0 || call.result?.exitCode === undefined)
      );
      return { command: expected, executed: matchingCalls.length > 0, succeeded };
    });
    const missingCommands = requiredCommandStates
      .filter(state => !state.executed)
      .map(state => state.command);
    const failedCommands = requiredCommandStates
      .filter(state => state.executed && !state.succeeded)
      .map(state => state.command);
    // Detect raw dump: starts with --- <file> --- and includes code-like content
    const normalizedFinal = String(finalText || "");
    const startsWithDumpHeader = /^---\s+[^\n]+\s+---/i.test(normalizedFinal.trim());
    const looksLikeCode = /\b(function\b|class\b|import\b|\{[\s\S]*\}|=>)/.test(normalizedFinal);
    const isRawDump = startsWithDumpHeader && looksLikeCode;
    const objectiveText = String(criteria.objective || "");
    const questionWords = /\b(what|why|how|find|explain|identify|name|count)\b/i.test(objectiveText);
    let answersObjective = true;
    // Specific validator: package name questions must include the actual package name from package.json
    const asksPackageName = /\b(package\s+name|show\s+package\s+name|what\s+is\s+the\s+package\s+name)\b/i.test(objectiveText);
    if (asksPackageName) {
      // Find a read package.json and parse name
      let pkgName = "";
      for (const call of successfulReads) {
        const p = String(call.result?.file || call.args?.path || "").replace(/\\/g, "/").toLowerCase();
        if (/(^|\/)package\.json$/.test(p)) {
          try {
            const content = call.result?.content || call.result?.contentPreview || "";
            const json = JSON.parse(content || "{}");
            if (typeof json?.name === 'string' && json.name.trim()) {
              pkgName = json.name.trim();
            }
          } catch {}
          break;
        }
      }
      if (pkgName) {
        answersObjective = String(finalText || "").toLowerCase().includes(pkgName.toLowerCase());
      }
    }
    const passed = missing.length === 0 && missingCommands.length === 0 && failedCommands.length === 0 && nonEmptyFinal && (!questionWords || !isRawDump) && answersObjective;
    const out = {
      passed,
      evaluatedAt: new Date(),
      score: passed ? 100 : 0,
      checks: [
        { id: "requested_files_read", passed: missing.length === 0, message: missing.length ? `Missing reads: ${missing.join(", ")}` : "All requested files were read." },
        { id: "required_commands_executed", passed: missingCommands.length === 0, message: missingCommands.length ? `Missing required commands: ${missingCommands.join(", ")}` : "All required commands were executed." },
        { id: "required_commands_succeeded", passed: failedCommands.length === 0, message: failedCommands.length ? `Required commands failed: ${failedCommands.join(", ")}` : "All required commands succeeded." },
        { id: "final_present", passed: nonEmptyFinal, message: "Final answer must be present." },
        { id: "no_file_changes", passed: changedFiles.length === 0, message: changedFiles.length ? "No file modifications allowed for read-only tasks." : "No files were modified." },
        { id: "not_raw_dump", passed: !isRawDump, message: isRawDump ? "Final answer is raw file dump, not analysis." : "Final is not a raw dump." },
        { id: "answers_objective", passed: answersObjective, message: answersObjective ? "Final answers the requested question." : "Final does not answer the question (e.g., missing package name)." }
      ],
      failures: passed ? [] : [
        ...(missing.length ? [`Requested files not read: ${missing.join(", ")}`] : []),
        ...(missingCommands.length ? [`Required commands not executed: ${missingCommands.join(", ")}`] : []),
        ...(failedCommands.length ? [`Required commands failed: ${failedCommands.join(", ")}`] : []),
        ...(nonEmptyFinal ? [] : ["No final text"]),
        ...(changedFiles.length ? ["Files changed in read-only task"] : []),
        ...(isRawDump ? ["Final answer is raw file dump, not analysis."] : []),
        ...(!answersObjective ? ["Final does not answer the requested question."] : [])
      ],
      feedback: passed ? "Quality gate passed." : "Quality gate failed: ensure requested files are read and provide a final answer.",
      evidence: {
        filesRead: unique(successfulReads.map(call => call.result?.file || call.args?.path)),
        terminalCommands: terminalCalls.map(call => call.args?.command).filter(Boolean),
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
    call.success && ["READ_FILE", "LIST_FILES", "SEARCH_CODE", "SEARCH_SYMBOL"].includes(call.tool)
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
    // Stricter rule: if meaningful files changed in coding mode, require a successful validation command
    // Read-only/analysis are handled above and never reach this branch
    const meaningfulChanged = meaningfulFiles.length > 0;
    const mustValidate = meaningfulChanged || intentMode === "WRITE_AND_RUN" || objectiveRequiresTerminal;

    // Accept idempotent write success (alreadyUpToDate or changed === false)
    const hasAlreadyUpToDate = toolCalls.some(call =>
      call.tool === "WRITE_FILE" && call.success && call.result && (call.result.alreadyUpToDate === true || call.result.changed === false)
    );

    check(
      "workspace_changes",
      meaningfulChanged || hasAlreadyUpToDate || (intentMode === "WRITE_AND_RUN" && successfulCommands.length > 0),
      "No meaningful source files were changed.",
      meaningfulFiles
    );

    // Emit VALIDATION_MATCH debug for each terminal command
    const validationMatches = terminalCalls.map(c => {
      const cmd = c.args?.command || "";
      const m = getValidationMatch(cmd);
      console.log("[VALIDATION_MATCH]", { command: cmd, matched: m.matched, rule: m.rule });
      return { command: cmd, matched: m.matched, rule: m.rule };
    });

    let validationMessage = "Run at least one successful validation command from the workspace root.";
    if (mustValidate && successfulCommands.length === 0) {
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
    if (mustValidate) {
      check(
        "validation_command",
        successfulCommands.length > 0,
        validationMessage,
        successfulCommands.map(call => call.args?.command)
      );
    }

    check(
      "patch_validation",
      (meaningfulFiles.length === 0) || (
        successfulValidations.length > 0 &&
        failedValidations.length === 0
      ),
      "Changed files must pass patch validation.",
      {
        passed: successfulValidations.map(call => call.args?.file),
        failed: failedValidations.map(call => call.args?.file)
      }
    );

    // Guard: claimed change in final text without evidence
    const claimsChange = /\b(changed|modified|updated|patched|added)\b/i.test(String(finalText || ""));
    check(
      "claimed_change_without_evidence",
      !claimsChange || meaningfulFiles.length > 0,
      "Final claims a change but no changed files were detected.",
    );
    if (claimsChange && meaningfulFiles.length === 0 && DEBUG()) {
      console.warn("[CLAIMED_CHANGE_WITHOUT_EVIDENCE]");
    }

    // Required commands enforcement: user-requested commands must be exact-matched with success
    if (requiredCommands.length > 0) {
      for (const cmd of requiredCommands) {
        const matched = terminalCalls.some(c =>
          c.success &&
          String(c.args?.command || "").trim() === cmd &&
          (c.result?.exitCode === 0 || c.result?.exitCode === undefined)
        );
        check(
          `required_command_${cmd.replace(/[^a-zA-Z0-9]/g, '_')}`,
          matched,
          `Required command "${cmd}" must be executed successfully (exit code 0).`,
          { command: cmd, matched }
        );
      }
    }
  }

  // Non-coding mode check: package.json validity
  if (!packageJsonValid) {
    check("package_json_valid", false, "package.json is not valid JSON after modifications.");
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
  // Print QUALITY_GATE_REASONING for diagnostics
  try {
    const filesRead = unique(successfulReads.map(call => call.result?.file || call.args?.path));
    const terminalCommands = terminalCalls.map(call => call.args?.command).filter(Boolean);
    const matchedValidationCommands = terminalCommands.filter(cmd => getValidationMatch(cmd).matched);
    const reasoning = {
      taskType,
      taskClass: criteria.taskClass || null,
      taskMode: mode,
      requiresWorkspaceChange: !!criteria.requiresWorkspaceChange,
      requiresValidationCommand: !!criteria.requiresValidationCommand,
      requiresFileRead: !!criteria.requiresFileRead,
      changedFiles,
      filesRead,
      terminalCommands,
      matchedValidationCommands,
      finalTextLength: String(finalText || "").length
    };
    console.log("[QUALITY_GATE_REASONING]", reasoning);
  } catch {}
  if (DEBUG()) console.log("[QUALITY_GATE][OUTPUT]", { passed: out.passed, score: out.score, failures: out.failures });
  return out;
}
