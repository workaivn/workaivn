import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runAgentLoop } from "../runAgentLoop.js";

const execFileAsync = promisify(execFile);

async function createWorkspace() {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workai-qreg-"));
  await execFileAsync("git", ["init"], { cwd: workspaceRoot });
  await execFileAsync("git", ["config", "user.email", "agent@test.local"], { cwd: workspaceRoot });
  await execFileAsync("git", ["config", "user.name", "Agent Test"], { cwd: workspaceRoot });
  await fs.mkdir(path.join(workspaceRoot, "src"), { recursive: true });
  await fs.writeFile(path.join(workspaceRoot, "src", ".gitkeep"), "", "utf8");
  await execFileAsync("git", ["add", "."], { cwd: workspaceRoot });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: workspaceRoot });
  return workspaceRoot;
}

test("Phase 4.21 regression: WRITE_FILE x2 + RUN_TERMINAL QualityGate score=100", async () => {
  const workspaceRoot = await createWorkspace();

  const bugJsContent = 'function hello() { return "world"; }\nmodule.exports = { hello };\n';
  const bugTestContent = [
    'const assert = require("node:assert");',
    'const { hello } = require("./bug");',
    'assert.strictEqual(hello(), "world");',
    ""
  ].join("\n");

  const coordinatorResponse = {
    files: [
      { path: "src/bug.js", content: bugJsContent },
      { path: "src/bug.test.js", content: bugTestContent }
    ]
  };

  let coordinatorCalls = 0;

  try {
    const result = await runAgentLoop({
      messages: [{
        role: "user",
        content: [
          "WRITE_FILE src/bug.js",
          "WRITE_FILE src/bug.test.js",
          "RUN_TERMINAL node --test src/bug.test.js"
        ].join("\n")
      }],
      workspaceRoot,
      maxSteps: 30,
      generateResponse: async ({ messages }) => {
        const promptText = messages.map(message => String(message?.content || "")).join("\n");
        if (promptText.includes("WRITE COORDINATOR MODE.")) {
          coordinatorCalls += 1;
          return JSON.stringify(coordinatorResponse);
        }
        return JSON.stringify({ done: true, final: "Bug test passed" });
      }
    });

    const termCall = result.toolCalls.find((c) => c.tool === "RUN_TERMINAL");
    assert.ok(termCall, "RUN_TERMINAL must exist in toolCalls");
    assert.equal(termCall.success, true, "RUN_TERMINAL must have success=true");
    assert.equal(termCall.result?.exitCode, 0, "RUN_TERMINAL exitCode must be 0");

    assert.equal(result.qualityGate?.passed, true, "QualityGate must pass");
    assert.equal(result.qualityGate?.score, 100,
      "QualityGate score must be 100, got " + result.qualityGate?.score +
      ". Failures: " + JSON.stringify(result.qualityGate?.failures));
    assert.equal(coordinatorCalls, 1, "Coordinator must call the model once");

    assert.ok(result.plannerDebugSnapshot != null, "plannerDebugSnapshot must exist");
    assert.equal(result.plannerDebugSnapshot.plannerState, "COMPLETED", "plannerDebugSnapshot.plannerState must be COMPLETED");
    assert.ok(result.plannerDebugSnapshot.dag != null, "plannerDebugSnapshot.dag must exist");
    assert.ok(Array.isArray(result.plannerDebugSnapshot.dag.nodes), "plannerDebugSnapshot.dag.nodes must be an array");
    assert.ok(Array.isArray(result.plannerDebugSnapshot.dag.edges), "plannerDebugSnapshot.dag.edges must be an array");
    assert.ok(result.plannerDebugSnapshot.dag.nodes.length >= 3, "plannerDebugSnapshot.dag.nodes must include planner nodes");
    assert.ok(result.plannerDebugSnapshot.dag.edges.length >= 2, "plannerDebugSnapshot.dag.edges must include dependency edges");
    assert.ok(result.plannerDebugSnapshot.costSummary != null, "plannerDebugSnapshot.costSummary must exist");
    assert.ok(result.plannerDebugSnapshot.executionMemory != null, "plannerDebugSnapshot.executionMemory must exist");
    assert.ok(Array.isArray(result.plannerDebugSnapshot.executionMemory.entries), "plannerDebugSnapshot.executionMemory.entries must be an array");
    assert.ok(
      result.plannerDebugSnapshot.executionMemory.entries.length > 0 ||
      result.plannerDebugSnapshot.executionMemory.lookups > 0 ||
      result.plannerDebugSnapshot.executionMemory.stores > 0,
      "plannerDebugSnapshot.executionMemory must not be empty"
    );
    assert.ok(result.plannerDebugSnapshot.runFileMetadata != null, "plannerDebugSnapshot.runFileMetadata must exist");
    assert.ok(result.plannerDebugSnapshot.completionResult != null, "plannerDebugSnapshot.completionResult must exist");
    assert.equal(result.plannerDebugSnapshot.writeCoordinatorUsed, true, "plannerDebugSnapshot.writeCoordinatorUsed must be true");
    assert.ok(Array.isArray(result.plannerDebugSnapshot.coordinatorGroups), "plannerDebugSnapshot.coordinatorGroups must be an array");
    assert.ok(Array.isArray(result.plannerDebugSnapshot.generatedFiles), "plannerDebugSnapshot.generatedFiles must be an array");
    assert.ok(Array.isArray(result.plannerDebugSnapshot.frameworkAdapterResults), "plannerDebugSnapshot.frameworkAdapterResults must be an array");

    const runFileMetaEvent = (result.events || []).find(
      (e) => String(e.type || "").includes("RUN_FILE_METADATA")
    );
    assert.ok(runFileMetaEvent || result.runFileMetadata, "RUN_FILE_METADATA must exist");
    assert.equal(result.success, true, "runAgentLoop result.success must be true");
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
