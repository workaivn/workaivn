import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runAgentLoop } from '../runAgentLoop.js';

const execFileAsync = promisify(execFile);

async function createGitWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workai-dbg-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'dbg', version: '1.0.0', type: 'module', scripts: { test: 'node --test src/math.test.js' } }, null, 2),
    'utf8'
  );
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'a@b.c'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'A B'], { cwd: root });
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: root });
  return root;
}

test('debug: trace write validation markers', async () => {
  const root = await createGitWorkspace();
  const logs = [];
  const orig = console.log;
  console.log = (...args) => {
    const line = args.map(v => {
      if (typeof v === 'string') return v;
      try { return JSON.stringify(v); } catch { return String(v); }
    }).join(' ');
    logs.push(line);
  };
  try {
    await runAgentLoop({
      messages: [{ role: 'user', content: 'Create src/math.js and src/math.test.js. Implement add. Use the detected test framework. Run validation.' }],
      workspaceRoot: root,
      maxSteps: 12,
      generateResponse: async ({ messages }) => {
        const t = messages.map(m => String(m?.content || '')).join('\n');
        if (t.includes('WRITE COORDINATOR MODE.')) {
          return JSON.stringify({ files: [
            { path: 'src/math.js', content: 'export function add(a, b) { return a + b; }' },
            { path: 'src/math.test.js', content: ['import test from "node:test";','import assert from "node:assert/strict";','import { add } from "./math.js";','','test("m", () => { assert.equal(add(1,2),3); });'].join('\n') }
          ]});
        }
        return JSON.stringify({ done: true, final: 'finished' });
      }
    });
  } finally {
    console.log = orig;
  }
  const markers = ['WRITE_COORDINATOR_PROMPT_BUILT','WRITE_COORDINATOR_MODEL_RESULT','WRITE_COORDINATOR_DISPATCH','WRITE_VALIDATION_POLICY','WRITE_VALIDATION_POLICY_REUSED','FRAMEWORK_DETECTED','FRAMEWORK_GENERATION_HINTS','FRAMEWORK_RULES','FRAMEWORK_CONTRACT_CHECK_PASS','PLANNER_DETERMINISTIC_DISPATCH','PLANNER_DISPATCH','EXECUTOR_ENTRY','WRITE_FILE_MODULE_SYSTEM_NORMALIZED','WRITE_COORDINATOR_FALLBACK','WRITE_CONTENT_FAILED','WRITE_GROUP_COMPLETED','WRITE_CONTENT_GENERATED','WRITE_CONTENT_VALIDATED','WRITE_FILE"','NORMALIZE_MODULE_CALL'];
  for (const m of markers) {
    const c = logs.filter(l => l.includes(m)).length;
    process.stderr.write(`${m}: ${c}\n`);
  }
  // print first 3 WRITE_VALIDATION_POLICY lines
  const wvp = logs.filter(l => l.includes('[WRITE_VALIDATION_POLICY]'));
  for (const l of wvp) process.stderr.write('WVP: ' + l.slice(0, 200) + '\n');
  const reused = logs.filter(l => l.includes('WRITE_VALIDATION_POLICY_REUSED')).slice(0, 3);
  for (const l of reused) process.stderr.write('REUSED: ' + l.slice(0, 300) + '\n');
  await fs.rm(root, { recursive: true, force: true });
});
