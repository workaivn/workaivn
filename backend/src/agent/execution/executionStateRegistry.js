import fs from "node:fs";
import path from "node:path";

function normalize(value = "") {
  return String(value || "").replace(/\\/g, "/").trim();
}

function normalizeLower(value = "") {
  return normalize(value).toLowerCase();
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean).map(value => normalize(value)))];
}

function isLikelyProjectFailurePath(file = "") {
  const normalized = normalize(file);
  return /(^|\/)(?:src|app|lib|server|client|backend\/src|frontend\/src|tests?|__tests__)(?:\/|$)/i.test(normalized);
}

function isMeaningfulFailurePath(file = "") {
  const normalized = normalize(file);
  if (!normalized) return false;
  if (/^(?:https?:\/\/|file:\/\/|node:)/i.test(normalized)) return false;
  if (/\.(?:md|txt|rst|adoc|csv|jsonl)$/i.test(normalized)) return false;
  if (/README|CHANGELOG|LICENSE|examples?|docs?/i.test(normalized)) return false;
  return /\.[a-z0-9]+$/i.test(normalized);
}

function extractRootCauseBlockLines(text = "") {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  if (lines.length === 0) return [];
  const markerIndex = lines.findIndex(line =>
    /(ReferenceError|TypeError|SyntaxError|AssertionError|Error:|^Error\b|^FAIL\b|^\s*not ok\b|^TAP version\b|^\s*at\s+)/i.test(String(line || ""))
  );
  const start = markerIndex >= 0 ? markerIndex : 0;
  return lines.slice(start, start + 24);
}

function extractPathCandidatesFromText(text = "") {
  const block = extractRootCauseBlockLines(text);
  if (block.length === 0) return [];
  const patterns = [
    /(?:at\s+.*?\()?(?:file:\/\/\/?)?((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|\/)?(?:[\w.-]+[\\/])*?(?:src|app|lib|server|client|backend[\\/ ]src|frontend[\\/ ]src|tests?|__tests__)[\\/][^():*?"<>|]+\.(?:js|jsx|ts|tsx|mjs|cjs|json|css|scss|html|php|py|cs|java|go|rs|rb|vue|svelte))(?::\d+:\d+)?\)?/i,
    /(?:location:\s*['"])?((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|\/)?(?:[\w.-]+[\\/])*?(?:src|app|lib|server|client|backend[\\/ ]src|frontend[\\/ ]src|tests?|__tests__)[\\/][^():*?"<>|]+\.(?:js|jsx|ts|tsx|mjs|cjs|json|css|scss|html|php|py|cs|java|go|rs|rb|vue|svelte))(?::\d+:\d+)?['"]?/i
  ];
  const matches = [];
  for (const line of block) {
    const value = String(line || "").trim();
    if (!value) continue;
    if (/^(?:node:internal|internal\/|>|npm |yarn |pnpm )/i.test(value)) continue;
    for (const pattern of patterns) {
      const match = value.match(pattern);
      if (match?.[1]) {
        matches.push(normalize(match[1]));
      }
    }
  }
  return unique(matches);
}

function filterExistingProjectFailureFiles(workspaceRoot, files = []) {
  const root = String(workspaceRoot || "").trim();
  return unique(files).filter(file => {
    if (!isLikelyProjectFailurePath(file) || !isMeaningfulFailurePath(file)) return false;
    if (!root) return true;
    try {
      return fs.existsSync(path.resolve(root, file));
    } catch {
      return false;
    }
  });
}

export function extractExternalFailureFilesFromText(text = "", workspaceRoot = "") {
  return filterExistingProjectFailureFiles(workspaceRoot, extractPathCandidatesFromText(text));
}

function isRequestedFile(pathValue = "", requestedWriteFiles = []) {
  const normalized = normalizeLower(pathValue);
  if (!normalized) return false;
  const requestedSource = requestedWriteFiles instanceof Set
    ? [...requestedWriteFiles]
    : Array.isArray(requestedWriteFiles)
      ? requestedWriteFiles
      : [];
  const requested = new Set(unique(requestedSource).map(normalizeLower));
  return requested.has(normalized);
}

export function createExecutionStateRegistry({
  plannerExecutionMetadata = null,
  runId = null,
  workspaceRoot = ""
} = {}) {
  const initialPlannerReadFiles = unique(plannerExecutionMetadata?.plannerReadFiles || []);
  const initialPlannerWriteFiles = unique(plannerExecutionMetadata?.plannerWriteFiles || []);
  const initialPlannerRunCommands = unique(plannerExecutionMetadata?.plannerRunCommands || []);
  const initialPlannerProtectedFiles = unique(plannerExecutionMetadata?.plannerProtectedFiles || []);
  const initialPlannerValidationCommands = unique(plannerExecutionMetadata?.plannerValidationCommands || []);

  const taskRecords = new Map();
  const logDedupe = new Set();
  const requestedWriteFiles = new Set(initialPlannerWriteFiles);
  const plannerReadFiles = new Set(initialPlannerReadFiles);
  const plannerRunCommands = new Set(initialPlannerRunCommands);
  const plannerProtectedFiles = new Set(initialPlannerProtectedFiles);
  const plannerValidationCommands = new Set(initialPlannerValidationCommands);
  const changedFiles = new Set();
  const validatedFiles = new Set();
  const validatedFileDetails = new Map();
  const terminalCommands = [];
  let validationFailureAttribution = null;
  let externalFailureFiles = [];
  let validationExecuted = false;
  let validationCommand = null;
  let validationSuccess = false;

  function getPlannerNodesForReplay(planner = null) {
    if (Array.isArray(planner?.originalPlannerTasks) && planner.originalPlannerTasks.length > 0) {
      return planner.originalPlannerTasks;
    }
    if (Array.isArray(planner?.initialPlannerGraphSnapshot?.tasks) && planner.initialPlannerGraphSnapshot.tasks.length > 0) {
      return planner.initialPlannerGraphSnapshot.tasks;
    }
    if (planner?.graph?.allNodes) {
      return planner.graph.allNodes();
    }
    return [];
  }

  function logOnce(eventName, payload = {}, context = {}) {
    const taskId = context.taskId ?? payload?.taskId ?? null;
    const pathValue = context.path ?? payload?.path ?? payload?.file ?? payload?.repairTargetFile ?? payload?.command ?? null;
    const key = [eventName, taskId || "", pathValue || ""].join("::");
    if (logDedupe.has(key)) return false;
    logDedupe.add(key);
    console.log(`[${eventName}]`, payload);
    return true;
  }

  function logTaskIdMissing(source, taskId, details = {}) {
    if (taskId) return;
    logOnce("EXECUTION_STATE_TASKID_MISSING", {
      source,
      ...details
    }, { path: details.path || details.command || source });
  }

  function ensureTaskRecord(taskId, defaults = {}) {
    const key = String(taskId || defaults.path || defaults.command || defaults.tool || "").trim();
    if (!key) return null;
    if (!taskRecords.has(key)) {
      taskRecords.set(key, {
        taskId: defaults.taskId ?? taskId ?? null,
        tool: defaults.tool ?? null,
        path: defaults.path ?? null,
        command: defaults.command ?? null,
        lifecycleStatus: defaults.lifecycleStatus || "PENDING",
        writeStatus: defaults.writeStatus || "not_applicable",
        physicalChanged: defaults.physicalChanged === true,
        validationPassed: defaults.validationPassed === true,
        frameworkValidated: defaults.frameworkValidated === true,
        framework: defaults.framework ?? null,
        validationSource: defaults.validationSource ?? null,
        failureAttribution: defaults.failureAttribution ?? null,
        externalFailureFiles: unique(defaults.externalFailureFiles || [])
      });
    }
    return taskRecords.get(key);
  }

  function upsertValidatedFile(pathValue, details = {}) {
    const path = normalize(pathValue);
    if (!path) return;
    validatedFiles.add(path);
    const existing = validatedFileDetails.get(path) || { path };
    validatedFileDetails.set(path, {
      ...existing,
      path,
      ...details
    });
  }

  function getVerifiedExistingFiles() {
    if (!workspaceRoot) return [];
    const files = [];
    for (const file of requestedWriteFiles) {
      const normalized = normalize(file);
      if (!normalized || validatedFiles.has(normalized)) continue;
      try {
        const absolutePath = path.resolve(workspaceRoot, normalized);
        if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
          files.push(normalized);
        }
      } catch {
        // Keep the evidence conservative when the file cannot be verified.
      }
    }
    return unique(files);
  }

  function recordTaskPlanned(task = {}) {
    const taskId = task?.id || null;
    const tool = String(task?.tool || "").toUpperCase() || null;
    const pathValue = normalize(task?.toolArgs?.path || task?.toolArgs?.file || task?.toolArgs?.target || "");
    const command = normalize(task?.toolArgs?.command || "");
    logTaskIdMissing("recordTaskPlanned", taskId, { path: pathValue, command, tool });
    const record = ensureTaskRecord(taskId, {
      taskId,
      tool,
      path: pathValue || null,
      command: command || null,
      lifecycleStatus: "PENDING"
    });
    if (record) {
      record.tool = record.tool || tool;
      record.path = record.path || pathValue || null;
      record.command = record.command || command || null;
    }
    return record;
  }

  function recordReadFile({ taskId = null, path = "", status = "SUCCESS" } = {}) {
    const normalizedPath = normalize(path);
    logTaskIdMissing("recordReadFile", taskId, { path: normalizedPath, status });
    const record = ensureTaskRecord(taskId, {
      taskId,
      tool: "READ_FILE",
      path: normalizedPath,
      lifecycleStatus: status
    });
    if (record) {
      record.lifecycleStatus = status || record.lifecycleStatus;
      record.path = record.path || normalizedPath || null;
      record.tool = record.tool || "READ_FILE";
    }
    if (normalizedPath) {
      plannerReadFiles.add(normalizedPath);
    }
    return record;
  }

  function recordWriteValidation({
    taskId = null,
    path = "",
    role = "WRITE_FILE",
    validationPassed = false,
    frameworkValidated = false,
    framework = null,
    validationSource = null
  } = {}) {
    const normalizedPath = normalize(path);
    logTaskIdMissing("recordWriteValidation", taskId, { path: normalizedPath, role: role || "WRITE_FILE", validationPassed: validationPassed === true, frameworkValidated: frameworkValidated === true, framework, validationSource });
    const validated = validationPassed === true || frameworkValidated === true;
    const record = ensureTaskRecord(taskId, {
      taskId,
      tool: role,
      path: normalizedPath,
      validationPassed: validated,
      frameworkValidated: frameworkValidated === true,
      framework,
      validationSource
    });
    if (record) {
      record.validationPassed = record.validationPassed || validated;
      record.frameworkValidated = record.frameworkValidated || frameworkValidated === true;
      record.framework = record.framework || framework || null;
      record.validationSource = record.validationSource || validationSource || null;
      record.path = record.path || normalizedPath || null;
      if (validated && normalizedPath) {
        upsertValidatedFile(normalizedPath, {
          validationPassed: true,
          frameworkValidated: frameworkValidated === true,
          framework: framework || null,
          validationSource: validationSource || role || null,
          reason: validationSource || role || "validation_passed"
        });
        logOnce("EXECUTION_STATE_VALIDATED_FILE", {
          taskId,
          path: normalizedPath,
          reason: validationSource || role || "validation_passed"
        }, { taskId, path: normalizedPath });
        logOnce("VALIDATED_FILE_RECORDED", {
          file: normalizedPath,
          validationPassed: true
        }, { taskId, path: normalizedPath });
      }
    }
    return record;
  }

  function recordWriteResult({
    taskId = null,
    path = "",
    status = "SUCCESS",
    writeStatus = "not_applicable",
    physicalChanged = false,
    reason = null
  } = {}) {
    const normalizedPath = normalize(path);
    logTaskIdMissing("recordWriteResult", taskId, { path: normalizedPath, status, writeStatus, physicalChanged: physicalChanged === true, reason });
    const success = String(status || "").toUpperCase() === "SUCCESS";
    const record = ensureTaskRecord(taskId, {
      taskId,
      tool: "WRITE_FILE",
      path: normalizedPath,
      lifecycleStatus: status,
      writeStatus,
      physicalChanged: physicalChanged === true
    });
    if (record) {
      record.lifecycleStatus = status || record.lifecycleStatus;
      record.writeStatus = writeStatus || record.writeStatus;
      record.physicalChanged = record.physicalChanged || physicalChanged === true;
      record.path = record.path || normalizedPath || null;
      if (success) {
        record.failureAttribution = null;
      }
    }
    if (normalizedPath) {
      const noChange = writeStatus === "no_change" || reason === "no_change" || physicalChanged !== true;
      if (physicalChanged === true) {
        changedFiles.add(normalizedPath);
        logOnce("EXECUTION_STATE_CHANGED_FILE", {
          taskId,
          path: normalizedPath,
          physicalChanged: true
        }, { taskId, path: normalizedPath });
      } else {
        logOnce("EXECUTION_STATE_CHANGED_FILE", {
          taskId,
          path: normalizedPath,
          physicalChanged: false
        }, { taskId, path: normalizedPath });
      }
      if (success && noChange) {
        logOnce("WRITE_SKIPPED_NO_CHANGE", {
          taskId,
          path: normalizedPath
        }, { taskId, path: normalizedPath });
      }
      if (success) {
        upsertValidatedFile(normalizedPath, {
          writeStatus: writeStatus || (physicalChanged ? "patched" : "no_change"),
          physicalChanged: physicalChanged === true,
          validationPassed: true,
          reason: reason || (physicalChanged ? "content_written" : "content_identical")
        });
        logOnce("WRITE_TASK_FINALIZED", {
          taskId,
          path: normalizedPath,
          status: "SUCCESS",
          reason: reason || (physicalChanged ? "written" : "no_change")
        }, { taskId, path: normalizedPath });
      }
    }
    return record;
  }

  function recordTerminalResult({
    taskId = null,
    command = "",
    success = true,
    exitCode = null,
    failureAttribution = null,
    externalFailureFiles: providedExternalFailureFiles = []
  } = {}) {
    const normalizedCommand = normalize(command);
    logTaskIdMissing("recordTerminalResult", taskId, { command: normalizedCommand, success: success === true, exitCode });
    terminalCommands.push({
      taskId,
      command: normalizedCommand,
      success: success === true,
      exitCode: exitCode ?? null
    });
    validationExecuted = true;
    validationCommand = validationCommand || normalizedCommand || null;
    const terminalSuccess = success === true && (exitCode === 0 || exitCode === null || exitCode === undefined);
    validationSuccess = validationSuccess === false ? false : terminalSuccess;

    const provided = unique(providedExternalFailureFiles).filter(isLikelyProjectFailurePath);
    const externalFilesOnly = provided.filter(file => !isRequestedFile(file, requestedWriteFiles));
    const stickyExternal = validationFailureAttribution === "external_project_failure";
    const requestedMatches = provided.some(file => isRequestedFile(file, requestedWriteFiles));
    let nextAttribution = failureAttribution || null;
    if (stickyExternal) {
      nextAttribution = "external_project_failure";
    } else if (nextAttribution === "external_project_failure" || externalFilesOnly.length > 0 && !requestedMatches) {
      nextAttribution = "external_project_failure";
    } else if (!nextAttribution && success !== true) {
      nextAttribution = "requested_scope_failure";
    }
    if (nextAttribution === "external_project_failure") {
      validationFailureAttribution = "external_project_failure";
    } else if (!validationFailureAttribution) {
      validationFailureAttribution = nextAttribution;
    }
    if (externalFilesOnly.length > 0) {
      externalFailureFiles = unique([...(externalFailureFiles || []), ...externalFilesOnly]);
      logOnce("EXECUTION_STATE_FAILURE_ATTRIBUTION", {
        attribution: validationFailureAttribution || nextAttribution || null,
        reason: "terminal_failure",
        externalFailureFiles
      });
    }
    return {
      command: normalizedCommand,
      success: success === true,
      exitCode: exitCode ?? null,
      failureAttribution: validationFailureAttribution
    };
  }

  function recordRecoveryOwnership({
    taskId = null,
    rootCauseFile = null,
    repairTargetFile = null,
    ownership = null,
    recoveryType = null
  } = {}) {
    logTaskIdMissing("recordRecoveryOwnership", taskId, { rootCauseFile, repairTargetFile, ownership, recoveryType });
    const record = ensureTaskRecord(taskId, {
      taskId,
      tool: "RECOVERY",
      path: normalize(repairTargetFile || rootCauseFile || ""),
      lifecycleStatus: "RUNNING"
    });
    if (record) {
      record.failureAttribution = ownership || record.failureAttribution || null;
      record.path = record.path || normalize(repairTargetFile || rootCauseFile || "") || null;
      record.validationSource = recoveryType || record.validationSource || null;
    }
    if (ownership === "OUTSIDE_REQUESTED_SCOPE" || ownership === "PROJECT_PREEXISTING_FAILURE") {
      validationFailureAttribution = "external_project_failure";
    }
    return record;
  }

  function replayToolCalls({ toolCalls = [], planner = null } = {}) {
    for (const node of getPlannerNodesForReplay(planner)) {
      recordTaskPlanned(node);
    }

    for (const call of Array.isArray(toolCalls) ? toolCalls : []) {
      const taskId = call?.taskId || call?.plannerTaskId || call?.result?.taskId || call?.result?.plannerTaskId || null;
      const tool = String(call?.tool || "").toUpperCase();
      const pathValue = normalize(call?.result?.file || call?.args?.path || call?.args?.file || call?.args?.target || "");
      const command = normalize(call?.args?.command || call?.result?.command || "");
      if (tool === "READ_FILE" && call?.success) {
        recordReadFile({ taskId, path: pathValue, status: "SUCCESS" });
      }
      if (tool === "WRITE_FILE" && call?.success) {
        const changed = call?.result?.changed === true;
        const noChange = call?.result?.alreadyUpToDate === true || call?.result?.changed === false || call?.result?.cached === true;
        recordWriteResult({
          taskId,
          path: pathValue,
          status: "SUCCESS",
          writeStatus: noChange ? "no_change" : "written",
          physicalChanged: changed,
          reason: noChange ? "content_identical" : "content_written"
        });
        recordWriteValidation({
          taskId,
          path: pathValue,
          role: "WRITE_FILE",
          validationPassed: true,
          frameworkValidated: call?.result?.writeValidation?.targetApproved === true,
          framework: null,
          validationSource: call?.result?.writeValidation?.source || "WRITE_FILE"
        });
      }
      if (tool === "VALIDATE_PATCH" && call?.success) {
        const file = normalize(call?.args?.file || call?.result?.file || "");
        if (file) {
          recordWriteValidation({
            taskId,
            path: file,
            role: "VALIDATE_PATCH",
            validationPassed: true,
            frameworkValidated: false,
            framework: null,
            validationSource: "VALIDATE_PATCH"
          });
        }
      }
      if (tool === "RUN_TERMINAL") {
        const failureText = [
          call?.error,
          call?.result?.stderr,
          call?.result?.stdout,
          call?.result?.output
        ]
          .map(value => String(value || ""))
          .filter(Boolean)
          .join("\n");
        const candidateFiles = unique(extractPathCandidatesFromText(failureText));
        const externalFiles = filterExistingProjectFailureFiles(workspaceRoot, candidateFiles);
        const exitCode = call?.result?.exitCode;
        const failureAttribution = call?.success === false || (exitCode !== null && exitCode !== undefined && Number(exitCode) !== 0)
          ? (externalFiles.some(file => !isRequestedFile(file, requestedWriteFiles)) ? "external_project_failure" : "requested_scope_failure")
          : null;
        recordTerminalResult({
          taskId,
          command,
          success: call?.success !== false,
          exitCode,
          failureAttribution,
          externalFailureFiles: externalFiles
        });
      }
      if (tool === "RECOVERY") {
        recordRecoveryOwnership({
          taskId,
          rootCauseFile: call?.result?.rootCauseFile || call?.args?.rootCauseFile || null,
          repairTargetFile: call?.result?.repairTargetFile || call?.args?.repairTargetFile || call?.args?.path || null,
          ownership: call?.result?.ownership || call?.args?.ownership || null,
          recoveryType: call?.result?.recoveryType || call?.args?.recoveryType || null
        });
      }
    }

    return getSnapshot();
  }

  function getRequestedWriteFiles() {
    return [...requestedWriteFiles];
  }

  function getPlannerReadFiles() {
    return [...plannerReadFiles];
  }

  function getPlannerRunCommands() {
    return [...plannerRunCommands];
  }

  function getPlannerProtectedFiles() {
    return [...plannerProtectedFiles];
  }

  function getPlannerValidationCommands() {
    return [...plannerValidationCommands];
  }

  function getChangedFiles() {
    return [...changedFiles];
  }

  function getValidatedFiles() {
    return unique([...validatedFiles, ...getVerifiedExistingFiles()]);
  }

  function getValidatedFileDetails() {
    return [...validatedFileDetails.values()];
  }

  function getRequestedFilesValidated() {
    const files = getRequestedWriteFiles();
    if (files.length === 0) return false;
    const validated = new Set([
      ...[...validatedFiles].map(normalizeLower),
      ...getVerifiedExistingFiles().map(normalizeLower)
    ]);
    return files.every(file => validated.has(normalizeLower(file)));
  }

  function getValidationCoverageStatus() {
    const files = getRequestedWriteFiles();
    if (files.length === 0) return "not_required";
    return getRequestedFilesValidated() ? "validated" : "not_validated";
  }

  function getPhysicalChangeStatus() {
    const files = getRequestedWriteFiles();
    if (files.length === 0) return "not_applicable";
    if (getChangedFiles().length > 0) return "changed";
    if (validatedFiles.size > 0 && getRequestedFilesValidated()) return "unchanged_but_valid";
    if (getVerifiedExistingFiles().length > 0) return "already_valid";
    return "unchanged";
  }

  function getValidationFailureAttribution() {
    return validationFailureAttribution;
  }

  function getExternalFailureFiles() {
    return [...new Set(externalFailureFiles)];
  }

  function getValidationExecuted() {
    return validationExecuted;
  }

  function getValidationCommand() {
    return validationCommand;
  }

  function getValidationSuccess() {
    return validationSuccess;
  }

  function getSnapshot() {
    return {
      runId,
      workspaceRoot,
      plannerReadFiles: getPlannerReadFiles(),
      plannerWriteFiles: getRequestedWriteFiles(),
      plannerRunCommands: getPlannerRunCommands(),
      plannerValidationCommands: getPlannerValidationCommands(),
      plannerProtectedFiles: getPlannerProtectedFiles(),
      requestedWriteFiles: getRequestedWriteFiles(),
      changedFiles: getChangedFiles(),
      validatedFiles: getValidatedFiles(),
      verifiedExistingFiles: getVerifiedExistingFiles(),
      validatedFileDetails: getValidatedFileDetails(),
      validationCoverageStatus: getValidationCoverageStatus(),
      physicalChangeStatus: getPhysicalChangeStatus(),
      validationFailureAttribution: getValidationFailureAttribution(),
      externalFailureFiles: getExternalFailureFiles(),
      validationExecuted: getValidationExecuted(),
      validationCommand: getValidationCommand(),
      validationSuccess: getValidationSuccess(),
      requestedFilesValidated: getRequestedFilesValidated(),
      tasks: [...taskRecords.values()]
    };
  }

  return {
    recordTaskPlanned,
    recordReadFile,
    recordWriteValidation,
    recordWriteResult,
    recordTerminalResult,
    recordRecoveryOwnership,
    replayToolCalls,
    logOnce,
    getSnapshot,
    getRequestedWriteFiles,
    getPlannerReadFiles,
    getPlannerRunCommands,
    getPlannerProtectedFiles,
    getPlannerValidationCommands,
    getChangedFiles,
    getValidatedFiles,
    getVerifiedExistingFiles,
    getValidatedFileDetails,
    getValidationCoverageStatus,
    getPhysicalChangeStatus,
    getValidationFailureAttribution,
    getExternalFailureFiles,
    getValidationExecuted,
    getValidationCommand,
    getValidationSuccess,
    getRequestedFilesValidated
  };
}

export function buildExecutionStateRegistry(input = {}) {
  const registry = createExecutionStateRegistry(input);
  registry.replayToolCalls(input);
  return registry;
}
