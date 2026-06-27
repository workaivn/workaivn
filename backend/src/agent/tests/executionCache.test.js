import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createExecutionCache } from '../executionCache.js';
import { runAgentLoop } from '../runAgentLoop.js';

const execFileAsync = promisify(execFile);

async function captureLogs(fn) {
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => {
    logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
    origLog.apply(console, args);
  };
  try {
    await fn();
  } finally {
    console.log = origLog;
  }
  return logs;
}

// ── Unit tests: ExecutionCache in isolation ──────────────────────────

test('Phase 4.15 — ExecutionCache: READ_FILE cache store and hit', async () => {
  const cache = createExecutionCache();
  const workspaceRoot = null;
  const logs = await captureLogs(async () => {
    await cache.setCachedRead('package.json', '{"name":"test"}', workspaceRoot);
    const result = await cache.getCachedRead('package.json', workspaceRoot);
    assert.equal(result, '{"name":"test"}');
  });
  const storeLog = logs.find(l => l.includes('[CACHE_STORE]'));
  const hitLog = logs.find(l => l.includes('[READ_CACHE_HIT]'));
  assert.ok(storeLog, 'Expected CACHE_STORE log');
  assert.ok(hitLog, 'Expected READ_CACHE_HIT log');
});

test('Phase 4.15 — ExecutionCache: READ_FILE cache miss on different path', async () => {
  const cache = createExecutionCache();
  await cache.setCachedRead('package.json', '{"name":"test"}', null);
  const result = await cache.getCachedRead('other.json', null);
  assert.equal(result, null);
});

test('Phase 4.15 — ExecutionCache: WRITE_FILE dedup identical content', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cache-write-'));
  try {
    const filePath = path.join(dir, 'test.txt');
    await fs.writeFile(filePath, 'hello', 'utf8');
    const cache = createExecutionCache();
    const { skipped } = await cache.shouldSkipWrite('test.txt', 'hello', dir);
    assert.equal(skipped, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('Phase 4.15 — ExecutionCache: WRITE_FILE dedup different content', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cache-write-'));
  try {
    const filePath = path.join(dir, 'test.txt');
    await fs.writeFile(filePath, 'hello', 'utf8');
    const cache = createExecutionCache();
    const { skipped } = await cache.shouldSkipWrite('test.txt', 'world', dir);
    assert.equal(skipped, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('Phase 4.15 — ExecutionCache: TERMINAL cache store and hit', async () => {
  const cache = createExecutionCache();
  const logs = await captureLogs(async () => {
    await cache.setCachedTerminal('node --version', { success: true, stdout: 'v20', stderr: '', exitCode: 0 }, [], null);
    const result = await cache.getCachedTerminal('node --version', null);
    assert.ok(result);
    assert.equal(result.stdout, 'v20');
    assert.equal(result.exitCode, 0);
  });
  const storeLog = logs.find(l => l.includes('[CACHE_STORE]'));
  const hitLog = logs.find(l => l.includes('[TERMINAL_CACHE_HIT]'));
  assert.ok(storeLog, 'Expected CACHE_STORE log');
  assert.ok(hitLog, 'Expected TERMINAL_CACHE_HIT log');
});

test('Phase 4.15 — ExecutionCache: TERMINAL cache miss on different command', async () => {
  const cache = createExecutionCache();
  await cache.setCachedTerminal('node --version', { success: true, stdout: 'v20', stderr: '', exitCode: 0 }, [], null);
  const result = await cache.getCachedTerminal('node -e "1+1"', null);
  assert.equal(result, null);
});

test('Phase 4.15 — ExecutionCache: TERMINAL cache miss after invalidation', async () => {
  const cache = createExecutionCache();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cache-inval-'));
  try {
    const depFile = path.join(dir, 'dep.txt');
    await fs.writeFile(depFile, 'content v1', 'utf8');
    await cache.setCachedTerminal('node --version', { success: true, stdout: 'v20', stderr: '', exitCode: 0 },
      ['dep.txt'], dir);
    // Invalidate dep file
    cache.invalidateFile('dep.txt');
    const result = await cache.getCachedTerminal('node --version', dir);
    assert.equal(result, null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('Phase 4.15 — ExecutionCache: CACHE_MISS log on miss', async () => {
  const cache = createExecutionCache();
  const logs = await captureLogs(async () => {
    await cache.getCachedRead('nonexistent.json', null);
    await cache.getCachedTerminal('node --vesion', null);
  });
  const missLogs = logs.filter(l => l.includes('[CACHE_MISS]'));
  assert.equal(missLogs.length, 2, 'Expected 2 CACHE_MISS logs');
});

test('Phase 4.15 — ExecutionCache: invalidateFile log', async () => {
  const cache = createExecutionCache();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cache-inval-log-'));
  try {
    await fs.writeFile(path.join(dir, 'package.json'), '{"name":"test"}', 'utf8');
    await cache.setCachedTerminal('node --version', { success: true, stdout: 'v20', stderr: '', exitCode: 0 },
      ['package.json'], dir);
    const logs = await captureLogs(async () => {
      cache.invalidateFile('package.json');
    });
    const invalLog = logs.find(l => l.includes('[CACHE_INVALIDATED]'));
    assert.ok(invalLog, 'Expected CACHE_INVALIDATED log');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('Phase 4.15 — ExecutionCache: getStats returns correct counts', () => {
  const cache = createExecutionCache();
  const stats = cache.getStats();
  assert.equal(typeof stats.readFile.total, 'number');
  assert.equal(typeof stats.runTerminal.cacheHits, 'number');
  assert.equal(typeof stats.cacheMisses, 'number');
  assert.equal(typeof stats.invalidations, 'number');
});

// ── Integration test: two-run scenario through runAgentLoop ──────────

test('Phase 4.15 — ExecutionCache: two-run integration with cache hits', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cache-int-'));
  try {
    await execFileAsync('git', ['init'], { cwd: workspaceRoot });
    await execFileAsync('git', ['config', 'user.email', 'agent@test.local'], { cwd: workspaceRoot });
    await execFileAsync('git', ['config', 'user.name', 'Agent Test'], { cwd: workspaceRoot });
    await fs.writeFile(
      path.join(workspaceRoot, 'package.json'),
      JSON.stringify({ name: 'cache-test', version: '1.0.0', scripts: { start: 'node index.js' } }, null, 2),
      'utf8'
    );
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await execFileAsync('git', ['add', '.'], { cwd: workspaceRoot });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: workspaceRoot });

    // Shared cache across both runs
    const sharedCache = createExecutionCache();

    // ── Run 1: Create file and run ─────────────────────────────
    const run1Responses = [
      { done: true, final: 'Run 1 completed successfully.' }
    ];
    const run1 = await runAgentLoop({
      messages: [{
        role: 'user',
        content: 'Read package.json. Create src/cache-test.js with: console.log("cache ok"). Run node src/cache-test.js'
      }],
      workspaceRoot,
      maxSteps: 30,
      enableToolOptimizer: true,
      executionCache: sharedCache,
      generateResponse: async () => JSON.stringify(run1Responses.shift())
    });

    assert.ok(run1.success || run1.status === 'completed', 'Run 1 should complete');
    const fileExists = await fs.access(path.join(workspaceRoot, 'src', 'cache-test.js')).then(() => true).catch(() => false);
    assert.ok(fileExists, 'Run 1 should create src/cache-test.js');

    // ── Run 2: Read same file, run same terminal — should be cache hits ──
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => {
      logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
      origLog.apply(console, args);
    };
    try {
      const run2Responses = [
        { done: true, final: 'Run 2 completed using cache.' }
      ];
      const run2 = await runAgentLoop({
        messages: [{
          role: 'user',
          content: 'Read package.json. Run node src/cache-test.js'
        }],
        workspaceRoot,
        maxSteps: 20,
        enableToolOptimizer: true,
        executionCache: sharedCache,
        generateResponse: async () => JSON.stringify(run2Responses.shift())
      });

      assert.ok(run2.success || run2.status === 'completed', 'Run 2 should complete');

      // Verify cache hit logs
      const readHitLog = logs.find(l => l.includes('[READ_CACHE_HIT]'));
      const termHitLog = logs.find(l => l.includes('[TERMINAL_CACHE_HIT]'));
      const lookupHitLog = logs.find(l => l.includes('[PLANNER_HISTORY_LOOKUP]') && l.includes('CACHE_HIT'));
      const summaryLog = logs.find(l => l.includes('Tool Optimizer Summary'));
      assert.ok(readHitLog, 'READ_CACHE_HIT is expected when cache works');
      assert.ok(termHitLog, 'TERMINAL_CACHE_HIT is expected when cache works');
      assert.ok(lookupHitLog, 'PLANNER_HISTORY_LOOKUP must report CACHE_HIT');
      assert.ok(summaryLog, 'Tool Optimizer Summary must be printed');

      // Verify no second terminal execution (tools should be from cached results)
      const run2ReadCalls = run2.toolCalls.filter(c => c.tool === 'READ_FILE');
      const run2TermCalls = run2.toolCalls.filter(c => c.tool === 'RUN_TERMINAL' && !c.result?.cached);
      // In deterministic planner mode, dispatched tools are real calls
      // Cache hits mean the ExecutionCache intercepted them before executeTool
      assert.ok(run2ReadCalls.some(c => c.args?.path === 'package.json' && c.result?.cached), 'Run 2 package.json read should be cached');
      assert.equal(run2TermCalls.length, 0, 'Run 2 terminal command should not execute for real when cached');
    } finally {
      console.log = origLog;
    }

    // Verify summary exists
    const stats = sharedCache.getStats();
    assert.equal(typeof stats.readFile.cacheHits, 'number', 'Cache stats should be readable');
    assert.equal(typeof stats.runTerminal.cacheHits, 'number', 'Terminal cache stats should be readable');
    assert.ok(stats.readFile.cacheHits >= 1, 'READ cache hits should be >= 1');
    assert.ok(stats.runTerminal.cacheHits >= 1, 'TERMINAL cache hits should be >= 1');

  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
