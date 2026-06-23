import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runAgentLoop } from "./runAgentLoop.js";
import { buildAcceptanceCriteria } from "./acceptanceCriteria.js";

const execFileAsync = promisify(execFile);

async function createWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workai-readonly-"));
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "test-project",
    version: "1.2.3",
    description: "A test project"
  }, null, 2) + "\n");
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "readonly@test.local"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "ReadOnly Test"], { cwd: root });
  await execFileAsync("git", ["add", "package.json"], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
  return root;
}

test("read-only package.json request: reads file once, produces final answer without extra calls", async () => {
  const root = await createWorkspace();

  try {
    const criteria = buildAcceptanceCriteria(
      "Find package.json. Read it only. Tell me project name and version. Do not modify files. Do not run terminal."
    );

    // Simulate a model that on first call reads package.json, on second call would try to re-read
    const responses = [
      JSON.stringify({ tool: "READ_FILE", args: { path: "package.json" }, reason: "Find package.json", done: false }),
      JSON.stringify({ tool: "READ_FILE", args: { path: "package.json" }, reason: "Reading again", done: false }),
      JSON.stringify({ done: true, final: "Project name: test-project, Version: 1.2.3" })
    ];

    const result = await runAgentLoop({
      messages: [{
        role: "user",
        content: "Find package.json. Read it only. Tell me project name and version. Do not modify files. Do not run terminal."
      }],
      workspaceRoot: root,
      maxSteps: 10,
      acceptanceCriteria: criteria,
      generateResponse: async () => responses.shift() || JSON.stringify({ done: true, final: "Done" })
    });

    // Should complete (deterministic path - breaks after reading package.json)
    assert.equal(result.status, "completed");

    const readFileCalls = result.toolCalls.filter(c => c.tool === "READ_FILE");
    const writeFileCalls = result.toolCalls.filter(c => c.tool === "WRITE_FILE");
    const applyPatchCalls = result.toolCalls.filter(c => c.tool === "APPLY_PATCH");
    const terminalCalls = result.toolCalls.filter(c => c.tool === "RUN_TERMINAL");

    // Should have exactly one READ_FILE call
    assert.equal(readFileCalls.length, 1, "Should read package.json exactly once");
    assert.equal(writeFileCalls.length, 0, "Should not write any files");
    assert.equal(applyPatchCalls.length, 0, "Should not apply any patches");
    assert.equal(terminalCalls.length, 0, "Should not run terminal");

    // Final answer should contain project info
    assert.match(result.final, /test-project/);
    assert.match(result.final, /1\.2\.3/);

    // Should complete in 3 steps or fewer
    const steps = result.events.filter(e => e.type === "thinking").length;
    assert.ok(steps <= 3, `Should complete in ≤3 steps, got ${steps}`);

    assert.equal(result.qualityGate.passed, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("read-only task with model producing done:true on first step", async () => {
  const root = await createWorkspace();

  try {
    const result = await runAgentLoop({
      messages: [{
        role: "user",
        content: "Tell me what is in package.json. Do not modify files."
      }],
      workspaceRoot: root,
      maxSteps: 10,
      generateResponse: async () => JSON.stringify({ done: true, final: "The package.json contains test-project version 1.2.3" })
    });

    assert.equal(result.status, "completed");
    assert.match(result.final, /test-project/);
    assert.equal(result.qualityGate.passed, true);

    const readFileCalls = result.toolCalls.filter(c => c.tool === "READ_FILE");
    const writeFileCalls = result.toolCalls.filter(c => c.tool === "WRITE_FILE");
    assert.equal(writeFileCalls.length, 0, "Should not write any files");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
