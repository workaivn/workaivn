import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { evaluateQualityGate } from "../qualityGate.js";
import { deriveRunCompletionResult } from "../../modules/aiagent/aiagent.controller.js";
import { buildAcceptanceCriteria } from "../acceptanceCriteria.js";

async function createWorkspace() {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workai-qg-write-"));
  await fs.mkdir(path.join(workspaceRoot, "src"), { recursive: true });
  return workspaceRoot;
}

function createCodingCriteria({ targetFile, command }) {
  return {
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
}

function createWriteCall(targetFile) {
  return {
    tool: "WRITE_FILE",
    success: true,
    plannerApproved: true,
    args: {
      path: targetFile,
      content: 'console.log("PHASE420_OK");\n'
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

function createTerminalCall(command, exitCode = 0) {
  return {
    tool: "RUN_TERMINAL",
    success: exitCode === 0,
    args: { command },
    result: {
      command,
      exitCode,
      stdout: exitCode === 0 ? "PHASE420_OK" : "",
      stderr: exitCode === 0 ? "" : "validation failed"
    }
  };
}

test("Phase 4.20 HF2: planner WRITE_FILE plus successful validation passes patch validation", async () => {
  const workspaceRoot = await createWorkspace();
  const targetFile = "src/phase420-sync.js";
  const command = `node ${targetFile}`;
  const criteria = createCodingCriteria({ targetFile, command });

  try {
    await fs.writeFile(path.join(workspaceRoot, targetFile), 'console.log("PHASE420_OK");\n', "utf8");

    const gate = await evaluateQualityGate({
      acceptanceCriteria: criteria,
      changedFiles: [targetFile],
      toolCalls: [
        createWriteCall(targetFile),
        createTerminalCall(command, 0)
      ],
      workspaceRoot,
      requiredCommands: [command],
      finalText: "Implemented the file and validated it successfully."
    });

    assert.equal(gate.passed, true);
    assert.equal(gate.failures.includes("Changed files must pass patch validation."), false);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("Phase 4.20 HF2: planner WRITE_FILE without validation still fails patch validation", async () => {
  const workspaceRoot = await createWorkspace();
  const targetFile = "src/phase420-no-validation.js";
  const command = `node ${targetFile}`;
  const criteria = createCodingCriteria({ targetFile, command });

  try {
    await fs.writeFile(path.join(workspaceRoot, targetFile), 'console.log("NO_VALIDATION");\n', "utf8");

    const gate = await evaluateQualityGate({
      acceptanceCriteria: criteria,
      changedFiles: [targetFile],
      toolCalls: [createWriteCall(targetFile)],
      workspaceRoot,
      requiredCommands: [command],
      finalText: "Implemented the file."
    });

    assert.equal(gate.passed, false);
    assert.ok(gate.failures.includes("Changed files must pass patch validation."));
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("Phase 4.20 HF2: unrequested changed file is not accepted by write validation sync", async () => {
  const workspaceRoot = await createWorkspace();
  const requestedFile = "src/requested.js";
  const changedFile = "src/unrequested.js";
  const command = `node ${changedFile}`;
  const criteria = createCodingCriteria({ targetFile: requestedFile, command });

  try {
    await fs.writeFile(path.join(workspaceRoot, changedFile), 'console.log("UNREQUESTED");\n', "utf8");

    const gate = await evaluateQualityGate({
      acceptanceCriteria: criteria,
      changedFiles: [changedFile],
      toolCalls: [
        createWriteCall(changedFile),
        createTerminalCall(command, 0)
      ],
      workspaceRoot,
      requiredCommands: [command],
      finalText: "Implemented and validated a file."
    });

    assert.equal(gate.passed, false);
    assert.ok(gate.failures.includes("Changed files must pass patch validation."));
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("Phase 4.20 HF8 Test 1: requested multi-file changes pass when validation already passed", async () => {
  const workspaceRoot = await createWorkspace();
  const requestedFiles = ["src/bug.js", "src/bug.test.js"];
  const command = "node --test src/bug.test.js";
  const criteria = {
    ...buildAcceptanceCriteria(`Create ${requestedFiles.join(" and ")} and run ${command}`),
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

  try {
    for (const file of requestedFiles) {
      await fs.writeFile(path.join(workspaceRoot, file), 'console.log("HF8_OK");\n', "utf8");
    }

    const gate = await evaluateQualityGate({
      acceptanceCriteria: criteria,
      changedFiles: requestedFiles,
      toolCalls: [
        createWriteCall(requestedFiles[0]),
        createWriteCall(requestedFiles[1]),
        createTerminalCall(command, 0)
      ],
      workspaceRoot,
      requiredCommands: [command],
      finalText: "Implemented and validated the requested files."
    });

    assert.equal(gate.passed, true);
    assert.equal(gate.failures.includes("Changed files must pass patch validation."), false);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("Phase 4.20 HF8 Test 2: changed files outside requested targets fail patch validation", async () => {
  const workspaceRoot = await createWorkspace();
  const requestedFile = "src/bug.js";
  const changedFile = "README.md";
  const command = "node --test src/bug.test.js";
  const criteria = {
    ...buildAcceptanceCriteria(`Create ${requestedFile} and run ${command}`),
    taskType: "CODING",
    taskClass: "bugfix",
    taskMode: "coding",
    intentMode: "WRITE_AND_RUN",
    requestedFiles: [requestedFile],
    plannerWriteTargets: [requestedFile],
    requiredCommands: [command],
    requiresWorkspaceChange: true,
    requiresValidationCommand: true
  };

  try {
    await fs.writeFile(path.join(workspaceRoot, changedFile), "# HF8\n", "utf8");

    const gate = await evaluateQualityGate({
      acceptanceCriteria: criteria,
      changedFiles: [changedFile],
      toolCalls: [
        createWriteCall(changedFile),
        createTerminalCall(command, 0)
      ],
      workspaceRoot,
      requiredCommands: [command],
      finalText: "Implemented and validated the change."
    });

    assert.equal(gate.passed, false);
    assert.ok(gate.failures.includes("Changed files must pass patch validation."));
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("Phase 4.20 HF8 Test 3: requested subset of allowed files still passes", async () => {
  const workspaceRoot = await createWorkspace();
  const requestedFiles = ["src/a.js", "src/b.js"];
  const changedFiles = ["src/a.js"];
  const command = "node --test src/a.test.js";
  const criteria = {
    ...buildAcceptanceCriteria(`Create ${requestedFiles.join(" and ")} and run ${command}`),
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

  try {
    await fs.writeFile(path.join(workspaceRoot, changedFiles[0]), 'console.log("HF8_OK");\n', "utf8");

    const gate = await evaluateQualityGate({
      acceptanceCriteria: criteria,
      changedFiles,
      toolCalls: [
        createWriteCall(changedFiles[0]),
        createTerminalCall(command, 0)
      ],
      workspaceRoot,
      requiredCommands: [command],
      finalText: "Implemented and validated the subset change."
    });

    assert.equal(gate.passed, true);
    assert.equal(gate.failures.includes("Changed files must pass patch validation."), false);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("Phase 4.20 HF8 Test 4: validation failure still fails even with correct files", async () => {
  const workspaceRoot = await createWorkspace();
  const targetFile = "src/bug.js";
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
    await fs.writeFile(path.join(workspaceRoot, targetFile), 'console.log("HF8_OK");\n', "utf8");

    const gate = await evaluateQualityGate({
      acceptanceCriteria: criteria,
      changedFiles: [targetFile],
      toolCalls: [
        createWriteCall(targetFile),
        createTerminalCall(command, 1)
      ],
      workspaceRoot,
      requiredCommands: [command],
      finalText: "Implemented but validation failed."
    });

    assert.equal(gate.passed, false);
    assert.ok(gate.failures.includes("Changed files must pass patch validation."));
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("Phase 4.20 HF8 Test 5: completion result derives one saved success value", () => {
  const completed = deriveRunCompletionResult({
    status: "completed",
    qualityGate: { passed: true }
  });
  assert.equal(completed.savedStatus, "completed");
  assert.equal(completed.savedSuccess, true);

  const revised = deriveRunCompletionResult({
    status: "completed",
    qualityGate: { passed: false }
  });
  assert.equal(revised.savedStatus, "needs_revision");
  assert.equal(revised.savedSuccess, false);
});
