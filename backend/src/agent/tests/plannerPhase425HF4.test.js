import test from 'node:test';
import assert from 'node:assert/strict';
import { Planner } from '../planner/planner.js';
import { Task } from '../planner/task.js';
import { TaskStatus } from '../planner/plannerTypes.js';

function captureLogs() {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.map(value => {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  }).join(' '));
  return {
    logs,
    restore() {
      console.log = originalLog;
    }
  };
}

test('Phase 4.25-HF4: reasoning replacement keeps RUN_TERMINAL waiting until write commit', () => {
  const { logs, restore } = captureLogs();

  try {
    const planner = new Planner([
      new Task({
        id: 'generate',
        kind: 'REASONING',
        goal: 'Generate content for file: src/App.tsx',
        tool: null,
        dependencies: []
      }),
      new Task({
        id: 'run',
        kind: 'CODING',
        goal: 'Run command: npm run build',
        tool: 'RUN_TERMINAL',
        toolArgs: { command: 'npm run build' },
        dependencies: ['generate']
      })
    ]);

    const writeTask = new Task({
      id: 'write',
      kind: 'CODING',
      goal: 'Write file: src/App.tsx with generated content',
      tool: 'WRITE_FILE',
      toolArgs: {
        path: 'src/App.tsx',
        file: 'src/App.tsx',
        content: 'export default function App() { return null; }'
      },
      dependencies: []
    });

    const addedIds = planner.replaceReasoningTask('generate', [writeTask], {
      downstreamTaskIds: ['run']
    });

    assert.deepEqual(addedIds, ['write']);
    assert.equal(planner.graph.getNode('run').status, TaskStatus.PENDING);
    assert.ok(logs.some(line => line.includes('[TASK_DEPENDENCY_REWRITTEN_FOR_COMMIT]')));
    assert.ok(logs.some(line => line.includes('[WRITE_TASK_CREATED_FROM_GENERATION]')));
    assert.ok(logs.some(line => line.includes('[RUN_TERMINAL_WAITING_FOR_WRITES]')));

    planner.markSuccess('write', {
      tool: 'WRITE_FILE',
      args: { path: 'src/App.tsx' },
      result: { success: true, committed: true }
    });

    assert.equal(planner.graph.getNode('run').status, TaskStatus.READY);
    assert.ok(logs.some(line => line.includes('[DEPENDENCY_RELEASED]')));
    assert.ok(logs.some(line => line.includes('[RUN_TERMINAL_READY]')));
  } finally {
    restore();
  }
});

test('Phase 4.25-HF4: multiple terminal tasks stay gated until the commit lands', () => {
  const { logs, restore } = captureLogs();

  try {
    const planner = new Planner([
      new Task({
        id: 'generate',
        kind: 'REASONING',
        goal: 'Generate content for file: src/App.tsx',
        tool: null,
        dependencies: []
      }),
      new Task({
        id: 'run-build',
        kind: 'CODING',
        goal: 'Run command: npm run build',
        tool: 'RUN_TERMINAL',
        toolArgs: { command: 'npm run build' },
        dependencies: ['generate']
      }),
      new Task({
        id: 'run-test',
        kind: 'CODING',
        goal: 'Run command: npm test',
        tool: 'RUN_TERMINAL',
        toolArgs: { command: 'npm test' },
        dependencies: ['generate']
      })
    ]);

    const writeTask = new Task({
      id: 'write',
      kind: 'CODING',
      goal: 'Write file: src/App.tsx with generated content',
      tool: 'WRITE_FILE',
      toolArgs: {
        path: 'src/App.tsx',
        file: 'src/App.tsx',
        content: 'export default function App() { return null; }'
      },
      dependencies: []
    });

    planner.replaceReasoningTask('generate', [writeTask], {
      downstreamTaskIds: ['run-build', 'run-test']
    });

    assert.equal(planner.graph.getNode('run-build').status, TaskStatus.PENDING);
    assert.equal(planner.graph.getNode('run-test').status, TaskStatus.PENDING);
    assert.ok(logs.some(line => line.includes('[RUN_TERMINAL_WAITING_FOR_WRITES]')));

    planner.markSuccess('write', {
      tool: 'WRITE_FILE',
      args: { path: 'src/App.tsx' },
      result: { success: true, committed: true }
    });

    assert.equal(planner.graph.getNode('run-build').status, TaskStatus.READY);
    assert.equal(planner.graph.getNode('run-test').status, TaskStatus.READY);
    assert.ok(logs.filter(line => line.includes('[RUN_TERMINAL_READY]')).length >= 2);
  } finally {
    restore();
  }
});
