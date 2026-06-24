#!/usr/bin/env node
import { evaluateQualityGate } from "../agent/qualityGate.js";

function makeReadCall(path) {
  return { tool: "READ_FILE", success: true, args: { path }, result: { file: path } };
}
function makeWriteCall(path, ok = true) {
  return { tool: "WRITE_FILE", success: ok, args: { path }, result: { file: path }, changed: ok };
}
function makeValidatePatch(path, ok = true) {
  return { tool: "VALIDATE_PATCH", success: ok, args: { file: path }, result: { file: path } };
}
function makeTerminal(cmd, ok = true) {
  return { tool: "RUN_TERMINAL", success: ok, args: { command: cmd }, result: { stdout: ok ? "OK" : "ERR", stderr: ok ? "" : "ERR", exitCode: ok ? 0 : 1 } };
}

async function runTests() {
  const tests = [];

  // 1) QA task
  tests.push({
    name: "QA 2+2",
    input: {
      acceptanceCriteria: { taskMode: "qa", requestedFiles: [], objective: "What is 2 + 2? Reply only with the number." },
      changedFiles: [],
      toolCalls: [],
      workspaceRoot: "",
      finalText: "4"
    },
    expectPass: true
  });

  // 2) Read-only pass
  tests.push({
    name: "Read package.json name",
    input: {
      acceptanceCriteria: { taskMode: "read_only", requestedFiles: ["package.json"], objective: "Read package.json. Show package name. Do not modify files." },
      changedFiles: [],
      toolCalls: [makeReadCall("package.json")],
      workspaceRoot: ".",
      finalText: "name: app"
    },
    expectPass: true
  });

  // 3) Read-only fail when missing requested file
  tests.push({
    name: "Missing requested file",
    input: {
      acceptanceCriteria: { taskMode: "read_only", requestedFiles: ["package.json"], objective: "Read package.json. Show package name. Do not modify files." },
      changedFiles: [],
      toolCalls: [],
      workspaceRoot: ".",
      finalText: "name: app"
    },
    expectPass: false
  });

  // 4) Coding fail without terminal
  tests.push({
    name: "Coding changed no terminal",
    input: {
      acceptanceCriteria: { taskMode: "coding", objective: "Open package.json. Add script." },
      changedFiles: ["package.json"],
      toolCalls: [makeWriteCall("package.json", true), makeValidatePatch("package.json", true)],
      workspaceRoot: ".",
      finalText: "done"
    },
    expectPass: false
  });

  // 5) Coding pass with terminal
  tests.push({
    name: "Coding changed with terminal",
    input: {
      acceptanceCriteria: { taskMode: "coding", objective: "Add and run agent:test" },
      changedFiles: ["package.json"],
      toolCalls: [makeWriteCall("package.json", true), makeValidatePatch("package.json", true), makeTerminal("npm run agent:test", true)],
      workspaceRoot: ".",
      finalText: "agent ok"
    },
    expectPass: true
  });

  let failures = 0;
  for (const t of tests) {
    const out = await evaluateQualityGate(t.input);
    const ok = !!out.passed === !!t.expectPass;
    console.log(`TEST ${ok ? "OK" : "FAIL"} – ${t.name} – Score ${out.score}`);
    if (!ok) {
      console.log("Failures:", out.failures);
      failures += 1;
    }
  }
  process.exitCode = failures ? 1 : 0;
}

runTests().catch(err => { console.error(err); process.exit(1); });
