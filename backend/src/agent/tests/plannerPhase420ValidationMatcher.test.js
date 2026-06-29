import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { evaluateQualityGate } from "../qualityGate.js";
import { runAgentLoop } from "../runAgentLoop.js";
import { matchValidationCommand } from "../validationCommandMatcher.js";
import { buildAcceptanceCriteria } from "../acceptanceCriteria.js";

const execFileAsync = promisify(execFile);

async function createWorkspace() {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workai-hf7-"));
  await fs.mkdir(path.join(workspaceRoot, "src"), { recursive: true });
  await fs.writeFile(
    path.join(workspaceRoot, "src", "bug.test.js"),
    [
      "const test = require('node:test');",
      "const assert = require('node:assert/strict');",
      "",
      "test('hf7', () => {",
      "  assert.equal(1, 1);",
      "});",
      ""
    ].join("\n"),
    "utf8"
  );
  await fs.writeFile(
    path.join(workspaceRoot, "package.json"),
    JSON.stringify({
      name: "hf7-validation-matcher",
      version: "1.0.0",
      scripts: {
        test: "node -e \"console.log('HF7_OK')\""
      }
    }, null, 2),
    "utf8"
  );
  await execFileAsync("git", ["init"], { cwd: workspaceRoot });
  await execFileAsync("git", ["config", "user.email", "agent@test.local"], { cwd: workspaceRoot });
  await execFileAsync("git", ["config", "user.name", "Agent Test"], { cwd: workspaceRoot });
  await execFileAsync("git", ["add", "."], { cwd: workspaceRoot });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: workspaceRoot });
  return workspaceRoot;
}

function makeWriteCall(file) {
  return {
    tool: "WRITE_FILE",
    success: true,
    plannerApproved: true,
    args: {
      path: file,
      content: 'console.log("HF7_OK");\n'
    },
    result: {
      success: true,
      changed: true,
      file,
      writeValidation: {
        source: "WRITE_FILE",
        file,
        plannerApproved: true,
        targetApproved: true
      }
    }
  };
}

function makeTerminalCall(command, exitCode = 0) {
  return {
    tool: "RUN_TERMINAL",
    success: exitCode === 0,
    args: { command },
    result: {
      command,
      exitCode,
      stdout: exitCode === 0 ? "HF7_OK" : "",
      stderr: exitCode === 0 ? "" : "validation failed"
    }
  };
}

test("HF7 1: exact required node test command matches", () => {
  const command = "node --test src/bug.test.js";
  const summary = matchValidationCommand({
    requiredCommands: [command],
    terminalCommands: [makeTerminalCall(command, 0)]
  });

  assert.equal(summary.hasRequiredCommands, true);
  assert.equal(summary.validationRan, true);
  assert.equal(summary.validationPassed, true);
  assert.equal(summary.matchedCommands.length, 1);
  assert.equal(summary.matchedCommands[0].executedCommand, command);
});

test("HF7 2: QualityGate accepts required node --test validation", async () => {
  const workspaceRoot = await createWorkspace();
  const targetFile = "src/bug.test.js";
  const command = "node --test src/bug.test.js";
  const criteria = {
    ...buildAcceptanceCriteria(`Create ${targetFile} and run ${command}`),
    taskType: "CODING",
    taskClass: "bugfix",
    taskMode: "coding",
    intentMode: "WRITE_AND_RUN",
    requestedFiles: [targetFile],
    plannerWriteTargets: [targetFile],
    requiredCommands: [command],
    requiresWorkspaceChange: true,
    requiresValidationCommand: true
  };

  try {
    await fs.writeFile(path.join(workspaceRoot, targetFile), 'console.log("HF7_OK");\n', "utf8");

    const gate = await evaluateQualityGate({
      acceptanceCriteria: criteria,
      changedFiles: [targetFile],
      toolCalls: [
        makeWriteCall(targetFile),
        makeTerminalCall(command, 0)
      ],
      workspaceRoot,
      requiredCommands: [command],
      finalText: "Implemented and validated the change."
    });

    assert.equal(gate.passed, true);
    assert.equal(gate.failures.includes("Changed files must pass patch validation."), false);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("HF7 3: finalizer and QualityGate agree on the same validation", async () => {
  const workspaceRoot = await createWorkspace();
  const command = "node --test src/bug.test.js";

  try {
    const result = await runAgentLoop({
      messages: [{
        role: "user",
        content: `Run exactly:\n${command}\nDo not modify source code.\nOnly execute the command.`
      }],
      workspaceRoot,
      maxSteps: 12,
      generateResponse: async () => JSON.stringify({
        tool: "RUN_TERMINAL",
        args: { command },
        done: false
      })
    });

    assert.equal(result.success, true);
    assert.equal(result.status, "completed");
    assert.equal(result.plannerMetrics?.finalizerStatus, "PASS");
    assert.equal(result.qualityGate?.passed, true);
    assert.ok(result.toolCalls.some(call => call.tool === "RUN_TERMINAL" && call.success && call.args?.command === command));
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("HF7 4: failed required command does not count as validation", () => {
  const command = "node --test src/bug.test.js";
  const summary = matchValidationCommand({
    requiredCommands: [command],
    terminalCommands: [makeTerminalCall(command, 1)]
  });

  assert.equal(summary.validationRan, true);
  assert.equal(summary.validationPassed, false);
  assert.equal(summary.failedCommands.length, 1);
  assert.equal(summary.failedCommands[0].requiredCommand, command);
});

test("HF7 5: missing required command is reported as not run", () => {
  const command = "node --test src/bug.test.js";
  const summary = matchValidationCommand({
    requiredCommands: [command],
    terminalCommands: []
  });

  assert.equal(summary.validationRan, false);
  assert.equal(summary.validationPassed, false);
  assert.deepEqual(summary.unmatchedRequiredCommands, [command]);
});

test("HF7 6: whitespace normalization still matches", () => {
  const required = "node --test src/bug.test.js";
  const executed = "  node   --test   src/bug.test.js  ";
  const summary = matchValidationCommand({
    requiredCommands: [required],
    terminalCommands: [makeTerminalCall(executed, 0)]
  });

  assert.equal(summary.validationPassed, true);
  assert.equal(summary.matchedCommands[0].executedCommand, executed.trim());
});

test("HF7 7: quoted path normalization still matches", () => {
  const required = 'node src/bug.test.js';
  const executed = 'node "src/bug.test.js"';
  const summary = matchValidationCommand({
    requiredCommands: [required],
    terminalCommands: [makeTerminalCall(executed, 0)]
  });

  assert.equal(summary.validationPassed, true);
  assert.equal(summary.matchedCommands[0].requiredCommand, required);
});

test("HF7 8: strict fallback stays strict when requiredCommands is empty", () => {
  const summary = matchValidationCommand({
    requiredCommands: [],
    terminalCommands: [makeTerminalCall("echo HF7_OK", 0)]
  });

  assert.equal(summary.hasRequiredCommands, false);
  assert.equal(summary.validationRan, false);
  assert.equal(summary.validationPassed, false);
  assert.equal(summary.matchedCommands.length, 0);
});

test("HF7 9: npm regression still counts as validation", () => {
  const command = "npm test -- plannerPhase420ValidationMatcher";
  const summary = matchValidationCommand({
    requiredCommands: [command],
    terminalCommands: [makeTerminalCall(command, 0)]
  });

  assert.equal(summary.validationPassed, true);
  assert.equal(summary.matchedCommands[0].executedCommand, command);
});
