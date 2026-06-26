import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildAcceptanceCriteria } from "./acceptanceCriteria.js";
import { evaluateQualityGate } from "./qualityGate.js";
import { runAgentLoop } from "./runAgentLoop.js";

const execFileAsync = promisify(execFile);

async function createWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workai-quality-"));
  await fs.writeFile(path.join(root, "package.json"), '{"scripts":{"test":"node --test"}}\n');
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "quality@test.local"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Quality Test"], { cwd: root });
  await execFileAsync("git", ["add", "package.json"], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
  return root;
}

test("product acceptance criteria require requested commerce flows", () => {
  const criteria = buildAcceptanceCriteria(
    "Tạo website bán hàng có giỏ hàng, thanh toán QR qua Sepay"
  );

  assert.equal(criteria.taskClass, "product_build");
  assert.equal(criteria.minimumMeaningfulFiles, 8);
  assert.deepEqual(criteria.requiredFlows, ["cart", "payment", "qr", "sepay"]);
});

test("quality gate rejects a website implemented only with index.html and app.js", async () => {
  const root = await createWorkspace();
  await fs.mkdir(path.join(root, "frontend"));
  await fs.writeFile(path.join(root, "frontend", "index.html"), "<main>Store</main>");
  await fs.writeFile(
    path.join(root, "frontend", "app.js"),
    "export const cart = []; export const payment = 'qr sepay'; // to be implemented"
  );

  try {
    const criteria = buildAcceptanceCriteria(
      "Tạo website bán hàng có giỏ hàng, thanh toán QR qua Sepay"
    );
    const gate = await evaluateQualityGate({
      acceptanceCriteria: criteria,
      changedFiles: ["frontend/index.html", "frontend/app.js"],
      workspaceRoot: root,
      finalText: "Completed cart payment QR Sepay.",
      toolCalls: [
        {
          tool: "READ_FILE",
          success: true,
          args: { path: "package.json" },
          result: { file: "package.json" }
        },
        {
          tool: "RUN_TERMINAL",
          success: true,
          args: { command: "npm test" },
          result: { exitCode: 0 }
        },
        {
          tool: "VALIDATE_PATCH",
          success: true,
          args: { file: "frontend/app.js" },
          result: { success: true }
        }
      ]
    });

    assert.equal(gate.passed, false);
    assert.ok(gate.failures.some(message => /index\.html and app\.js/.test(message)));
    assert.ok(gate.failures.some(message => /at least 8 meaningful files/.test(message)));
    assert.ok(gate.failures.some(message => /placeholder text remains/.test(message)));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("agent loop returns needs_revision when minimal product build never passes gate", async () => {
  const root = await createWorkspace();
  const responses = [
    { tool: "READ_FILE", args: { path: "package.json" }, done: false },
    {
      tool: "WRITE_FILE",
      args: { path: "frontend/index.html", content: "<main>Store</main>" },
      done: false
    },
    {
      tool: "WRITE_FILE",
      args: {
        path: "frontend/app.js",
        content: "export const cart = []; export const payment = 'qr sepay';"
      },
      done: false
    },
    { tool: "RUN_TERMINAL", args: { command: "node --check frontend/app.js" }, done: false },
    { done: true, final: "Cart payment QR Sepay completed." }
  ];

  try {
    const result = await runAgentLoop({
      messages: [{
        role: "user",
        content: "Tạo website bán hàng có giỏ hàng, thanh toán QR qua Sepay"
      }],
      workspaceRoot: root,
      maxSteps: responses.length,
      generateResponse: async () => JSON.stringify(responses.shift())
    });

    assert.equal(result.success, false);
    assert.equal(result.status, "needs_revision");
    assert.equal(result.qualityGate.passed, false);
    assert.deepEqual(result.changedFiles.sort(), [
      "frontend/app.js",
      "frontend/index.html"
    ]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("quality gate fails when required command was not executed", async () => {
  const gate = await evaluateQualityGate({
    acceptanceCriteria: {
      taskType: "ANALYSIS",
      taskMode: "read_only",
      objective: "Read package.json. Then run: npm test",
      requestedFiles: ["package.json"],
      requiredCommands: ["npm test"]
    },
    changedFiles: [],
    toolCalls: [
      {
        tool: "READ_FILE",
        success: true,
        args: { path: "package.json" },
        result: { file: "package.json", content: "{\"name\":\"demo\"}" }
      }
    ],
    finalText: "Read package.json and completed validation."
  });

  assert.equal(gate.passed, false);
  assert.ok(gate.failures.some(message => /Required commands not executed: npm test/i.test(message)));
});

test("quality gate reports failed required command separately from missing command", async () => {
  const gate = await evaluateQualityGate({
    acceptanceCriteria: {
      taskType: "ANALYSIS",
      taskMode: "read_only",
      objective: "Read package.json. Then run: npm test",
      requestedFiles: ["package.json"],
      requiredCommands: ["npm test"]
    },
    changedFiles: [],
    toolCalls: [
      {
        tool: "READ_FILE",
        success: true,
        args: { path: "package.json" },
        result: { file: "package.json", content: "{\"name\":\"demo\"}" }
      },
      {
        tool: "RUN_TERMINAL",
        success: false,
        args: { command: "npm test" },
        result: { command: "npm test", exitCode: 1, stdout: "", stderr: "failed" }
      }
    ],
    finalText: "Read package.json and npm test failed."
  });

  assert.equal(gate.passed, false);
  assert.ok(gate.failures.some(message => /Required commands failed: npm test/i.test(message)));
  assert.ok(!gate.failures.some(message => /Required commands not executed: npm test/i.test(message)));
});

test("quality gate allows read-only validation without changed files when command ran", async () => {
  const gate = await evaluateQualityGate({
    acceptanceCriteria: {
      taskType: "ANALYSIS",
      taskMode: "read_only",
      objective: "Read package.json. Then run: npm test",
      requestedFiles: ["package.json"],
      requiredCommands: ["npm test"]
    },
    changedFiles: [],
    toolCalls: [
      {
        tool: "READ_FILE",
        success: true,
        args: { path: "package.json" },
        result: { file: "package.json", content: "{\"name\":\"demo\"}" }
      },
      {
        tool: "RUN_TERMINAL",
        success: true,
        args: { command: "npm test" },
        result: { command: "npm test", exitCode: 0, stdout: "ok", stderr: "" }
      }
    ],
    finalText: "Read package.json and npm test passed."
  });

  assert.equal(gate.passed, true);
});
