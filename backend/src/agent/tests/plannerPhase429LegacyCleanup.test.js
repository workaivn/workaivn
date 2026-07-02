import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPlan } from '../planner/planBuilder.js';
import { expandPlannerTasks } from '../planner/taskExpander.js';
import { promoteProposalGraphToTasks } from '../planner/proposals/index.js';
import { createExecutionPlanner } from '../executionPlanner/executionPlanner.js';
import { buildExecutionPlan } from '../../planning/executionPlanner/planner.js';
import { Planner } from '../planner/planner.js';
import { Task } from '../planner/task.js';

function captureLogs() {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.map(item => {
      if (typeof item === 'string') return item;
      try {
        return JSON.stringify(item);
      } catch {
        return String(item);
      }
    }).join(' '));
  };
  return {
    logs,
    restore() {
      console.log = originalLog;
    }
  };
}

function createPlanningContext() {
  return {
    verifiedFiles: [],
    verifiedCommands: ['npm test'],
    facts: {
      requestedFiles: [],
      entryFiles: []
    }
  };
}

test('Phase 4.29: buildPlan is a compatibility wrapper over ExecutionPlanner', () => {
  const { logs, restore } = captureLogs();
  try {
    const result = buildPlan('Create src/math.js and src/math.test.js.', {
      projectScan: { projectType: 'node' },
      workspaceState: { existingFiles: [], workspaceRoot: '' },
      projectIntent: { goalType: 'LIBRARY' },
      bootstrapProfile: null
    }, null, createPlanningContext());

    assert.ok(result.executionPlanner);
    assert.ok(logs.some(line => line.includes('[LEGACY_PLANNER_REDIRECT]')));
    assert.ok(logs.some(line => line.includes('[LEGACY_DEPRECATED]')));
    assert.equal(result.tasks.some(task => task.kind === 'CODING'), false);
  } finally {
    restore();
  }
});

test('Phase 4.29: proposal promotion delegates to ExecutionPlanner', () => {
  const { logs, restore } = captureLogs();
  try {
    const result = promoteProposalGraphToTasks({
      proposals: [
        {
          proposalId: 'proposal-1',
          proposalType: 'FILE',
          suggestedFiles: ['src/App.js'],
          authority: { source: 'bootstrap_proposal' },
          metadata: { contentByFile: { 'src/App.js': 'export default function App() { return null; }' } }
        }
      ]
    }, {
      objective: 'Create src/App.js.',
      workspaceState: { existingFiles: [], scan: { projectType: 'react' } },
      projectScan: { projectType: 'react' },
      plannerPolicies: { ALLOW_PROJECT_BOOTSTRAP: false },
      verifiedPlanningContext: createPlanningContext()
    });

    assert.ok(result.executionPlanner);
    assert.ok(logs.some(line => line.includes('[LEGACY_PLANNER_REDIRECT]')));
    assert.ok(logs.some(line => line.includes('[LEGACY_DEPRECATED]')));
  } finally {
    restore();
  }
});

test('Phase 4.29: legacy task expansion stays isolated behind ExecutionPlanner', () => {
  const planner = new Planner([
    new Task({
      id: 'root',
      kind: 'REASONING',
      goal: 'Create a landing page',
      tool: null,
      dependencies: []
    })
  ]);
  planner.executionPlanner = createExecutionPlanner({
    objective: 'Create src/math.js and src/math.test.js.',
    verifiedPlanningContext: createPlanningContext(),
    canonicalFileUniverse: [],
    plannerPolicies: { ALLOW_PROJECT_BOOTSTRAP: false },
    projectIntent: { goalType: 'LIBRARY' },
    projectScan: { projectType: 'node' }
  });

  const { logs, restore } = captureLogs();
  try {
    const expanded = expandPlannerTasks(planner, {
      goal: 'Create a landing page',
      projectType: 'react',
      entryFiles: ['src/App.js'],
      scan: { projectType: 'react' },
      contextFiles: ['src/App.js'],
      fileContents: new Map()
    });

    assert.deepEqual(expanded, []);
    assert.ok(logs.some(line => line.includes('[LEGACY_PLANNER_REDIRECT]')));
    assert.ok(logs.some(line => line.includes('[LEGACY_DEPRECATED]')));
  } finally {
    restore();
  }
});

test('Phase 4.29: legacy execution planner wrapper delegates to canonical planner', async () => {
  const { logs, restore } = captureLogs();
  try {
    const result = await buildExecutionPlan({
      prompt: 'Create src/math.js and src/math.test.js.',
      workspaceState: { existingFiles: [], workspaceRoot: '' },
      projectScan: { projectType: 'node' },
      projectIntent: { goalType: 'LIBRARY' },
      plannerPolicies: { ALLOW_PROJECT_BOOTSTRAP: false },
      verifiedPlanningContext: createPlanningContext(),
      canonicalFileUniverse: []
    });

    assert.ok(result.executionPlanner);
    assert.ok(logs.some(line => line.includes('[LEGACY_PLANNER_REDIRECT]')));
    assert.ok(logs.some(line => line.includes('[LEGACY_DEPRECATED]')));
  } finally {
    restore();
  }
});
