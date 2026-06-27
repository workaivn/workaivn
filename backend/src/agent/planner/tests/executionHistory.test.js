import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createExecutionHistory } from '../executionHistory.js';
import { Planner } from '../planner.js';
import { notifyToolExecution } from '../executionController.js';
import { Task } from '../task.js';

describe('ExecutionHistory', () => {
  it('records READ_FILE path', () => {
    const h = createExecutionHistory();
    h.recordRead('src/test.js');
    assert.ok(h.hasRead('src/test.js'));
    assert.ok(h.shouldSkip('READ_FILE', { path: 'src/test.js' }));
  });

  it('records and normalizes READ_FILE path (backslash)', () => {
    const h = createExecutionHistory();
    h.recordRead('src\\test.js');
    assert.ok(h.hasRead('src/test.js'));
  });

  it('records WRITE_FILE with content', () => {
    const h = createExecutionHistory();
    h.recordWrite('src/test.js', 'console.log("hello")');
    assert.ok(h.hasWritten('src/test.js', 'console.log("hello")'));
    assert.ok(h.shouldSkip('WRITE_FILE', { file: 'src/test.js', content: 'console.log("hello")' }));
  });

  it('does not skip WRITE_FILE with different content', () => {
    const h = createExecutionHistory();
    h.recordWrite('src/test.js', 'console.log("hello")');
    assert.ok(!h.hasWritten('src/test.js', 'console.log("world")'));
    assert.ok(!h.shouldSkip('WRITE_FILE', { file: 'src/test.js', content: 'console.log("world")' }));
  });

  it('records RUN_TERMINAL command with exitCode', () => {
    const h = createExecutionHistory();
    h.recordCommand('npm test', 0);
    assert.ok(h.hasExecuted('npm test'));
    assert.ok(h.shouldSkip('RUN_TERMINAL', { command: 'npm test' }));
  });

  it('does not skip RUN_TERMINAL with non-zero exitCode', () => {
    const h = createExecutionHistory();
    h.recordCommand('npm test', 1);
    assert.ok(!h.hasExecuted('npm test'));
    assert.ok(!h.shouldSkip('RUN_TERMINAL', { command: 'npm test' }));
  });

  it('records APPLY_PATCH target', () => {
    const h = createExecutionHistory();
    h.recordPatch('src/test.js');
    assert.ok(h.hasAppliedPatch('src/test.js'));
    assert.ok(h.shouldSkip('APPLY_PATCH', { file: 'src/test.js' }));
  });

  it('returns skipReason for each tool', () => {
    const h = createExecutionHistory();
    assert.equal(h.skipReason('READ_FILE', { path: 'x.js' }), null);
    h.recordRead('x.js');
    assert.equal(h.skipReason('READ_FILE', { path: 'x.js' }), 'already_read');
    h.recordWrite('y.js', 'a');
    assert.equal(h.skipReason('WRITE_FILE', { file: 'y.js', content: 'a' }), 'already_written');
    h.recordCommand('node a.js', 0);
    assert.equal(h.skipReason('RUN_TERMINAL', { command: 'node a.js' }), 'already_executed');
    h.recordPatch('z.js');
    assert.equal(h.skipReason('APPLY_PATCH', { file: 'z.js' }), 'already_applied');
  });

  it('records tool via generic recordTool', () => {
    const h = createExecutionHistory();
    h.recordTool('READ_FILE', { path: 'a.js' }, { success: true, file: 'a.js' });
    assert.ok(h.hasRead('a.js'));
    h.recordTool('WRITE_FILE', { file: 'b.js', content: 'hi' }, { success: true });
    assert.ok(h.hasWritten('b.js', 'hi'));
    h.recordTool('RUN_TERMINAL', { command: 'echo hi' }, { success: true, exitCode: 0 });
    assert.ok(h.hasExecuted('echo hi'));
    h.recordTool('APPLY_PATCH', { file: 'c.js' }, { success: true });
    assert.ok(h.hasAppliedPatch('c.js'));
  });

  it('does not record failed tools', () => {
    const h = createExecutionHistory();
    h.recordTool('READ_FILE', { path: 'a.js' }, { success: false });
    assert.ok(!h.hasRead('a.js'));
  });

  it('skipReason returns null for unknown tool', () => {
    const h = createExecutionHistory();
    assert.equal(h.skipReason('UNKNOWN', {}), null);
  });

  it('recordTask and hasCompletedTask', () => {
    const h = createExecutionHistory();
    assert.ok(!h.hasCompletedTask('t1'));
    h.recordTask('t1');
    assert.ok(h.hasCompletedTask('t1'));
  });

  it('FINAL tool is recorded', () => {
    const h = createExecutionHistory();
    assert.ok(!h.shouldSkip('FINAL', {}));
    h.recordTool('FINAL', {}, { success: true });
    assert.ok(h.shouldSkip('FINAL', {}));
  });

  it('Planner constructor has executionHistory', () => {
    const planner = new Planner([]);
    assert.ok(planner.executionHistory);
    assert.ok(typeof planner.executionHistory.recordRead === 'function');
  });

  it('notifyToolExecution records to planner history on success', () => {
    const task = new Task({ id: 't1', kind: 'CODING', goal: 'Read file', tool: 'READ_FILE' });
    const planner = new Planner([task]);
    notifyToolExecution(planner, 'READ_FILE', { path: 'test.js' }, { success: true, file: 'test.js', content: 'data' });
    assert.ok(planner.executionHistory.hasRead('test.js'));
    assert.ok(planner.executionHistory.hasCompletedTask('t1'));
  });

  it('notifyToolExecution does not record on failure', () => {
    const task = new Task({ id: 't1', kind: 'CODING', goal: 'Read file', tool: 'READ_FILE' });
    const planner = new Planner([task]);
    notifyToolExecution(planner, 'READ_FILE', { path: 'test.js' }, { success: false, error: 'Not found' });
    assert.ok(!planner.executionHistory.hasRead('test.js'));
  });

  it('duplicate READ_FILE is skipped via shouldSkip', () => {
    const h = createExecutionHistory();
    h.recordRead('pkg.json');
    assert.ok(h.shouldSkip('READ_FILE', { path: 'pkg.json' }));
  });

  it('duplicate RUN_TERMINAL is skipped via shouldSkip', () => {
    const h = createExecutionHistory();
    h.recordCommand('npm install', 0);
    assert.ok(h.shouldSkip('RUN_TERMINAL', { command: 'npm install' }));
  });

  it('different RUN_TERMINAL command is not skipped', () => {
    const h = createExecutionHistory();
    h.recordCommand('npm install', 0);
    assert.ok(!h.shouldSkip('RUN_TERMINAL', { command: 'npm test' }));
  });

  it('different READ_FILE path is not skipped', () => {
    const h = createExecutionHistory();
    h.recordRead('pkg.json');
    assert.ok(!h.shouldSkip('READ_FILE', { path: 'other.json' }));
  });

  it('skip dependency chain: READ skipped → WRITE becomes ready', () => {
    const h = createExecutionHistory();
    h.recordRead('pkg.json');
    const readTask = new Task({ id: 'read1', kind: 'CODING', goal: 'Read pkg.json', tool: 'READ_FILE', toolArgs: { path: 'pkg.json' } });
    const writeTask = new Task({ id: 'write1', kind: 'CODING', goal: 'Write file', tool: 'WRITE_FILE', toolArgs: { file: 'out.js', content: 'x' }, dependencies: ['read1'] });
    const planner = new Planner([readTask, writeTask]);
    // getNextTask should return read1 (no deps)
    const first = planner.getNextTask();
    assert.equal(first?.id, 'read1');
    // Verify history says skip for this read
    assert.ok(h.shouldSkip('READ_FILE', { path: 'pkg.json' }));
    // Simulate skip: mark SUCCESS, release dependency
    planner.markSuccess('read1', { tool: 'READ_FILE', result: { success: true, skipped: true } });
    // After skip, WRITE should become ready
    const next = planner.getNextTask();
    assert.equal(next?.id, 'write1');
  });

  it('skip dependency chain: RUN_TERMINAL skipped, deps released', () => {
    const h = createExecutionHistory();
    h.recordCommand('node test.js', 0);
    const runTask = new Task({ id: 'run1', kind: 'CODING', goal: 'Run test', tool: 'RUN_TERMINAL', toolArgs: { command: 'node test.js' } });
    const finalTask = new Task({ id: 'final1', kind: 'CODING', goal: 'Finish', tool: 'FINAL', dependencies: ['run1'] });
    const planner = new Planner([runTask, finalTask]);
    const first = planner.getNextTask();
    assert.equal(first?.id, 'run1');
    assert.ok(h.shouldSkip('RUN_TERMINAL', { command: 'node test.js' }));
    planner.markSuccess('run1', { tool: 'RUN_TERMINAL', result: { success: true, skipped: true } });
    const next = planner.getNextTask();
    assert.equal(next?.id, 'final1');
  });

  it('WRITE_FILE with same path+content skipped, different content not skipped', () => {
    const h = createExecutionHistory();
    h.recordWrite('out.js', 'version1');
    // Same content → skip
    assert.ok(h.shouldSkip('WRITE_FILE', { file: 'out.js', content: 'version1' }));
    // Different content → no skip
    assert.ok(!h.shouldSkip('WRITE_FILE', { file: 'out.js', content: 'version2' }));
  });

  it('APPLY_PATCH with same target skipped', () => {
    const h = createExecutionHistory();
    h.recordPatch('patch.js');
    assert.ok(h.shouldSkip('APPLY_PATCH', { file: 'patch.js' }));
    assert.ok(!h.shouldSkip('APPLY_PATCH', { file: 'other.js' }));
  });

  it('history survives across recovery — recovery uses same history', () => {
    const h = createExecutionHistory();
    h.recordRead('pkg.json');
    h.recordRead('config.json');
    // Simulate recovery wanting to re-read pkg.json — should be skipped
    assert.ok(h.shouldSkip('READ_FILE', { path: 'pkg.json' }));
    // But config.json was also read, so same
    assert.ok(h.shouldSkip('READ_FILE', { path: 'config.json' }));
    // Unread file should not skip
    assert.ok(!h.shouldSkip('READ_FILE', { path: 'new.json' }));
  });

  it('dual READ_FILE: second task skipped via history', () => {
    const h = createExecutionHistory();
    const t1 = new Task({ id: 'r1', kind:'CODING', goal:'Read pkg.json', tool:'READ_FILE', toolArgs:{ path:'pkg.json' } });
    const t2 = new Task({ id: 'r2', kind:'CODING', goal:'Read pkg.json', tool:'READ_FILE', toolArgs:{ path:'pkg.json' } });
    const planner = new Planner([t1, t2]);

    // First dispatch
    assert.equal(planner.getNextTask()?.id, 'r1');
    h.recordRead('pkg.json');
    planner.markSuccess('r1', { tool:'READ_FILE', result:{ success:true } });

    // Second dispatch — history says skip
    assert.equal(planner.getNextTask()?.id, 'r2');
    assert.ok(h.shouldSkip('READ_FILE', { path:'pkg.json' }));
    assert.equal(h.skipReason('READ_FILE', { path:'pkg.json' }), 'already_read');

    // Skip: mark SUCCESS without execution
    planner.markSuccess('r2', { tool:'READ_FILE', result:{ success:true, skipped:true } });
    assert.ok(planner.isComplete());
  });

  it('dual READ_FILE: skip releases dependency on writer', () => {
    const h = createExecutionHistory();
    const t1 = new Task({ id:'r1', kind:'CODING', goal:'Read pkg.json', tool:'READ_FILE', toolArgs:{ path:'pkg.json' } });
    const t2 = new Task({ id:'r2', kind:'CODING', goal:'Read pkg.json', tool:'READ_FILE', toolArgs:{ path:'pkg.json' }, dependencies:[] });
    const writeTask = new Task({ id:'w1', kind:'CODING', goal:'Write output', tool:'WRITE_FILE', toolArgs:{ file:'out.js', content:'x' }, dependencies:['r1', 'r2'] });
    const planner = new Planner([t1, t2, writeTask]);

    assert.equal(planner.getNextTask()?.id, 'r1');
    h.recordRead('pkg.json');
    planner.markSuccess('r1', { tool:'READ_FILE', result:{ success:true } });

    assert.equal(planner.getNextTask()?.id, 'r2');
    assert.ok(h.shouldSkip('READ_FILE', { path:'pkg.json' }));
    planner.markSuccess('r2', { tool:'READ_FILE', result:{ success:true, skipped:true } });

    // Both reads done → writer becomes ready
    assert.equal(planner.getNextTask()?.id, 'w1');
    assert.ok(!planner.isComplete()); // write not done yet
  });

  it('dual RUN_TERMINAL: second task skipped', () => {
    const h = createExecutionHistory();
    const t1 = new Task({ id:'t1', kind:'CODING', goal:'Run test', tool:'RUN_TERMINAL', toolArgs:{ command:'node test.js' } });
    const t2 = new Task({ id:'t2', kind:'CODING', goal:'Run test', tool:'RUN_TERMINAL', toolArgs:{ command:'node test.js' } });
    const planner = new Planner([t1, t2]);

    assert.equal(planner.getNextTask()?.id, 't1');
    h.recordCommand('node test.js', 0);
    planner.markSuccess('t1', { tool:'RUN_TERMINAL', result:{ success:true, exitCode:0 } });

    assert.equal(planner.getNextTask()?.id, 't2');
    assert.ok(h.shouldSkip('RUN_TERMINAL', { command:'node test.js' }));
    assert.equal(h.skipReason('RUN_TERMINAL', { command:'node test.js' }), 'already_executed');

    planner.markSuccess('t2', { tool:'RUN_TERMINAL', result:{ success:true, skipped:true } });
    assert.ok(planner.isComplete());
  });

  it('dual RUN_TERMINAL with different exitCode: second NOT skipped (non-zero)', () => {
    const h = createExecutionHistory();
    const t1 = new Task({ id:'t1', kind:'CODING', goal:'Run test', tool:'RUN_TERMINAL', toolArgs:{ command:'node test.js' } });
    const t2 = new Task({ id:'t2', kind:'CODING', goal:'Run test', tool:'RUN_TERMINAL', toolArgs:{ command:'node test.js' } });
    const planner = new Planner([t1, t2]);

    assert.equal(planner.getNextTask()?.id, 't1');
    h.recordCommand('node test.js', 1); // non-zero exit — not recorded
    planner.markSuccess('t1', { tool:'RUN_TERMINAL', result:{ success:true, exitCode:1 } });

    assert.equal(planner.getNextTask()?.id, 't2');
    // Non-zero exit means NOT recorded in history → should NOT skip
    assert.ok(!h.shouldSkip('RUN_TERMINAL', { command:'node test.js' }));
    assert.equal(h.skipReason('RUN_TERMINAL', { command:'node test.js' }), null);
  });

  it('WRITE_FILE: same content skipped, different content not skipped', () => {
    const h = createExecutionHistory();
    const tA = new Task({ id:'a', kind:'CODING', goal:'Write a.js', tool:'WRITE_FILE', toolArgs:{ file:'a.js', content:'X' } });
    const tB = new Task({ id:'b', kind:'CODING', goal:'Write a.js', tool:'WRITE_FILE', toolArgs:{ file:'a.js', content:'X' } });
    const tC = new Task({ id:'c', kind:'CODING', goal:'Write a.js', tool:'WRITE_FILE', toolArgs:{ file:'a.js', content:'Y' } });
    const planner = new Planner([tA, tB, tC]);

    // Execute A
    assert.equal(planner.getNextTask()?.id, 'a');
    h.recordWrite('a.js', 'X');
    planner.markSuccess('a', { tool:'WRITE_FILE', result:{ success:true } });

    // B — same fingerprint → skip
    assert.equal(planner.getNextTask()?.id, 'b');
    assert.ok(h.shouldSkip('WRITE_FILE', { file:'a.js', content:'X' }));
    assert.equal(h.skipReason('WRITE_FILE', { file:'a.js', content:'X' }), 'already_written');
    planner.markSuccess('b', { tool:'WRITE_FILE', result:{ success:true, skipped:true } });

    // C — different fingerprint → NOT skipped
    assert.equal(planner.getNextTask()?.id, 'c');
    assert.ok(!h.shouldSkip('WRITE_FILE', { file:'a.js', content:'Y' }));
    assert.equal(h.skipReason('WRITE_FILE', { file:'a.js', content:'Y' }), null);
    planner.markSuccess('c', { tool:'WRITE_FILE', result:{ success:true } });

    assert.ok(planner.isComplete());
  });
});

describe('ExecutionHistory — logging verification', () => {
  it('PLANNER_HISTORY_RECORD logged by notifyToolExecution on success', () => {
    const logs = [];
    const orig = console.log;
    console.log = (...args) => { logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')); };
    try {
      const task = new Task({ id:'t1', kind:'CODING', goal:'Read', tool:'READ_FILE' });
      const planner = new Planner([task]);
      notifyToolExecution(planner, 'READ_FILE', { path:'a.js' }, { success:true, file:'a.js', content:'data' });

      const found = logs.some(l => l.includes('[PLANNER_HISTORY_RECORD]'));
      assert.ok(found, 'Expected [PLANNER_HISTORY_RECORD] in logs');
    } finally {
      console.log = orig;
    }
  });

  it('PLANNER_SKIP_HISTORY logged when skip reason is present', () => {
    const logs = [];
    const orig = console.log;
    console.log = (...args) => { logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')); };
    try {
      const h = createExecutionHistory();
      h.recordRead('pkg.json');
      const reason = h.skipReason('READ_FILE', { path:'pkg.json' });
      if (reason) {
        console.log('[PLANNER_SKIP_HISTORY]', { taskId:'x', tool:'READ_FILE', reason });
      }
      const found = logs.some(l => l.includes('[PLANNER_SKIP_HISTORY]'));
      assert.ok(found, 'Expected [PLANNER_SKIP_HISTORY] in logs');
    } finally {
      console.log = orig;
    }
  });

  it('PLANNER_HISTORY_LOOKUP logged on dispatch check', () => {
    const logs = [];
    const orig = console.log;
    console.log = (...args) => { logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')); };
    try {
      const h = createExecutionHistory();
      h.recordRead('pkg.json');
      const reason = h.skipReason('READ_FILE', { path:'pkg.json' });
      console.log('[PLANNER_HISTORY_LOOKUP]', { taskId:'x', tool:'READ_FILE', args:{ path:'pkg.json' }, result: reason || 'not_found' });

      const found = logs.some(l => l.includes('[PLANNER_HISTORY_LOOKUP]'));
      assert.ok(found, 'Expected [PLANNER_HISTORY_LOOKUP] in logs');
      const lookupLog = logs.find(l => l.includes('[PLANNER_HISTORY_LOOKUP]'));
      assert.ok(lookupLog.includes('already_read'), 'Lookup result should be already_read');
    } finally {
      console.log = orig;
    }
  });

  it('full log sequence: RECORD → LOOKUP → SKIP', () => {
    const logs = [];
    const orig = console.log;
    console.log = (...args) => { logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')); };
    try {
      // Step 1: Task A records via notifyToolExecution
      const taskA = new Task({ id:'a', kind:'CODING', goal:'Read', tool:'READ_FILE' });
      const planner = new Planner([taskA]);
      notifyToolExecution(planner, 'READ_FILE', { path:'a.js' }, { success:true, file:'a.js', content:'data' });

      // Step 2: Task B dispatch — lookup
      const h = planner.executionHistory;
      const reason = h.skipReason('READ_FILE', { path:'a.js' });
      console.log('[PLANNER_HISTORY_LOOKUP]', { taskId:'b', tool:'READ_FILE', args:{ path:'a.js' }, result: reason || 'not_found' });

      // Step 3: Skip
      if (reason) {
        console.log('[PLANNER_SKIP_HISTORY]', { taskId:'b', tool:'READ_FILE', reason });
      }

      const hasRecord = logs.some(l => l.includes('[PLANNER_HISTORY_RECORD]'));
      const hasLookup = logs.some(l => l.includes('[PLANNER_HISTORY_LOOKUP]'));
      const hasSkip = logs.some(l => l.includes('[PLANNER_SKIP_HISTORY]'));
      assert.ok(hasRecord, 'Missing [PLANNER_HISTORY_RECORD]');
      assert.ok(hasLookup, 'Missing [PLANNER_HISTORY_LOOKUP]');
      assert.ok(hasSkip, 'Missing [PLANNER_SKIP_HISTORY]');

      // Order check
      const recordIdx = logs.findIndex(l => l.includes('[PLANNER_HISTORY_RECORD]'));
      const lookupIdx = logs.findIndex(l => l.includes('[PLANNER_HISTORY_LOOKUP]'));
      const skipIdx = logs.findIndex(l => l.includes('[PLANNER_SKIP_HISTORY]'));
      assert.ok(recordIdx < lookupIdx, 'RECORD must appear before LOOKUP');
      assert.ok(lookupIdx < skipIdx, 'LOOKUP must appear before SKIP');
    } finally {
      console.log = orig;
    }
  });
});
