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
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workai-finalizer-"));
  await fs.mkdir(path.join(workspaceRoot, "src"), { recursive: true });
  await fs.writeFile(
    path.join(workspaceRoot, "package.json"),
    JSON.stringify({
      name: "finalizer-test",
      version: "1.0.0",
      scripts: {
        test: "node -e \"console.log('PLANNER420_OK')\""
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

test("successful deterministic validation terminates the run immediately", async () => {
  const workspaceRoot = await createWorkspace();
  let modelCalls = 0;

  try {
    const result = await runAgentLoop({
      messages: [{
        role: "user",
        content: "Run exactly:\nnpm test -- plannerPhase419\nDo not modify source code.\nOnly execute the command."
      }],
      workspaceRoot,
      maxSteps: 12,
      generateResponse: async () => {
        modelCalls += 1;
        if (modelCalls > 1) {
          throw new Error("runAgentLoop requested an extra model response after validation passed");
        }
        return JSON.stringify({
          tool: "RUN_TERMINAL",
          args: { command: "npm test -- plannerPhase419" },
          done: false
        });
      }
    });

    assert.equal(modelCalls, 1);
    assert.equal(result.success, true);
    assert.equal(result.status, "completed");
    assert.equal(result.plannerMetrics?.finalizerStatus, "PASS");
    assert.equal(result.qualityGate?.passed, true);
    assert.ok(result.toolCalls.some(call => call.tool === "RUN_TERMINAL" && call.success && call.args?.command === "npm test -- plannerPhase419"));
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
