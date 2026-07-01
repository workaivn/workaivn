import fs from "fs/promises";
import path from "path";
import { resolveWorkspacePathSafe } from "./workspace.js";
import { isSameCommand, matchValidationCommand } from "./validationCommandMatcher.js";
import { extractExternalFailureFilesFromText } from "./execution/executionStateRegistry.js";
const DEBUG = () => process.env.DEBUG_AGENT === "true" || process.env.WORKAI_AGENT_DEBUG === "true";

const MEANINGFUL_EXTENSIONS = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx",
  ".json", ".css", ".scss", ".html", ".vue", ".svelte",
  ".py", ".java", ".go", ".rs", ".php", ".rb", ".sql"
]);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeGatePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .toLowerCase()
    .trim();
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
  const summary = matchValidationCommand({
    terminalCommands: [{ command, success: true, result: { exitCode: 0 } }]
  });
  return {
    matched: summary.validationPassed,
    rule: summary.matchedCommands[0]?.matchType || (summary.validationPassed ? "heuristic" : "")
  };
}

function isValidationCommand(command) {
  return getValidationMatch(command).matched;
}

function isSourceFailurePath(file = "") {
  const normalized = String(file || "").replace(/\\/g, "/").trim();
  return /^(?:src|backend\/src|frontend\/src|app\/src)\//i.test(normalized);
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
    verifiedExistingFiles = [],
  } = input;
  const packageJsonValid = input.packageJsonValid !== false;
  const criteria = acceptanceCriteria || {};
  const requestedWriteFiles = Array.isArray(input.requestedWriteFiles)
    ? unique(input.requestedWriteFiles)
    : unique([
        ...(Array.isArray(criteria.requestedFiles) ? criteria.requestedFiles : []),
        ...(Array.isArray(criteria.plannerWriteTargets) ? criteria.plannerWriteTargets : [])
      ]);
  const filesRead = Array.isArray(input.filesRead)
    ? unique(input.filesRead)
    : unique(Array.isArray(criteria.plannerReadFiles) ? criteria.plannerReadFiles : []);
  const requiredCommands = Array.isArray(input.requiredValidationCommands)
    ? input.requiredValidationCommands
    : (input.requiredCommands || criteria.requiredCommands || []);
  const taskType = criteria.taskType || "CODING";
  // Intent-aware mode override
  let mode = criteria.taskMode || (taskType === "CHAT" ? "qa" : (taskType === "CODING" ? "coding" : "read_only"));
  const intentMode = String(criteria.intentMode || "");
  if (intentMode === "READ_ONLY") mode = "read_only";
  if ((intentMode === "WRITE" || intentMode === "WRITE_AND_RUN") && !criteria.doNotModify) mode = "coding";
  if (DEBUG()) {
    const terminals = toolCalls.filter(call => call.tool === "RUN_TERMINAL");
    console.log("[QUALITY_GATE][INPUT]", {
      mode,
      taskType,
      requestedFiles: requestedWriteFiles,
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
      validationSummary: null,
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
    const required = filesRead.map(f => String(f || "").replace(/\\/g, "/").toLowerCase()).filter(Boolean);
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
      validationSummary: null,
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
  const validationSummary = matchValidationCommand({
    requiredCommands,
    terminalCommands: terminalCalls,
    projectContext: workspaceRoot,
    packageManager: criteria.packageManager || ""
  });
  const successfulCommands = validationSummary.hasRequiredCommands
    ? terminalCalls.filter(call =>
      call.success === true &&
      (call.result?.exitCode === 0 || call.result?.exitCode === undefined || call.result?.exitCode === null) &&
      validationSummary.matchedCommands.some(match =>
        isSameCommand(match.executedCommand, String(call.args?.command || call.result?.command || ""))
      )
    )
    : terminalCalls.filter(call => call.success && isValidationCommand(call.args?.command));
  const successfulValidations = toolCalls.filter(call => call.tool === "VALIDATE_PATCH" && call.success);
  const failedValidations = toolCalls.filter(call => call.tool === "VALIDATE_PATCH" && !call.success);
  const changedFileTargets = unique(changedFiles).map(normalizeGatePath).filter(Boolean);
  const requestedWriteTargets = unique(requestedWriteFiles.map(normalizeGatePath).filter(Boolean));
  const verifiedExistingTargets = unique(Array.isArray(verifiedExistingFiles) ? verifiedExistingFiles : []).map(normalizeGatePath).filter(Boolean);
  const successfulWriteTargets = unique(toolCalls.filter(call =>
    call.tool === "WRITE_FILE" &&
    call.success === true
  ).map(call => normalizeGatePath(call.result?.file || call.args?.path || call.args?.file || call.args?.target || "")));
  const requestedFilesValidated = requestedWriteTargets.length > 0 && requestedWriteTargets.every(file => successfulWriteTargets.includes(file) || changedFileTargets.includes(file) || verifiedExistingTargets.includes(file));
  const failedTerminalCalls = terminalCalls.filter(call =>
    call.success === false ||
    (call.result?.exitCode !== null && call.result?.exitCode !== undefined && call.result?.exitCode !== 0)
  );
  const failureText = failedTerminalCalls
    .map(call => [call.error, call.result?.stderr, call.result?.stdout].filter(Boolean).join("\n"))
    .join("\n");
  const failureFileCandidates = extractExternalFailureFilesFromText(failureText, workspaceRoot).filter(isSourceFailurePath);
  const externalFailureFiles = failureFileCandidates.filter(file => !requestedWriteTargets.includes(normalizeGatePath(file)));
  const validationExecuted = terminalCalls.length > 0;
  const validationCommand = validationSummary?.executedValidationCommands?.[0]?.executedCommand
    || validationSummary?.matchedCommands?.[0]?.executedCommand
    || validationSummary?.failedCommands?.[0]?.executedCommand
    || terminalCalls[0]?.args?.command
    || requiredCommands[0]
    || null;
  const validationSuccess = validationSummary?.validationPassed === true;
  const validationFailureAttribution = validationSuccess
    ? null
    : ((requestedFilesValidated || externalFailureFiles.length > 0) ? "external_project_failure" : "requested_scope_failure");
  const approvedWriteTargets = new Set(requestedWriteFiles.map(normalizeGatePath).filter(Boolean));
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
    const mustValidate = (meaningfulChanged || intentMode === "WRITE_AND_RUN" || objectiveRequiresTerminal) && criteria.taskClass !== 'ui_build';
    const verifiedExistingCoverage = requestedWriteTargets.length > 0 && requestedWriteTargets.every(file =>
      successfulWriteTargets.includes(file) ||
      changedFileTargets.includes(file) ||
      verifiedExistingTargets.includes(file)
    );

    // Accept idempotent write success (alreadyUpToDate or changed === false)
    const hasAlreadyUpToDate = toolCalls.some(call =>
      call.tool === "WRITE_FILE" && call.success && call.result && (call.result.alreadyUpToDate === true || call.result.changed === false)
    );

    check(
      "workspace_changes",
      meaningfulChanged || hasAlreadyUpToDate || verifiedExistingCoverage || (intentMode === "WRITE_AND_RUN" && successfulCommands.length > 0),
      "No meaningful source files were changed.",
      meaningfulFiles.length > 0 ? meaningfulFiles : verifiedExistingTargets
    );

    // Emit VALIDATION_MATCH debug for each terminal command
    const validationMatches = terminalCalls.map(c => {
      const cmd = c.args?.command || "";
      const m = validationSummary.hasRequiredCommands
        ? {
            matched: validationSummary.executedValidationCommands.some(match => isSameCommand(match.executedCommand, cmd)),
            rule: validationSummary.executedValidationCommands.some(match => isSameCommand(match.executedCommand, cmd)) ? "required" : ""
          }
        : getValidationMatch(cmd);
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
      (changedFileTargets.length === 0) || (
        validationSummary.validationPassed === true &&
        changedFileTargets.every(file => approvedWriteTargets.has(file))
      ),
      "Changed files must pass patch validation.",
      {
        requestedFiles: requestedWriteFiles,
        plannerWriteTargets: requestedWriteFiles,
        changedFiles: changedFileTargets,
        validationPassed: validationSummary.validationPassed,
        matchedValidationCommands: validationSummary.matchedCommands.map(match => match.executedCommand)
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
      // UI_BUILD: skip required command enforcement when validation command failed
      // because the project has no build script (recovery analysis + no_build_script)
      const isUIBuild = criteria.taskClass === "ui_build";
      const hasFailedBuildScript = isUIBuild && terminalCalls.some(c =>
        !c.success &&
        /(?:npm|pnpm|yarn)\s+(?:run\s+)?build\b/i.test(String(c.args?.command || ''))
      );
      if (hasFailedBuildScript) {
        console.log('[QUALITY_GATE_VALIDATION_SKIPPED]', {
          reason: 'no_build_script',
          requiredCommand: requiredCommands[0]
        });
      } else {
        for (const cmd of requiredCommands) {
          const matched = terminalCalls.some(c =>
            c.success &&
            (c.result?.exitCode === 0 || c.result?.exitCode === undefined || c.result?.exitCode === null) &&
            validationSummary.matchedCommands.some(match => isSameCommand(match.executedCommand, String(c.args?.command || c.result?.command || "")) && isSameCommand(match.requiredCommand, cmd))
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

  console.log('[QUALITY_GATE_TASK_CLASS]', {
    taskClass: criteria.taskClass,
    rulesApplied: criteria.taskClass === 'ui_build' ? 'ui_build (1 meaningful file + WRITE_FILE success)' :
                   criteria.taskClass === 'product_build' ? 'product_build (8 files + multi-layer)' :
                   criteria.taskClass === 'bugfix' ? 'bugfix (minimal changed files)' :
                   'standard rules'
  });

  // HOTFIX 2: UI_BUILD — at least one meaningful UI file, validation is optional
  if (criteria.taskClass === "ui_build") {
    const hasMeaningfulUI = meaningfulFiles.length >= 1;
    const reasoningCompleted = toolCalls.some(c => c.tool === 'WRITE_FILE' && c.success);
    const noUnsafeOverwrite = !toolCalls.some(c => c.tool === 'WRITE_FILE' && !c.success && String(c.error || '').includes('unsafe'));

    check(
      "ui_build_scope",
      hasMeaningfulUI && reasoningCompleted && noUnsafeOverwrite,
      `UI builds require at least 1 meaningful UI file changed, reasoning completed, and no unsafe overwrite.`,
      { meaningfulFileCount: meaningfulFiles.length, reasoningCompleted, noUnsafeOverwrite }
    );

    // If validation command failed because script is missing, don't fail — report availability
    const failedTerminalCalls = terminalCalls.filter(c => !c.success);
    if (failedTerminalCalls.length > 0 && successfulCommands.length === 0) {
      const hasMissingScript = failedTerminalCalls.some(c => {
        const cmd = String(c.args?.command || '');
        return /(?:npm|pnpm|yarn)\s+(?:run\s+)?\S+/i.test(cmd);
      });
      if (hasMissingScript) {
        console.log('[UI_BUILD_VALIDATION_UNAVAILABLE]', {
          reason: 'validation command attempted but script not present',
          failedCommands: failedTerminalCalls.map(c => c.args?.command)
        });
      }
    }
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
    validationExecuted,
    validationCommand,
    validationSuccess,
    requestedFilesValidated,
    validationFailureAttribution,
    externalFailureFiles,
    validationSummary,
    evidence: {
      meaningfulFiles,
      filesChanged: unique(changedFiles),
      filesRead: unique(successfulReads.map(call => call.result?.file || call.args?.path)),
      validationCommands: successfulCommands.map(call => call.args?.command),
      verifiedExistingFiles: verifiedExistingTargets,
      layers,
      externalFailureFiles
    }
  };
  // Print QUALITY_GATE_REASONING for diagnostics
  try {
    const filesRead = unique(successfulReads.map(call => call.result?.file || call.args?.path));
    const terminalCommands = terminalCalls.map(call => call.args?.command).filter(Boolean);
    const matchedValidationCommands = validationSummary.hasRequiredCommands
      ? validationSummary.executedValidationCommands.map(match => match.executedCommand)
      : terminalCommands.filter(cmd => getValidationMatch(cmd).matched);
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
  if (validationFailureAttribution === "external_project_failure") {
    console.log("[EXTERNAL_VALIDATION_FAILURE_ATTRIBUTED]", {
      validationCommand,
      externalFailureFiles
    });
    console.log("[QUALITY_GATE_EXTERNAL_FAILURE]", {
      validationCommand,
      externalFailureFiles
    });
    console.log("[EXTERNAL_FAILURE_FILES]", { files: externalFailureFiles });
  }
  if (DEBUG()) console.log("[QUALITY_GATE][OUTPUT]", { passed: out.passed, score: out.score, failures: out.failures });
  return out;
}
