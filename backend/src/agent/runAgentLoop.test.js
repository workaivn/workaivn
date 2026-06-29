import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runAgentLoop } from "./runAgentLoop.js";
import { executeTool } from "./toolExecutor.js";

const execFileAsync = promisify(execFile);

async function createWorkspace() {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workai-agent-"));
  await fs.writeFile(
    path.join(workspaceRoot, "example.js"),
    "export function value() {\n  return 1;\n}\n",
    "utf8"
  );
  await execFileAsync("git", ["init"], { cwd: workspaceRoot });
  await execFileAsync("git", ["config", "user.email", "agent@test.local"], { cwd: workspaceRoot });
  await execFileAsync("git", ["config", "user.name", "Agent Test"], { cwd: workspaceRoot });
  await execFileAsync("git", ["add", "example.js"], { cwd: workspaceRoot });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: workspaceRoot });
  return workspaceRoot;
}

test("runAgentLoop persists a patch and reports tools, events, files, and diff", async () => {
  const workspaceRoot = await createWorkspace();
  const responses = [
    { tool: "LIST_FILES", args: {}, done: false },
    { tool: "READ_FILE", args: { path: "example.js" }, done: false },
    {
      tool: "APPLY_PATCH",
      args: {
        file: "example.js",
        find: "return 1;",
        replace: "return 2;"
      },
      done: false
    },
    {
      tool: "RUN_TERMINAL",
      args: { command: "node --check example.js" },
      done: false
    },
    { done: true, final: "Updated the implementation." }
  ];

  try {
    const result = await runAgentLoop({
      messages: [{ role: "user", content: "Change value() to return 2." }],
      workspaceRoot,
      maxSteps: responses.length,
      generateResponse: async () => JSON.stringify(responses.shift())
    });

    assert.equal(result.success, true);
    assert.deepEqual(result.changedFiles, ["example.js"]);
    assert.ok(result.toolCalls.some(call => call.tool === "APPLY_PATCH" && call.success));
    assert.ok(result.toolCalls.some(call => call.tool === "VALIDATE_PATCH" && call.success));
    assert.ok(result.events.some(event => event.type === "file_changed"));
    assert.match(result.diffSummary.stat, /example\.js/);
    assert.match(await fs.readFile(path.join(workspaceRoot, "example.js"), "utf8"), /return 2;/);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("runAgentLoop rejects completion when no files changed", async () => {
  const workspaceRoot = await createWorkspace();

  try {
    const result = await runAgentLoop({
      messages: [{ role: "user", content: "Make a code change." }],
      workspaceRoot,
      maxSteps: 1,
      generateResponse: async () => JSON.stringify({ done: true, final: "Done" })
    });

    assert.equal(result.success, false);
    assert.equal(result.changedFiles.length, 0);
    assert.match(result.error, /No meaningful source files were changed/);
    assert.equal(result.status, "needs_revision");
    assert.ok(result.events.some(event => event.type === "completion_rejected"));
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("filesystem tools reject paths outside the configured workspace", async () => {
  const workspaceRoot = await createWorkspace();

  try {
    const result = await executeTool(
      "WRITE_FILE",
      { path: "../outside.js", content: "unsafe" },
      { workspaceRoot }
    );

    assert.equal(result.success, false);
    assert.match(result.error, /escapes (?:agent|selected) workspace/);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("runAgentLoop accepts JSON inside markdown fences and surrounding text", async () => {
  const workspaceRoot = await createWorkspace();

  try {
    const result = await runAgentLoop({
      messages: [{ role: "user", content: "Inspect the repository." }],
      workspaceRoot,
      maxSteps: 1,
      generateResponse: async () => [
        "I will inspect it now.",
        "```json",
        '{"tool":"LIST_FILES","args":{},"done":false}',
        "```",
        "Additional prose with {not valid JSON}."
      ].join("\n")
    });

    assert.equal(result.toolCalls[0]?.tool, "LIST_FILES");
    assert.equal(result.toolCalls[0]?.success, true);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("runAgentLoop retries once with a strict JSON-only instruction", async () => {
  const workspaceRoot = await createWorkspace();
  const calls = [];

  try {
    const result = await runAgentLoop({
      messages: [{ role: "user", content: "Inspect the repository." }],
      workspaceRoot,
      maxSteps: 1,
      generateResponse: async request => {
        calls.push(request);
        return calls.length === 1
          ? "I forgot to return JSON."
          : '{"tool":"LIST_FILES","args":{},"done":false}';
      }
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[1].retry, true);
    assert.equal(calls[1].messages.at(-1).content, "Return only valid JSON object");
    assert.equal(result.toolCalls[0]?.tool, "LIST_FILES");
    assert.ok(result.events.some(event => event.type === "json_parse_retry"));
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("runAgentLoop dispatches parallel READ_FILE tasks and stops without model call", async () => {
  const workspaceRoot = await createWorkspace();
  // Create additional files to read
  await fs.writeFile(path.join(workspaceRoot, "a.json"), JSON.stringify({ a: 1 }), "utf8");
  await fs.writeFile(path.join(workspaceRoot, "b.json"), JSON.stringify({ b: 2 }), "utf8");
  await execFileAsync("git", ["add", "a.json", "b.json"], { cwd: workspaceRoot });
  await execFileAsync("git", ["commit", "-m", "add test files"], { cwd: workspaceRoot });

  let modelCallCount = 0;

  try {
    const result = await runAgentLoop({
      messages: [{ role: "user", content: "Read a.json and b.json and summarize them." }],
      workspaceRoot,
      maxSteps: 10,
      acceptanceCriteria: {
        taskType: "SEARCH",
        taskMode: "read_only",
        requestedFiles: ["a.json", "b.json"],
        requiredFlows: [],
        forbiddenPlaceholders: ["to be implemented", "not implemented", "implementation pending", "coming soon"]
      },
      generateResponse: async () => {
        modelCallCount++;
        return JSON.stringify({ done: true, final: "Model was called — unexpected." });
      }
    });

    assert.equal(modelCallCount, 0, "Model should not be called when planner handles all tasks");
    assert.equal(result.success, true);
    const readCalls = result.toolCalls.filter(c => c.tool === "READ_FILE" && c.success);
    assert.equal(readCalls.length, 2, "Both READ_FILE tasks should succeed");
    assert.ok(result.final.includes("2 succeeded"), "Final summary should mention success count");
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("runAgentLoop retries and salvages plain text as final response", async () => {
  const workspaceRoot = await createWorkspace();
  let callCount = 0;

  try {
    const result = await runAgentLoop({
      messages: [{ role: "user", content: "Inspect the repository." }],
      workspaceRoot,
      maxSteps: 1,
      generateResponse: async () => {
        callCount += 1;
        return callCount === 1 ? "not json" : "still not json";
      }
    });

    assert.equal(callCount, 2);
    assert.equal(result.success, true);
    assert.equal(result.final, "still not json");
    assert.ok(result.events.some(event => event.type === "json_parse_retry"));
    assert.ok(result.events.some(event => event.type === "completion"));
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("runAgentLoop stops WRITE content regeneration after the configured retry count", async () => {
  const workspaceRoot = await createWorkspace();
  const targetPath = "src/agent/planner/clarificationEngine.js";
  let callCount = 0;

  try {
    await fs.mkdir(path.join(workspaceRoot, "src", "agent", "planner"), { recursive: true });
    const result = await runAgentLoop({
      messages: [{
        role: "user",
        content: `Write file: ${targetPath} and implement analyzeClarification. Then run node --check ${targetPath}`
      }],
      workspaceRoot,
      maxSteps: 12,
      generateResponse: async () => {
        callCount += 1;
        return JSON.stringify({
          content: "export function analyzeClarification(prompt) { return { needsClarification: false }; }"
        });
      }
    });

    assert.equal(callCount, 3, "WRITE content generation must stop after 3 failed validations");
    assert.equal(result.success, true);
    assert.ok(result.changedFiles.includes(targetPath));
    const written = await fs.readFile(path.join(workspaceRoot, targetPath), "utf8");
    assert.match(written, /export function analyzeClarification/);
    assert.match(written, /export default analyzeClarification/);
    assert.ok(result.toolCalls.some(call => call.tool === "RUN_TERMINAL" && call.success));
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
