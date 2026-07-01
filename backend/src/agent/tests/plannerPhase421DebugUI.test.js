import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { runAgentLoop } from '../runAgentLoop.js';

// Helper: break the extractChatText dead code path by providing `final` with `done: true`
function respond(tool, args, opts = {}) {
  return JSON.stringify({ tool, args, done: true, final: opts.final || 'Task completed.' });
}

// ========== Test 1: plannerDebugSnapshot exists and has correct structure for a planner run ==========
test('Phase 4.21 Test 1: plannerDebugSnapshot has correct structure when planner is active', async () => {
  let modelCalls = 0;

  const result = await runAgentLoop({
    messages: [{ role: 'user', content: 'WRITE_FILE test.txt with content "hello"' }],
    maxSteps: 6,
    generateResponse: async () => {
      modelCalls += 1;
      return respond('WRITE_FILE', { path: 'test.txt', content: 'hello' }, { final: 'Written test.txt' });
    }
  });

  const snap = result.plannerDebugSnapshot;
  assert.ok(snap !== null && snap !== undefined, 'plannerDebugSnapshot must exist when planner is active');

  // Top-level fields
  assert.equal(typeof snap.state, 'string', 'snapshot.state must be a string');
  assert.equal(typeof snap.plannerState, 'string', 'snapshot.plannerState must be a string');
  assert.equal(typeof snap.parallelMode, 'boolean', 'snapshot.parallelMode must be boolean');
  assert.ok(snap.dag && typeof snap.dag === 'object', 'snapshot.dag must be an object');
  assert.ok(Array.isArray(snap.dag.nodes), 'snapshot.dag.nodes must be an array');
  assert.ok(Array.isArray(snap.dag.edges), 'snapshot.dag.edges must be an array');
  assert.ok(snap.dependencyGraph && typeof snap.dependencyGraph === 'object', 'snapshot.dependencyGraph must be an object');
  assert.ok(Array.isArray(snap.dependencyGraph.edges), 'snapshot.dependencyGraph.edges must be an array');
  assert.ok(snap.runFileMetadata == null || typeof snap.runFileMetadata === 'object',
    'snapshot.runFileMetadata must be an object or null');
  assert.ok(snap.completionResult == null || typeof snap.completionResult === 'object',
    'snapshot.completionResult must be an object or null');

  // Tasks array
  assert.ok(Array.isArray(snap.tasks), 'snapshot.tasks must be an array');
  assert.ok(snap.tasks.length >= 1, `Expected at least 1 task, got ${snap.tasks.length}`);

  // Each task must have required fields
  for (const t of snap.tasks) {
    assert.equal(typeof t.id, 'string', 'task.id must be a string');
    assert.equal(typeof t.kind, 'string', 'task.kind must be a string');
    assert.equal(typeof t.status, 'string', 'task.status must be a string');
    assert.ok(Array.isArray(t.dependencies), 'task.dependencies must be an array');
    assert.ok(Array.isArray(t.parents), 'task.parents must be an array');
    assert.ok(Array.isArray(t.children), 'task.children must be an array');
    assert.equal(typeof t.retryCount, 'number', 'task.retryCount must be a number');
    assert.equal(typeof t.attempts, 'number', 'task.attempts must be a number');
    assert.equal(typeof t.stallCount, 'number', 'task.stallCount must be a number');
  }

  // Find WRITE_FILE tasks
  const writeTasks = snap.tasks.filter(t => t.tool === 'WRITE_FILE');
  assert.ok(writeTasks.length >= 1, `Expected at least 1 WRITE_FILE task, got ${writeTasks.length}`);

  // parallelGroups must be an array
  assert.ok(Array.isArray(snap.parallelGroups), 'snapshot.parallelGroups must be an array');

  // executionMemory structure
  assert.ok(snap.executionMemory !== null && typeof snap.executionMemory === 'object',
    'snapshot.executionMemory must be an object');
  assert.ok(Array.isArray(snap.executionMemory.entries),
    'snapshot.executionMemory.entries must be an array');
  assert.ok(snap.executionMemory.stats !== null && typeof snap.executionMemory.stats === 'object',
    'snapshot.executionMemory.stats must be an object');

  // Stats must have the expected keys
  const stats = snap.executionMemory.stats;
  const expectedStats = ['tasksRemembered', 'memoryLookups', 'memoryHits', 'reasoningReused',
    'retriesAvoided', 'skippedDuplicateExecutions', 'reasoningEntries'];
  for (const key of expectedStats) {
    assert.ok(key in stats, `executionMemory.stats must have key "${key}"`);
    assert.equal(typeof stats[key], 'number', `executionMemory.stats.${key} must be a number`);
  }

  // costSummary (may be null for very simple plans)
  if (snap.costSummary !== null) {
    assert.equal(typeof snap.costSummary.totalScore, 'number', 'costSummary.totalScore must be number');
    assert.equal(typeof snap.costSummary.taskCount, 'number', 'costSummary.taskCount must be number');
  }

  // memorySummary (may be null)
  if (snap.memorySummary !== null) {
    assert.equal(typeof snap.memorySummary, 'object', 'memorySummary must be an object');
  }
});

// ========== Test 2: Existing return fields are present alongside plannerDebugSnapshot ==========
test('Phase 4.21 Test 2: existing return fields unchanged with plannerDebugSnapshot added', async () => {
  let modelCalls = 0;

  const result = await runAgentLoop({
    messages: [{ role: 'user', content: 'WRITE_FILE test2.txt with content "abc"' }],
    maxSteps: 6,
    generateResponse: async () => {
      modelCalls += 1;
      return respond('WRITE_FILE', { path: 'test2.txt', content: 'abc' }, { final: 'Written test2.txt' });
    }
  });

  // Assert all expected existing fields are present (fields common to ALL return paths)
  assert.ok('success' in result);
  assert.ok('status' in result);
  assert.ok('final' in result);
  assert.ok('history' in result, 'history must be present');
  assert.ok('events' in result, 'events must be present');
  assert.ok('toolCalls' in result, 'toolCalls must be present');
  assert.ok('qualityGate' in result, 'qualityGate must be present');
  assert.ok('acceptanceCriteria' in result, 'acceptanceCriteria must be present');
  assert.ok('plannerDebugSnapshot' in result, 'plannerDebugSnapshot must be present');

  // Bit-for-bit type check: existing field types must not have changed
  assert.equal(typeof result.success, 'boolean');
  assert.equal(typeof result.status, 'string');
  assert.ok(Array.isArray(result.toolCalls));
  assert.ok(Array.isArray(result.events));
  assert.ok(Array.isArray(result.history));
  assert.equal(typeof result.qualityGate, 'object');
  assert.equal(typeof result.plannerDebugSnapshot, 'object');
  assert.ok(result.plannerDebugSnapshot !== null);

  // completionResult is only in the final return path (not stuck/override paths)
  // so we only assert its type when present
  if ('completionResult' in result) {
    assert.equal(typeof result.completionResult, 'object');
  }
  if ('plannerMetrics' in result) {
    assert.equal(typeof result.plannerMetrics, 'object');
  }
});

// ========== Test 3: plannerDebugSnapshot is plain JSON-serializable ==========
test('Phase 4.21 Test 3: plannerDebugSnapshot is plain JSON-serializable objects', async () => {
  let modelCalls = 0;

  const result = await runAgentLoop({
    messages: [{ role: 'user', content: 'WRITE_FILE test3.txt with content "serialize"' }],
    maxSteps: 6,
    generateResponse: async () => {
      modelCalls += 1;
      return respond('WRITE_FILE', { path: 'test3.txt', content: 'serialize' }, { final: 'Written test3.txt' });
    }
  });

  const snap = result.plannerDebugSnapshot;
  assert.ok(snap !== null && snap !== undefined);

  // JSON round-trip: must serialize and deserialize without error
  const json = JSON.stringify(snap);
  assert.equal(typeof json, 'string');
  const parsed = JSON.parse(json);
  assert.ok(parsed.dag && typeof parsed.dag === 'object');
  assert.ok(Array.isArray(parsed.dag.nodes));
  assert.ok(Array.isArray(parsed.dag.edges));
  assert.ok(Array.isArray(parsed.tasks));
  assert.ok(Array.isArray(parsed.parallelGroups));
  assert.ok(typeof parsed.executionMemory === 'object');
  assert.ok(Array.isArray(parsed.executionMemory.entries));

  // Dependencies must be serialized as arrays (not Sets)
  for (const t of parsed.tasks) {
    assert.ok(Array.isArray(t.dependencies), 'dependencies must be an array after JSON round-trip');
    assert.ok(Array.isArray(t.parents), 'parents must be an array after JSON round-trip');
    assert.ok(Array.isArray(t.children), 'children must be an array after JSON round-trip');
    // No function values
    for (const [k, v] of Object.entries(t)) {
      assert.ok(typeof v !== 'function', `task.${k} must not be a function`);
    }
  }
});

// ========== Test 4: Snapshot captures branch decisions for failed tasks ==========
test('Phase 4.21 Test 4: plannerDebugSnapshot captures task statuses and branch info', async () => {
  let modelCalls = 0;

  const result = await runAgentLoop({
    messages: [{ role: 'user', content: 'WRITE_FILE missing.txt then RUN_TERMINAL dir' }],
    maxSteps: 4,
    generateResponse: async () => {
      modelCalls += 1;
      if (modelCalls === 1) {
        return respond('WRITE_FILE', { path: 'missing.txt', content: 'content' });
      }
      return respond('RUN_TERMINAL', { command: 'dir' }, { final: 'Files listed.' });
    }
  });

  const snap = result.plannerDebugSnapshot;
  assert.ok(snap !== null, 'plannerDebugSnapshot must exist');

  // Verify tasks have statuses
  for (const t of snap.tasks) {
    assert.ok(typeof t.status === 'string', 'task.status must be string');
    assert.ok(['PENDING', 'READY', 'RUNNING', 'SUCCESS', 'FAILED', 'BLOCKED', 'SKIPPED', 'RECOVERING', 'RECOVERED', 'RECOVERY_FAILED'].includes(t.status),
      `Unexpected task status: ${t.status}`);
  }

  // Verify branch type/reason fields (when populated)
  const branchedTasks = snap.tasks.filter(t => t.branchType);
  if (branchedTasks.length > 0) {
    for (const t of branchedTasks) {
    assert.equal(typeof t.branchType, 'string', 'branchType must be string when set');
    }
  }
});

// ========== Test 5: Planner debug HTML uses the snapshot fields directly ==========
test('Phase 4.21 Test 5: planner debug HTML renders the new snapshot fields and safe score formatting', async () => {
  const html = await fs.readFile(path.resolve(process.cwd(), 'backend/generated/planner-debug.html'), 'utf8');

  assert.ok(html.includes('formatQualityScore(qg.score)'), 'HTML must use safe quality score formatting');
  assert.ok(html.includes('snap?.plannerState || snap?.state ||'), 'HTML must display plannerState');
  assert.ok(html.includes('getDagEdges(snap)'), 'HTML must read DAG edges from the snapshot');
  assert.ok(html.includes('getExecutionMemoryEntries(snap)'), 'HTML must read execution memory entries from the snapshot');
  assert.ok(html.includes('formatEstimatedTime(t.estimatedTime)'), 'HTML must format estimatedTime safely');
  assert.ok(html.includes('formatEstimatedMetric(t.estimatedIO)'), 'HTML must format estimatedIO safely');
  assert.ok(!html.includes('qg.score * 100'), 'HTML must not multiply normalized score again');
  assert.ok(!html.includes('t.estimatedTime.toFixed(1)'), 'HTML must not call toFixed on estimatedTime directly');
  assert.ok(!html.includes('t.estimatedIO.toFixed(1)'), 'HTML must not call toFixed on estimatedIO directly');
  assert.ok(!html.includes('10000%'), 'HTML must not hardcode the bugged quality score output');
});

test('Phase 4.21 Test 6: planner debug HTML cost panel is tolerant of non-numeric estimatedTime values', async () => {
  const html = await fs.readFile(path.resolve(process.cwd(), 'backend/generated/planner-debug.html'), 'utf8');

  assert.ok(html.includes('formatEstimatedTime'), 'HTML must define the estimated time formatter');
  assert.ok(html.includes('Number.isFinite(estimatedCost)'), 'HTML must guard estimatedCost width calculations');
  assert.ok(html.includes('formatCostValue(t.estimatedCost)'), 'HTML must format estimated cost safely');
});

test('Phase 4.21 Test 7: planner debug DAG render guards missing DOM containers', async () => {
  const html = await fs.readFile(path.resolve(process.cwd(), 'backend/generated/planner-debug.html'), 'utf8');

  assert.ok(html.includes('const panel = $(\'panel-dag\');'), 'HTML must look up the DAG panel before rendering');
  assert.ok(html.includes('if (!container || !svg)'), 'HTML must guard missing DAG container elements');
  assert.ok(html.includes('Planner DAG view is unavailable.'), 'HTML must show a safe fallback when the DAG view cannot be restored');
});

test('Phase 4.21 Test 8: planner debug helpers normalize object-shaped task maps', async () => {
  const html = await fs.readFile(path.resolve(process.cwd(), 'generated/planner-debug.html'), 'utf8');

  assert.ok(html.includes('function normalizePlannerTasks(value)'), 'HTML must define task normalization');
  assert.ok(html.includes('const tasks = getPlannerTasks(snap);'), 'HTML must render DAG from normalized tasks');
  assert.ok(!html.includes('const tasks = snap.tasks || [];'), 'HTML must not use raw snap.tasks in renderDag');

  const helperMatch = html.match(/function getDagNodes\(snap\) \{[\s\S]*?function getDagEdges\(snap\) \{/);
  assert.ok(helperMatch, 'HTML must contain the task helper block');

  const helperSource = helperMatch[0].replace(/\nfunction getDagEdges\(snap\) \{[\s\S]*$/, '');
  const context = { Array, Object, Math };
  vm.runInNewContext(`${helperSource}\nthis.__helpers = { getDagNodes, normalizePlannerTasks, getPlannerTasks };`, context);

  assert.equal(context.__helpers.getPlannerTasks({ tasks: { one: { id: 'one', tool: 'WRITE_FILE' } } }).length, 1);
  assert.equal(context.__helpers.getDagNodes({ tasks: { one: { id: 'one', tool: 'WRITE_FILE' } } }).length, 1);
  assert.equal(
    context.__helpers.getPlannerTasks({ dag: { nodes: { a: { id: 'a', tool: 'READ_FILE' } } }, tasks: { one: { id: 'one' } } }).length,
    1,
    'dag.nodes map should normalize to a single task'
  );
});
