import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildRunFileMetadata } from "../runAgentLoop.js";
import { buildExecutionStateRegistry, createExecutionStateRegistry, extractExternalFailureFilesFromText } from "../execution/executionStateRegistry.js";

function captureLogs() {
  const logs = [];
  const original = console.log;
  console.log = (...args) => {
    logs.push(args.map(arg => (typeof arg === "object" ? JSON.stringify(arg) : String(arg))).join(" "));
    return original.apply(console, args);
  };
  return {
    logs,
    restore() {
      console.log = original;
    }
  };
}

test("execution state registry initializes from normalized planner metadata", () => {
  const registry = createExecutionStateRegistry({
    plannerExecutionMetadata: {
      plannerReadFiles: ["package.json"],
      plannerWriteFiles: ["src/math.js", "src/math.test.js"],
      plannerRunCommands: ["npm test"],
      plannerProtectedFiles: ["package.json"]
    },
    runId: "run-1",
    workspaceRoot: "G:/langtuvn/ai_local"
  });

  assert.deepEqual(registry.getPlannerReadFiles(), ["package.json"]);
  assert.deepEqual(registry.getRequestedWriteFiles(), ["src/math.js", "src/math.test.js"]);
  assert.deepEqual(registry.getPlannerRunCommands(), ["npm test"]);
  assert.deepEqual(registry.getPlannerProtectedFiles(), ["package.json"]);
});

test("execution state registry counts no-change writes as validated coverage", () => {
  const registry = buildExecutionStateRegistry({
    plannerExecutionMetadata: {
      plannerWriteFiles: ["src/math.js"],
      plannerReadFiles: []
    },
    toolCalls: [
      {
        tool: "WRITE_FILE",
        success: true,
        args: { path: "src/math.js", content: "export const value = 1;\n" },
        result: {
          success: true,
          changed: false,
          alreadyUpToDate: true,
          file: "src/math.js",
          writeValidation: {
            source: "WRITE_FILE",
            file: "src/math.js",
            targetApproved: true
          }
        }
      }
    ],
    runId: "run-2",
    workspaceRoot: "G:/langtuvn/ai_local"
  });

  assert.deepEqual(registry.getValidatedFiles(), ["src/math.js"]);
  assert.deepEqual(registry.getChangedFiles(), []);
  assert.equal(registry.getPhysicalChangeStatus(), "unchanged_but_valid");
  assert.equal(registry.getValidationCoverageStatus(), "validated");
});

test("execution state registry preserves external failure attribution and filters external failure files", () => {
  const registry = createExecutionStateRegistry({
    plannerExecutionMetadata: {
      plannerWriteFiles: ["src/math.js", "src/math.test.js"],
      plannerReadFiles: ["package.json"]
    },
    runId: "run-3",
    workspaceRoot: "G:/langtuvn/ai_local"
  });

  registry.recordTerminalResult({
    taskId: "terminal-1",
    command: "npm test",
    success: false,
    exitCode: 1,
    failureAttribution: "external_project_failure",
    externalFailureFiles: [
      "README.md",
      "Node.js",
      "src/modules/aiagent/aiagent.controller.js",
      "src/agent/autoFallback.test.js"
    ]
  });

  registry.recordTerminalResult({
    taskId: "terminal-1",
    command: "npm test",
    success: false,
    exitCode: 1,
    failureAttribution: "requested_scope_failure",
    externalFailureFiles: ["src/math.js"]
  });

  assert.equal(registry.getValidationFailureAttribution(), "external_project_failure");
  assert.deepEqual(registry.getExternalFailureFiles().sort(), [
    "src/agent/autoFallback.test.js",
    "src/modules/aiagent/aiagent.controller.js"
  ]);
});

test("external failure parser only keeps stack root cause files from noisy stdout", () => {
  return (async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workai-external-parser-"));
    try {
      await fs.mkdir(path.join(workspaceRoot, "src", "modules", "aiagent"), { recursive: true });
      await fs.mkdir(path.join(workspaceRoot, "src", "agent"), { recursive: true });
      await fs.writeFile(path.join(workspaceRoot, "src", "modules", "aiagent", "aiagent.controller.js"), "export const controller = true;\n", "utf8");
      await fs.writeFile(path.join(workspaceRoot, "src", "agent", "autoFallback.test.js"), 'import test from "node:test";\n', "utf8");
      const noisyStdout = [
        "src/test.js src/App.js src/index.js src/server.js src/workai-local-test.js",
        "more noise mentioning src/generated.js and src/example.js",
        "ReferenceError: boom",
        "    at Object.<anonymous> (src/modules/aiagent/aiagent.controller.js:12:3)",
        "    at Object.<anonymous> (src/agent/autoFallback.test.js:48:1)",
        "    at node:internal/main/run_main_module:28:49"
      ].join("\n");

      assert.deepEqual(
        extractExternalFailureFilesFromText(noisyStdout, workspaceRoot).sort(),
        [
          "src/agent/autoFallback.test.js",
          "src/modules/aiagent/aiagent.controller.js"
        ]
      );
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  })();
});

test("execution state registry emits task ids for write lifecycle events", () => {
  const logger = captureLogs();
  try {
    const registry = createExecutionStateRegistry({
      plannerExecutionMetadata: {
        plannerWriteFiles: ["src/math.js", "src/math.test.js"]
      },
      runId: "run-taskid",
      workspaceRoot: "G:/langtuvn/ai_local"
    });

    registry.recordTaskPlanned({ id: "task-1", tool: "WRITE_FILE", toolArgs: { path: "src/math.js" } });
    registry.recordWriteResult({
      taskId: "task-1",
      path: "src/math.js",
      status: "SUCCESS",
      writeStatus: "no_change",
      physicalChanged: false,
      reason: "content_identical"
    });
    registry.recordWriteValidation({
      taskId: "task-1",
      path: "src/math.js",
      role: "WRITE_FILE",
      validationPassed: true,
      frameworkValidated: false,
      validationSource: "WRITE_FILE"
    });

    assert.ok(logger.logs.some(line => line.includes("[EXECUTION_STATE_CHANGED_FILE]") && line.includes('"taskId":"task-1"')));
    assert.ok(logger.logs.some(line => line.includes("[EXECUTION_STATE_VALIDATED_FILE]") && line.includes('"taskId":"task-1"')));
    assert.ok(logger.logs.some(line => line.includes("[WRITE_TASK_FINALIZED]") && line.includes('"taskId":"task-1"')));
  } finally {
    logger.restore();
  }
});

test("execution state registry dedupes write logs per task and path", () => {
  const logger = captureLogs();
  try {
    const registry = createExecutionStateRegistry({
      plannerExecutionMetadata: {
        plannerWriteFiles: ["src/math.js"]
      },
      runId: "run-dedupe",
      workspaceRoot: "G:/langtuvn/ai_local"
    });

    registry.recordWriteResult({
      taskId: "task-2",
      path: "src/math.js",
      status: "SUCCESS",
      writeStatus: "no_change",
      physicalChanged: false,
      reason: "content_identical"
    });
    registry.recordWriteResult({
      taskId: "task-2",
      path: "src/math.js",
      status: "SUCCESS",
      writeStatus: "no_change",
      physicalChanged: false,
      reason: "content_identical"
    });

    const noChangeLogs = logger.logs.filter(line => line.includes("[WRITE_SKIPPED_NO_CHANGE]"));
    const finalizedLogs = logger.logs.filter(line => line.includes("[WRITE_TASK_FINALIZED]"));
    assert.equal(noChangeLogs.length, 1);
    assert.equal(finalizedLogs.length, 1);
  } finally {
    logger.restore();
  }
});

test("run file metadata reads from the execution state registry instead of planner heuristics", () => {
  return (async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workai-registry-metadata-"));
    try {
      await fs.mkdir(path.join(workspaceRoot, "src", "modules", "aiagent"), { recursive: true });
      await fs.mkdir(path.join(workspaceRoot, "src", "agent"), { recursive: true });
      await fs.writeFile(path.join(workspaceRoot, "src", "modules", "aiagent", "aiagent.controller.js"), "export const controller = true;\n", "utf8");
      await fs.writeFile(path.join(workspaceRoot, "src", "agent", "autoFallback.test.js"), 'import test from "node:test";\n', "utf8");

      const registry = buildExecutionStateRegistry({
        plannerExecutionMetadata: {
          plannerReadFiles: ["package.json"],
          plannerWriteFiles: ["src/math.js", "src/math.test.js"],
          plannerRunCommands: ["npm test"],
          plannerProtectedFiles: ["package.json"]
        },
        toolCalls: [
          {
            taskId: "task-write-1",
            tool: "WRITE_FILE",
            success: true,
            args: { path: "src/math.js", content: "export const value = 1;\n" },
            result: {
              success: true,
              changed: false,
              alreadyUpToDate: true,
              file: "src/math.js",
              writeValidation: { source: "WRITE_FILE", file: "src/math.js", targetApproved: true }
            }
          },
          {
            taskId: "task-write-2",
            tool: "WRITE_FILE",
            success: true,
            args: { path: "src/math.test.js", content: "test('ok', () => expect(true).toBe(true));\n" },
            result: {
              success: true,
              changed: true,
              file: "src/math.test.js",
              writeValidation: { source: "WRITE_FILE", file: "src/math.test.js", targetApproved: true }
            }
          },
          {
            taskId: "task-run",
            tool: "RUN_TERMINAL",
            success: false,
            args: { command: "npm test" },
            result: {
              command: "npm test",
              exitCode: 1,
              stderr: "ReferenceError in src/modules/aiagent/aiagent.controller.js\nFailure in src/agent/autoFallback.test.js"
            }
          }
        ],
        runId: "run-4",
        workspaceRoot
      });

      const runFileMetadata = buildRunFileMetadata({
        executionStateRegistry: registry,
        workspaceRoot
      });

      assert.deepEqual(runFileMetadata.requestedWriteFiles, ["src/math.js", "src/math.test.js"]);
      assert.deepEqual(runFileMetadata.plannerReadFiles, ["package.json"]);
      assert.deepEqual(runFileMetadata.changedFiles, ["src/math.test.js"]);
      assert.deepEqual(runFileMetadata.validatedFiles.sort(), ["src/math.js", "src/math.test.js"]);
      assert.equal(runFileMetadata.physicalChangeStatus, "changed");
      assert.equal(runFileMetadata.validationCoverageStatus, "validated");
      assert.equal(runFileMetadata.validationFailureAttribution, "external_project_failure");
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  })();
});
