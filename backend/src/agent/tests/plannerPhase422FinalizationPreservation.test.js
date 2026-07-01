import test from 'node:test';
import assert from 'node:assert/strict';
import { Planner } from '../planner/planner.js';
import {
  captureOriginalPlannerGraph,
  buildPlannerFinalText,
  buildPlannerGraphFinalizationDiagnostics,
  buildPlannerFinalizationBlockedText
} from '../runAgentLoop.js';

function makeTask(id, tool, goal, dependencies = [], toolArgs = {}) {
  return {
    id,
    kind: tool,
    tool,
    goal,
    dependencies,
    toolArgs
  };
}

test('Phase 4.22-HF9: truncated original planner graph is blocked before finalization', () => {
  const planner = new Planner([
    makeTask('read-package', 'READ_FILE', 'Read package.json', [], { path: 'package.json' }),
    makeTask('write-math', 'WRITE_FILE', 'Write src/math.js', ['read-package'], { path: 'src/math.js', content: '' }),
    makeTask('write-math-test', 'WRITE_FILE', 'Write src/math.test.js', ['read-package'], { path: 'src/math.test.js', content: '' }),
    makeTask('run-tests', 'RUN_TERMINAL', 'Run npm test', ['write-math', 'write-math-test'], { command: 'npm test' })
  ]);

  captureOriginalPlannerGraph(planner);
  planner.markSuccess('read-package', {
    tool: 'READ_FILE',
    args: { path: 'package.json' },
    result: { file: 'package.json' }
  });

  planner.graph.removeNode('write-math');
  planner.graph.removeNode('write-math-test');
  planner.graph.removeNode('run-tests');

  const diagnostics = buildPlannerGraphFinalizationDiagnostics(planner);
  assert.equal(diagnostics.blocked, true);
  assert.equal(diagnostics.graphCorruption, true);
  assert.equal(diagnostics.originalCount, 4);
  assert.equal(diagnostics.currentCount, 1);
  assert.deepEqual(new Set(diagnostics.missingIds), new Set(['write-math', 'write-math-test', 'run-tests']));
  assert.equal(diagnostics.unfinishedTasks.length, 3);

  const blockedText = buildPlannerFinalizationBlockedText(diagnostics);
  assert.match(blockedText, /Planner finalization blocked\./);
  assert.doesNotMatch(blockedText, /Planner execution completed successfully/);
});

test('Phase 4.22-HF9: preserved original planner graph still counts all tasks when terminal', () => {
  const planner = new Planner([
    makeTask('read-package', 'READ_FILE', 'Read package.json', [], { path: 'package.json' }),
    makeTask('write-math', 'WRITE_FILE', 'Write src/math.js', ['read-package'], { path: 'src/math.js', content: '' }),
    makeTask('write-math-test', 'WRITE_FILE', 'Write src/math.test.js', ['read-package'], { path: 'src/math.test.js', content: '' }),
    makeTask('run-tests', 'RUN_TERMINAL', 'Run npm test', ['write-math', 'write-math-test'], { command: 'npm test' })
  ]);

  captureOriginalPlannerGraph(planner);
  planner.markSuccess('read-package', { tool: 'READ_FILE', args: { path: 'package.json' }, result: { file: 'package.json' } });
  planner.markSuccess('write-math', { tool: 'WRITE_FILE', args: { path: 'src/math.js' }, result: { file: 'src/math.js' } });
  planner.markSuccess('write-math-test', { tool: 'WRITE_FILE', args: { path: 'src/math.test.js' }, result: { file: 'src/math.test.js' } });
  planner.markSuccess('run-tests', { tool: 'RUN_TERMINAL', args: { command: 'npm test' }, result: { exitCode: 0 } });

  const diagnostics = buildPlannerGraphFinalizationDiagnostics(planner);
  assert.equal(diagnostics.blocked, false);
  assert.equal(diagnostics.graphCorruption, false);
  assert.equal(diagnostics.originalCount, 4);
  assert.equal(diagnostics.currentCount, 4);
  assert.equal(diagnostics.unfinishedTasks.length, 0);

  const finalText = buildPlannerFinalText({
    planner,
    toolCalls: [{ tool: 'RUN_TERMINAL', success: true, args: { command: 'npm test' }, result: { exitCode: 0 } }],
    readFileCache: new Map(),
    changedFiles: []
  });
  assert.match(finalText, /Planner execution completed successfully\./);
  assert.match(finalText, /\(4 succeeded, 0 skipped\)/);
});
