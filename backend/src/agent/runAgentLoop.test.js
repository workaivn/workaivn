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
    assert.match(result.error, /No persisted file changes/);
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

test("runAgentLoop returns an error instead of throwing after invalid JSON retry", async () => {
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
    assert.equal(result.success, false);
    assert.match(result.final, /after one retry/);
    assert.ok(result.events.some(event => event.type === "error"));
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
