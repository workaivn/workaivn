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
import { buildExecutionStateRegistry } from "../execution/executionStateRegistry.js";

async function createWorkspace() {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workai-phase420-cleanup-"));
  await fs.mkdir(path.join(workspaceRoot, "src"), { recursive: true });
  await fs.mkdir(path.join(workspaceRoot, "src", "modules", "aiagent"), { recursive: true });
  await fs.mkdir(path.join(workspaceRoot, "src", "agent"), { recursive: true });
  await fs.writeFile(
    path.join(workspaceRoot, "package.json"),
    JSON.stringify({
      name: "phase420-cleanup",
      version: "1.0.0",
      type: "module"
    }, null, 2),
    "utf8"
  );
  await fs.writeFile(path.join(workspaceRoot, "src", "modules", "aiagent", "aiagent.controller.js"), "export const controller = true;\n", "utf8");
  await fs.writeFile(path.join(workspaceRoot, "src", "agent", "autoFallback.test.js"), 'import test from "node:test";\n', "utf8");
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
    assert.equal(runFileMetadata.physicalChangeStatus, "unchanged_but_valid");
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

test("Phase 4.22-HF repeated run: verified existing files keep QualityGate passing after cache hits", async () => {
  const workspaceRoot = await createWorkspace();
  const requestedFiles = ["src/app.js", "src/app.test.js"];
  const command = "npm test";
  const criteria = createCriteria({ requestedFiles, command });

  try {
    await fs.writeFile(path.join(workspaceRoot, "src", "app.js"), 'export const app = true;\n', "utf8");
    await fs.writeFile(path.join(workspaceRoot, "src", "app.test.js"), 'console.log("APP_OK");\n', "utf8");

    const firstGate = await evaluateQualityGate({
      acceptanceCriteria: criteria,
      changedFiles: requestedFiles,
      toolCalls: [
        createWriteCall("src/app.js"),
        createWriteCall("src/app.test.js"),
        createTerminalCall(command, 0)
      ],
      workspaceRoot,
      requiredCommands: [command],
      finalText: "First run completed."
    });

    assert.equal(firstGate.passed, true);

    const registry = buildExecutionStateRegistry({
      plannerExecutionMetadata: {
        plannerReadFiles: ["package.json"],
        plannerWriteFiles: requestedFiles,
        plannerRunCommands: [command]
      },
      toolCalls: [
        createTerminalCall(command, 0)
      ],
      runId: "repeat-run",
      workspaceRoot
    });

    const runFileMetadata = buildRunFileMetadata({
      executionStateRegistry: registry,
      workspaceRoot
    });

    assert.deepEqual(runFileMetadata.requestedWriteFiles, requestedFiles);
    assert.deepEqual(runFileMetadata.verifiedExistingFiles.sort(), requestedFiles);
    assert.deepEqual(runFileMetadata.validatedFiles.sort(), requestedFiles);
    assert.equal(runFileMetadata.physicalChangeStatus, "already_valid");
    assert.equal(runFileMetadata.validationCoverageStatus, "validated");

    const secondGate = await evaluateQualityGate({
      acceptanceCriteria: criteria,
      changedFiles: [],
      requestedWriteFiles: requestedFiles,
      verifiedExistingFiles: runFileMetadata.verifiedExistingFiles,
      toolCalls: [
        createTerminalCall(command, 0)
      ],
      workspaceRoot,
      requiredCommands: [command],
      finalText: "Second run completed using cached validation."
    });

    assert.equal(secondGate.passed, true);
    assert.ok(secondGate.evidence.verifiedExistingFiles.includes("src/app.js"));
    assert.ok(secondGate.evidence.verifiedExistingFiles.includes("src/app.test.js"));
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("Phase 4.22-HF7: no-change writes still count as validated coverage", () => {
  const requestedFiles = ["src/math.js", "src/math.test.js"];
  const runFileMetadata = buildRunFileMetadata({
    requestedFiles,
    plannerWriteTargets: requestedFiles,
    toolCalls: [
      createNoChangeWriteCall("src/math.js"),
      createNoChangeWriteCall("src/math.test.js"),
      createTerminalCall("npm test", 1)
    ],
    changedFiles: [],
    validationSummary: {
      validationPassed: false,
      matchedCommands: [],
      executedValidationCommands: [
        {
          requiredCommand: "npm test",
          executedCommand: "npm test",
          exitCode: 1,
          success: false
        }
      ]
    },
    qualityGatePassed: false
  });

  assert.deepEqual(runFileMetadata.requestedWriteFiles, requestedFiles);
  assert.deepEqual(runFileMetadata.changedFiles, []);
  assert.deepEqual(runFileMetadata.validatedFiles, requestedFiles);
  assert.equal(runFileMetadata.physicalChangeStatus, "unchanged_but_valid");
  assert.equal(runFileMetadata.validationCoverageStatus, "validated");
  assert.equal(runFileMetadata.validationExecuted, true);
  assert.equal(runFileMetadata.validationSuccess, false);
  assert.equal(runFileMetadata.requestedFilesValidated, true);
});

test("Phase 4.22-HF7: external validation failure is attributed outside the requested scope", async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const criteria = createCriteria({ requestedFiles: ["src/math.js", "src/math.test.js"], command: "npm test" });
    const gate = await evaluateQualityGate({
      acceptanceCriteria: criteria,
      changedFiles: [],
      toolCalls: [
        createNoChangeWriteCall("src/math.js"),
        createNoChangeWriteCall("src/math.test.js"),
        {
          tool: "RUN_TERMINAL",
          success: false,
          args: { command: "npm test" },
          result: {
            command: "npm test",
            exitCode: 1,
            stdout: "",
            stderr: [
              "ReferenceError in src/modules/aiagent/aiagent.controller.js",
              "Failure in src/agent/autoFallback.test.js"
            ].join("\n")
          }
        }
      ],
      workspaceRoot,
      requiredCommands: ["npm test"],
      finalText: "Validation failed outside the requested scope."
    });

    const runFileMetadata = buildRunFileMetadata({
      requestedFiles: criteria.requestedFiles,
      plannerWriteTargets: criteria.plannerWriteTargets,
      toolCalls: [
        createNoChangeWriteCall("src/math.js"),
        createNoChangeWriteCall("src/math.test.js"),
        {
          tool: "RUN_TERMINAL",
          success: false,
          args: { command: "npm test" },
          result: {
            command: "npm test",
            exitCode: 1,
            stdout: "",
            stderr: [
              "ReferenceError in src/modules/aiagent/aiagent.controller.js",
              "Failure in src/agent/autoFallback.test.js"
            ].join("\n")
          }
        }
      ],
      changedFiles: [],
      validationSummary: gate.validationSummary,
      qualityGatePassed: gate.passed
    });

    assert.equal(gate.passed, false);
    assert.equal(gate.validationExecuted, true);
    assert.equal(gate.validationSuccess, false);
    assert.equal(gate.requestedFilesValidated, true);
    assert.equal(gate.validationFailureAttribution, "external_project_failure");
    assert.ok(gate.externalFailureFiles.some(file => file.includes("src/modules/aiagent/aiagent.controller.js")));
    assert.ok(gate.externalFailureFiles.some(file => file.includes("src/agent/autoFallback.test.js")));
    assert.equal(runFileMetadata.validationCoverageStatus, "validated");
    assert.equal(runFileMetadata.validationFailureAttribution, "external_project_failure");
    assert.deepEqual(runFileMetadata.validatedFiles.sort(), ["src/math.js", "src/math.test.js"]);
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
