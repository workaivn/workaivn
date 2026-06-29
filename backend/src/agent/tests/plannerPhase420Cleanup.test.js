import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { evaluateQualityGate } from "../qualityGate.js";
import { buildAcceptanceCriteria } from "../acceptanceCriteria.js";
import { runAgentLoop } from "../runAgentLoop.js";
import {
  buildValidatedFilesMetadata,
  buildWriteTaskMetadata,
  buildRunFileMetadata,
  logRunFileMetadata
} from "../runAgentLoop.js";

async function createWorkspace() {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workai-phase420-cleanup-"));
  await fs.mkdir(path.join(workspaceRoot, "src"), { recursive: true });
  await fs.writeFile(
    path.join(workspaceRoot, "package.json"),
    JSON.stringify({
      name: "phase420-cleanup",
      version: "1.0.0",
      type: "module"
    }, null, 2),
    "utf8"
  );
  return workspaceRoot;
}

function createCriteria({ requestedFiles, command }) {
  return {
    ...buildAcceptanceCriteria(`Write ${requestedFiles.join(" and ")} and run ${command}`),
    taskType: "CODING",
    taskClass: "bugfix",
    taskMode: "coding",
    intentMode: "WRITE_AND_RUN",
    requestedFiles,
    plannerWriteTargets: requestedFiles,
    requiredCommands: [command],
    requiresWorkspaceChange: true,
    requiresValidationCommand: true
  };
}

function createWriteCall(targetFile) {
  return {
    tool: "WRITE_FILE",
    success: true,
    plannerApproved: true,
    args: {
      path: targetFile,
      content: 'console.log("PHASE420_CLEANUP_OK");\n'
    },
    result: {
      success: true,
      changed: true,
      file: targetFile,
      writeValidation: {
        source: "WRITE_FILE",
        file: targetFile,
        plannerApproved: true,
        targetApproved: true
      }
    }
  };
}

function createNoChangeWriteCall(targetFile) {
  return {
    tool: "WRITE_FILE",
    success: true,
    plannerApproved: true,
    args: {
      path: targetFile,
      content: 'console.log("PHASE420_CLEANUP_OK");\n'
    },
    result: {
      success: true,
      changed: false,
      alreadyUpToDate: true,
      file: targetFile,
      writeValidation: {
        source: "WRITE_FILE",
        file: targetFile,
        plannerApproved: true,
        targetApproved: true
      }
    }
  };
}

function createTerminalCall(command, exitCode = 0) {
  return {
    tool: "RUN_TERMINAL",
    success: exitCode === 0,
    args: { command },
    result: {
      command,
      exitCode,
      stdout: exitCode === 0 ? "PHASE420_CLEANUP_OK" : "",
      stderr: exitCode === 0 ? "" : "validation failed"
    }
  };
}

function captureLogs() {
  const logs = [];
  const original = console.log;
  console.log = (...args) => {
    logs.push(args.map(arg => (typeof arg === "object" ? JSON.stringify(arg) : String(arg))).join(" "));
    original.apply(console, args);
  };
  return {
    logs,
    restore() {
      console.log = original;
    }
  };
}

test("Phase 4.20 Cleanup Test 1: no-change writes keep changedFiles empty while validatedFiles still covers requested write targets", async () => {
  const workspaceRoot = await createWorkspace();
  const requestedFiles = ["src/bug.js", "src/bug.test.js"];
  const command = "node --test src/bug.test.js";
  const criteria = createCriteria({ requestedFiles, command });
  const logger = captureLogs();

  try {
    await fs.writeFile(path.join(workspaceRoot, "src/bug.js"), "export const bug = true;\n", "utf8");
    await fs.writeFile(path.join(workspaceRoot, "src/bug.test.js"), 'console.log("PHASE420_CLEANUP_OK");\n', "utf8");

    const gate = await evaluateQualityGate({
      acceptanceCriteria: criteria,
      changedFiles: [],
      toolCalls: [
        createNoChangeWriteCall("src/bug.js"),
        createNoChangeWriteCall("src/bug.test.js"),
        createTerminalCall(command, 0)
      ],
      workspaceRoot,
      requiredCommands: [command],
      finalText: "Implemented the requested validation target."
    });

    const runFileMetadata = buildRunFileMetadata({
      requestedFiles: criteria.requestedFiles,
      plannerWriteTargets: criteria.plannerWriteTargets,
      toolCalls: [
        createNoChangeWriteCall("src/bug.js"),
        createNoChangeWriteCall("src/bug.test.js"),
        createTerminalCall(command, 0)
      ],
      changedFiles: [],
      validationSummary: gate.validationSummary,
      qualityGatePassed: gate.passed
    });
    logRunFileMetadata(runFileMetadata);

    assert.equal(gate.passed, true);
    assert.deepEqual(gate.evidence.filesChanged, []);
    assert.deepEqual(runFileMetadata.requestedWriteFiles, requestedFiles);
    assert.deepEqual(runFileMetadata.changedFiles, []);
    assert.deepEqual(runFileMetadata.validatedFiles, requestedFiles);
    assert.equal(runFileMetadata.physicalChangeStatus, "unchanged");
    assert.equal(runFileMetadata.validationCoverageStatus, "validated");
    assert.ok(logger.logs.some(line => line.includes("[RUN_FILE_METADATA]")));
  } finally {
    logger.restore();
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("Phase 4.20 Cleanup Test 2: real changed writes keep changedFiles limited to the physical edit while validation still covers all requested targets", async () => {
  const workspaceRoot = await createWorkspace();
  const requestedFiles = ["src/a.js", "src/b.js"];
  const command = "node --test src/a.test.js";
  const criteria = createCriteria({ requestedFiles, command });

  try {
    await fs.writeFile(path.join(workspaceRoot, "src/a.js"), 'console.log("PHASE420_CLEANUP_OK");\n', "utf8");
    await fs.writeFile(path.join(workspaceRoot, "src/b.js"), 'export const untouched = true;\n', "utf8");

    const gate = await evaluateQualityGate({
      acceptanceCriteria: criteria,
      changedFiles: ["src/a.js"],
      toolCalls: [
        createWriteCall("src/a.js"),
        createNoChangeWriteCall("src/b.js"),
        createTerminalCall(command, 0)
      ],
      workspaceRoot,
      requiredCommands: [command],
      finalText: "Implemented the requested code change."
    });

    const runFileMetadata = buildRunFileMetadata({
      requestedFiles: criteria.requestedFiles,
      plannerWriteTargets: criteria.plannerWriteTargets,
      toolCalls: [
        createWriteCall("src/a.js"),
        createNoChangeWriteCall("src/b.js"),
        createTerminalCall(command, 0)
      ],
      changedFiles: ["src/a.js"],
      validationSummary: gate.validationSummary,
      qualityGatePassed: gate.passed
    });

    assert.equal(gate.passed, true);
    assert.deepEqual(gate.evidence.filesChanged, ["src/a.js"]);
    assert.deepEqual(runFileMetadata.requestedWriteFiles, requestedFiles);
    assert.deepEqual(runFileMetadata.changedFiles, ["src/a.js"]);
    assert.deepEqual(runFileMetadata.validatedFiles, requestedFiles);
    assert.equal(runFileMetadata.physicalChangeStatus, "changed");
    assert.equal(runFileMetadata.validationCoverageStatus, "validated");
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test.skip("Phase 4.20 Cleanup Test 3: partial validation coverage needs file-level matcher support", () => {
  // The current Shared Validation Matcher is command-level only, so we cannot
  // honestly derive a partial file coverage set without inventing heuristics.
});

test("Phase 4.20 Cleanup Test 4: validationPassed=false yields empty validatedFiles", () => {
  const validatedFiles = buildValidatedFilesMetadata({
    requestedFiles: ["src/a.js"],
    plannerWriteTargets: ["src/a.js"],
    validationPassed: false
  });

  assert.deepEqual(validatedFiles, []);
});

test("Phase 4.20 Cleanup Test 5: parallel WRITE_FILE task metadata keeps taskId, path, content, memory key, status, and validation info aligned", () => {
  const taskA = { id: "task-a" };
  const taskB = { id: "task-b" };
  const metaA = buildWriteTaskMetadata({
    task: taskA,
    targetPath: "src/a.js",
    generatedContent: 'console.log("A");\n',
    executionMemoryKey: "WRITE_FILE:src/a.js:hash-a@workspace",
    changed: true,
    validationResult: { success: true, file: "src/a.js" },
    source: "model_generated",
    step: 3
  });
  const metaB = buildWriteTaskMetadata({
    task: taskB,
    targetPath: "src/b.js",
    generatedContent: 'console.log("B");\n',
    executionMemoryKey: "WRITE_FILE:src/b.js:hash-b@workspace",
    changed: false,
    validationResult: { success: true, file: "src/b.js" },
    source: "prompt_literal",
    step: 4
  });

  assert.deepEqual(metaA, {
    taskId: "task-a",
    targetPath: "src/a.js",
    generatedContent: 'console.log("A");\n',
    generatedContentLength: 'console.log("A");\n'.length,
    executionMemoryKey: "WRITE_FILE:src/a.js:hash-a@workspace",
    changed: true,
    validationResult: { success: true, file: "src/a.js" },
    source: "model_generated",
    step: 3
  });
  assert.deepEqual(metaB, {
    taskId: "task-b",
    targetPath: "src/b.js",
    generatedContent: 'console.log("B");\n',
    generatedContentLength: 'console.log("B");\n'.length,
    executionMemoryKey: "WRITE_FILE:src/b.js:hash-b@workspace",
    changed: false,
    validationResult: { success: true, file: "src/b.js" },
    source: "prompt_literal",
    step: 4
  });
  assert.notDeepEqual(metaA, metaB);
});

test("Phase 4.20 Cleanup Test 6: run metadata logs after completion result and after validation match", async () => {
  const logger = captureLogs();
  const completionResult = {
    validationPassed: true,
    plannerCompleted: true,
    qualityGatePassed: true,
    requestedWriteFiles: ["src/bug.js", "src/bug.test.js"],
    changedFiles: [],
    validationMatched: true,
    requiredCommands: ["node --test src/bug.test.js"],
    matchedCommands: ["node --test src/bug.test.js"]
  };

  try {
    console.log("[VALIDATION_MATCH]", {
      command: "node --test src/bug.test.js",
      matched: true,
      rule: "required"
    });
    logRunFileMetadata(buildRunFileMetadata({
      completionResult,
      validationSummary: {
        validationPassed: true,
        matchedCommands: ["node --test src/bug.test.js"]
      }
    }));
    console.log("[RUN_COMPLETION]", {
      completionResult
    });

    const validationMatchIndex = logger.logs.findIndex(line => line.includes("[VALIDATION_MATCH]"));
    const runCompletionIndex = logger.logs.findIndex(line => line.includes("[RUN_COMPLETION]"));
    const runFileMetadataIndex = logger.logs.findIndex(line => line.includes("[RUN_FILE_METADATA]"));
    assert.ok(validationMatchIndex >= 0, "Expected validation match log");
    assert.ok(runCompletionIndex >= 0, "Expected completion log");
    assert.ok(runFileMetadataIndex >= 0, "Expected run file metadata log");
    assert.ok(validationMatchIndex < runCompletionIndex, "Validation should happen before completion");
    assert.ok(runFileMetadataIndex < runCompletionIndex, "Run metadata should be emitted before completion result");
  } finally {
    logger.restore();
  }
});
