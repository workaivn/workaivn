#!/usr/bin/env node
// Simple validation runner for WorkAIVN Agent acceptance
// Usage:
//   node src/scripts/workai-acceptance.js --api http://localhost:4000 --workspace <id> --agent <id>
// or set env: WORKAI_API_BASE, WORKSPACE_ID, AGENT_ID

import axios from "axios";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === "--api") args.api = argv[++i];
    else if (k === "--workspace") args.workspace = argv[++i];
    else if (k === "--agent") args.agent = argv[++i];
  }
  return args;
}

const cli = parseArgs(process.argv);
const API = process.env.WORKAI_API_BASE || cli.api || "";
const WORKSPACE_ID = process.env.WORKSPACE_ID || cli.workspace || "";
const AGENT_ID = process.env.AGENT_ID || cli.agent || "";

if (!API || !WORKSPACE_ID || !AGENT_ID) {
  console.log("WorkAIVN acceptance validator\n\nProvide --api, --workspace, --agent to run live checks.\nEnvironment variables: WORKAI_API_BASE, WORKSPACE_ID, AGENT_ID\n\nCovered prompts:\n1) What is 2 + 2? Reply only with the number.\n2) Read package.json. Show package name. Do not modify files.\n3) Read qualityGate.js. Find one logic bug. Explain the bug. Do not modify files.\n4) Open package.json. Add script agent:test. Then run npm run agent:test.\n");
  process.exit(0);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runPrompt(prompt) {
  const res = await axios.post(`${API}/api/agents/run`, {
    workspaceId: WORKSPACE_ID,
    agentId: AGENT_ID,
    prompt
  });
  const runId = res.data?.data?.runId;
  if (!runId) throw new Error("No runId returned");
  for (let i = 0; i < 120; i += 1) {
    const r = await axios.get(`${API}/api/ai/agent-runs/${runId}`);
    const data = r.data?.data;
    if (["completed", "error", "needs_revision", "cancelled"].includes(data.status)) {
      return data;
    }
    await sleep(1000);
  }
  throw new Error("Timeout waiting for run completion");
}

function summarize(run) {
  const toolCalls = run.toolCalls || [];
  const filesRead = [...new Set(
    toolCalls.filter(c => c.tool === "READ_FILE" && c.success !== false)
      .map(c => c.args?.path || c.result?.file)
      .filter(Boolean)
  )];
  const terminals = toolCalls.filter(c => c.tool === "RUN_TERMINAL");
  return { filesRead, changedFiles: run.changedFiles || [], terminals, final: run.outputText || "" };
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function main() {
  const tests = [
    {
      name: "QA 2+2",
      prompt: "What is 2 + 2? Reply only with the number.",
      check: run => {
        const s = summarize(run);
        assert((s.final || "").trim() === "4", `Expected final '4', got '${s.final}'`);
      }
    },
    {
      name: "Read package.json name",
      prompt: "Read package.json. Show package name. Do not modify files.",
      check: run => {
        const s = summarize(run);
        assert(s.filesRead.some(f => /package\.json$/i.test(f)), "package.json not read");
        assert((s.changedFiles || []).length === 0, "No files should be changed");
        assert(s.terminals.length === 0, "No terminal commands expected");
        assert((s.final || "").trim().length > 0, "Final text required");
      }
    },
    {
      name: "Read qualityGate.js analysis",
      prompt: "Read backend/src/agent/qualityGate.js. Find one logic bug. Explain the bug. Do not modify files.",
      check: run => {
        const s = summarize(run);
        assert(s.filesRead.some(f => /qualityGate\.js$/i.test(f)), "qualityGate.js not read");
        assert((s.changedFiles || []).length === 0, "No files should be changed");
        assert((s.final || "").trim().length > 0, "Final text required");
      }
    },
    {
      name: "Coding add agent:test",
      prompt: "Open package.json. Add script agent:test with value: node -e \"console.log('agent ok')\". Then run npm run agent:test.",
      check: run => {
        const s = summarize(run);
        assert((s.changedFiles || []).length > 0, "Expected changed files");
        assert(s.terminals.some(c => /agent:test/.test(c.args?.command) && c.success), "Expected successful npm run agent:test");
      }
    }
  ];

  for (const t of tests) {
    process.stdout.write(`\n[RUN] ${t.name}... `);
    const run = await runPrompt(t.prompt);
    try {
      t.check(run);
      console.log("OK");
    } catch (e) {
      console.log("FAIL");
      console.error(e.message);
      process.exitCode = 1;
      break;
    }
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
