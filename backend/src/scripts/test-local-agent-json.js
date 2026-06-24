#!/usr/bin/env node
import process from 'process';
import util from 'util';
import { providerRegistry } from '../services/adapters/index.js';

// Minimal JSON helpers copied from agent
function extractFirstJsonObject(text) {
  const source = String(text ?? "");
  let start = -1, depth = 0, inString = false, escaped = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (start === -1) { if (ch === '{') { start = i; depth = 1; } continue; }
    if (inString) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') inString = false; continue; }
    if (ch === '"') inString = true; else if (ch === '{') depth += 1; else if (ch === '}') { depth -= 1; if (depth === 0) return source.slice(start, i + 1); }
  }
  return null;
}

function stripFences(text) {
  let t = String(text || "");
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  return t;
}

function normalizeToolPayload(obj) {
  const tool = String(obj?.tool || '').toUpperCase();
  const args = typeof obj?.args === 'object' && obj.args ? { ...obj.args } : {};
  if (tool === 'APPLY_PATCH') { args.file ??= obj.file; args.find ??= obj.find; args.replace ??= obj.replace; }
  else if (tool === 'READ_FILE') { args.path ??= obj.path; }
  else if (tool === 'WRITE_FILE') { args.path ??= obj.path; args.content ??= obj.content; }
  else if (tool === 'RUN_TERMINAL') { args.command ??= obj.command; }
  return { tool, args, done: !!obj.done, final: obj.final };
}

function debugJsonParseError(raw, error) {
  const out = [];
  const msg = error?.message || String(error || 'Unknown parse error');
  out.push(`JSON parse error: ${msg}`);
  const m = /position\s(\d+)/i.exec(msg) || /at\sposition\s(\d+)/i.exec(msg);
  const pos = m ? Number(m[1]) : null;
  if (pos !== null && !Number.isNaN(pos)) {
    const start = Math.max(0, pos - 80);
    const end = Math.min(raw.length, pos + 80);
    const nearby = raw.slice(start, end);
    out.push(`at position ${pos}`);
    // approximate line/col
    const before = raw.slice(0, pos);
    const line = before.split(/\n/).length;
    const col = pos - before.lastIndexOf('\n');
    out.push(`line ${line} column ${col}`);
    out.push(nearby);
    out.push(' '.repeat(Math.max(0, Math.min(80, pos - start))) + '^');
  }
  return out.join('\n');
}

async function callProvider(providerCode, modelName, prompt) {
  const adapter = providerRegistry.getAdapter(providerCode);
  if (!adapter) throw new Error(`Provider not found: ${providerCode}`);
  const ok = await adapter.isConfigured();
  if (!ok) throw new Error(adapter.getConfigError() || 'Provider not configured');
  const res = await adapter.run({ modelName, messages: [{ role: 'user', content: prompt }], temperature: 0, maxTokens: 256, modelCallTimeout: Number(process.env.WORKAI_MODEL_CALL_TIMEOUT_MS || 90000) });
  return res;
}

async function testCase(provider, model, name, prompt, validate) {
  console.log(`\n=== ${name} ===`);
  console.log('Prompt:', prompt);
  const resp = await callProvider(provider, model, prompt);
  const raw = String(resp.output || resp.content || resp.text || resp.outputText || '');
  console.log('Raw:', raw);
  let obj = null; let repaired = null;
  try {
    obj = JSON.parse(stripFences(raw));
  } catch (e1) {
    const first = extractFirstJsonObject(raw);
    if (first) {
      try { obj = JSON.parse(first); } catch (e2) { console.log(debugJsonParseError(first, e2)); }
    } else {
      console.log(debugJsonParseError(raw, e1));
    }
  }
  if (!obj || typeof obj !== 'object') {
    console.log('INVALID_JSON');
    return false;
  }
  const norm = normalizeToolPayload(obj);
  console.log('Parsed:', util.inspect(norm, { depth: null }));
  const ok = await validate(norm);
  console.log('Result:', ok ? 'OK' : 'FAILED');
  return ok;
}

async function main() {
  const provider = process.env.TEST_PROVIDER || process.env.PROVIDER_CODE || 'llamacpp';
  const model = process.env.TEST_MODEL || process.env.MODEL_NAME || 'qwen2.5-coder';
  const cases = [
    {
      name: 'READ_FILE format',
      prompt: 'Return JSON only:\n{"tool":"READ_FILE","args":{"path":"package.json"},"done":false}',
      validate: (o) => o.tool === 'READ_FILE' && !!o.args?.path
    },
    {
      name: 'APPLY_PATCH args format',
      prompt: 'Return JSON only:\n{"tool":"APPLY_PATCH","args":{"file":"package.json","find":"TEMP","replace":"TEMP2"},"done":false}',
      validate: (o) => o.tool === 'APPLY_PATCH' && !!o.args?.file && !!o.args?.find && !!o.args?.replace
    },
    {
      name: 'APPLY_PATCH flat format',
      prompt: 'Return JSON only:\n{"tool":"APPLY_PATCH","file":"package.json","find":"TEMP","replace":"TEMP2","done":false}',
      validate: (o) => o.tool === 'APPLY_PATCH' && !!o.args?.file && !!o.args?.find && !!o.args?.replace
    },
    {
      name: 'RUN_TERMINAL format',
      prompt: 'Return JSON only:\n{"tool":"RUN_TERMINAL","args":{"command":"npm test"},"done":false}',
      validate: (o) => o.tool === 'RUN_TERMINAL' && !!o.args?.command
    },
    {
      name: 'FINAL format',
      prompt: 'Return JSON only:\n{"done":true,"final":"OK"}',
      validate: (o) => o.done === true && typeof o.final === 'string'
    }
  ];

  let pass = 0;
  for (const c of cases) {
    try {
      const ok = await testCase(provider, model, c.name, c.prompt, c.validate);
      if (ok) pass += 1;
    } catch (e) {
      console.log('ERROR:', e.message);
    }
  }
  console.log(`\nSummary: ${pass}/${cases.length} passed.`);

  // REAL_AGENT_STYLE_TESTS
  console.log('\n=== REAL_AGENT_STYLE_TESTS ===');
  const fs = await import('fs/promises');
  const path = await import('path');
  async function readWorkspacePackageJson() {
    const ws = process.env.WORKSPACE_ROOT || process.cwd();
    const candidates = [path.join(ws, 'package.json'), path.join(process.cwd(), 'package.json')];
    for (const p of candidates) {
      try { const s = await fs.readFile(p, 'utf8'); return { file: p, content: s }; } catch {}
    }
    return { file: 'package.json', content: '{}' };
  }
  const pkg = await readWorkspacePackageJson();
  const toolsSchema = `AVAILABLE TOOLS:\n- READ_FILE { "args": { "path": "relative/path" }, "done": false }\n- APPLY_PATCH { "args": { "file": "path", "find": "text", "replace": "text" }, "done": false }\n- WRITE_FILE { "args": { "path": "path", "content": "text" }, "done": false }\n- RUN_TERMINAL { "args": { "command": "npm test" }, "done": false }\nReturn a single JSON object only.`;
  const renamePrompt = `You are the WorkAI VN Coding Agent. ${toolsSchema}\n\nObservation: READ_FILE package.json succeeded.\nContent of package.json:\n${pkg.content.slice(0, 12000)}\n\nRequirement:\nRename script temp:test to temp:test2. Then run: npm run temp:test2. Return JSON only.`;
  await testCase(provider, model, 'Rename script real-agent-style', renamePrompt, (o) => {
    // Accept APPLY_PATCH with required args or RUN_TERMINAL for npm run temp:test2 (although patch should come first)
    if (o.tool === 'APPLY_PATCH') return !!o.args?.file && !!o.args?.find && !!o.args?.replace;
    if (o.tool === 'RUN_TERMINAL') return /npm\s+run\s+temp:test2/i.test(o.args?.command || '');
    return false;
  });

  // Local single-action style prompt
  const singleActionInst = `You are a coding tool caller. Return exactly ONE JSON object. No markdown. No explanation. No wrapper. No array. Choose only one next action. Allowed shapes:\nREAD_FILE {"tool":"READ_FILE","args":{"path":"..."},"done":false}\nAPPLY_PATCH {"tool":"APPLY_PATCH","args":{"file":"...","find":"...","replace":"..."},"done":false}\nWRITE_FILE {"tool":"WRITE_FILE","args":{"path":"...","content":"..."},"done":false}\nRUN_TERMINAL {"tool":"RUN_TERMINAL","args":{"command":"..."},"done":false}\nFINAL {"done":true,"final":"..."}`;
  const localSingleActionPrompt = `${singleActionInst}\n\nObservation: READ_FILE package.json succeeded.\nContent of package.json:\n${pkg.content.slice(0, 12000)}\n\nNext action only: modify package.json to rename temp:test to temp:test2. Do not run terminal yet. Return JSON only.`;
  await testCase(provider, model, 'Rename script local single-action', localSingleActionPrompt, (o) => {
    return o.tool === 'APPLY_PATCH' && !!o.args?.file && !!o.args?.find && !!o.args?.replace;
  });

  // Known fragile response repair test
  const fragile = '{"tool":"APPLY_PATCH","file":"package.json","find":"\\"temp:test\\": \\\"echo ok\\\"","replace":"\\"temp:test2\\": \\\"echo ok\\\"","reasoning":"Renaming \'temp:test\' to \'temp:test2\' in the package.json file.","done":false}';
  console.log('\n=== Fragile response repair test ===');
  try {
    const obj = JSON.parse(stripFences(fragile));
    const norm = normalizeToolPayload(obj);
    console.log('Parsed:', util.inspect(norm, { depth: null }));
    const ok = norm.tool === 'APPLY_PATCH' && !!norm.args?.file && !!norm.args?.find && !!norm.args?.replace && norm.done === false;
    console.log('Result:', ok ? 'OK' : 'FAILED');
  } catch (e) {
    const first = extractFirstJsonObject(fragile) || fragile;
    try {
      const obj = JSON.parse(first);
      const norm = normalizeToolPayload(obj);
      console.log('Parsed:', util.inspect(norm, { depth: null }));
      const ok = norm.tool === 'APPLY_PATCH' && !!norm.args?.file && !!norm.args?.find && !!norm.args?.replace && norm.done === false;
      console.log('Result:', ok ? 'OK' : 'FAILED');
    } catch (e2) {
      console.log(debugJsonParseError(first, e2));
    }
  }
}

main().catch(err => { console.error(err.stack || err.message); process.exit(1); });
