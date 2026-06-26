import test from 'node:test';
import assert from 'node:assert/strict';
import { Task } from '../task.js';
import { Planner } from '../planner.js';
import { TaskStatus, CostCategory } from '../plannerTypes.js';
import {
  estimateForTool,
  calculateCost,
  getDefaultEstimates,
  costBreakdown
} from '../costEstimator.js';
import { buildPlan } from '../planBuilder.js';

// ===================== Test A: READ_FILE cost =====================

test('Test A: READ_FILE cost — LOW category, score around 2-4', () => {
  const { estimates, score, category } = estimateForTool('READ_FILE');

  assert.equal(category, CostCategory.LOW, 'READ_FILE should be LOW cost');
  assert.ok(score >= 2 && score <= 4, `READ_FILE score ${score} should be around 2-4`);

  const task = new Task({
    id: 'read-test',
    kind: 'CODING',
    goal: 'Read file',
    tool: 'READ_FILE',
    toolArgs: { path: 'test.json' }
  });
  const planner = new Planner([task]);
  const node = planner.graph.getNode('read-test');
  assert.equal(node.estimatedCost, score, 'Node estimatedCost should match');
  assert.equal(node.estimatedTime, CostCategory.LOW);
  assert.equal(node.estimatedCPU, CostCategory.LOW);
  assert.equal(node.estimatedRisk, CostCategory.LOW);
});

// ===================== Test B: RUN_TERMINAL cost =====================

test('Test B: RUN_TERMINAL cost — HIGH category, score greater than READ_FILE', () => {
  const readEst = estimateForTool('READ_FILE');
  const termEst = estimateForTool('RUN_TERMINAL');

  assert.equal(termEst.category, CostCategory.VERY_HIGH,
    'RUN_TERMINAL should be VERY_HIGH cost');
  assert.ok(termEst.score > readEst.score,
    `RUN_TERMINAL score ${termEst.score} should be > READ_FILE score ${readEst.score}`);

  const task = new Task({
    id: 'run-test',
    kind: 'CODING',
    goal: 'Run command',
    tool: 'RUN_TERMINAL',
    toolArgs: { command: 'npm test' }
  });
  const planner = new Planner([task]);
  const node = planner.graph.getNode('run-test');
  assert.equal(node.estimatedCost, termEst.score);
  assert.equal(node.estimatedTime, CostCategory.HIGH);
  assert.equal(node.estimatedCPU, CostCategory.HIGH);
  assert.equal(node.estimatedRisk, CostCategory.HIGH);
});

// ===================== Test C: Priority ordering =====================

test('Test C: Priority ordering — RUN_TERMINAL before APPLY_PATCH before READ_FILE', () => {
  const readTask = new Task({
    id: 'read-file',
    kind: 'CODING',
    goal: 'Read file',
    tool: 'READ_FILE',
    toolArgs: { path: 'data.json' }
  });
  const patchTask = new Task({
    id: 'apply-patch',
    kind: 'CODING',
    goal: 'Apply patch',
    tool: 'APPLY_PATCH',
    toolArgs: { file: 'data.json' }
  });
  const runTask = new Task({
    id: 'run-term',
    kind: 'CODING',
    goal: 'Run tests',
    tool: 'RUN_TERMINAL',
    toolArgs: { command: 'npm test' }
  });

  const planner = new Planner([readTask, patchTask, runTask]);

  // Phase 4.10: getNextTask uses priority-based ordering (not cost)
  const first = planner.getNextTask();
  assert.equal(first.id, 'run-term',
    'getNextTask should return highest priority task: RUN_TERMINAL (100)');
});

// ===================== Test D: Parallel group cost =====================

test('Test D: Parallel group cost — three READ_FILE tasks', () => {
  const task1 = new Task({
    id: 'read-a',
    kind: 'CODING',
    goal: 'Read a.json',
    tool: 'READ_FILE',
    toolArgs: { path: 'a.json' }
  });
  const task2 = new Task({
    id: 'read-b',
    kind: 'CODING',
    goal: 'Read b.json',
    tool: 'READ_FILE',
    toolArgs: { path: 'b.json' }
  });
  const task3 = new Task({
    id: 'read-c',
    kind: 'CODING',
    goal: 'Read c.json',
    tool: 'READ_FILE',
    toolArgs: { path: 'c.json' }
  });

  const planner = new Planner([task1, task2, task3]);

  // Verify total plan cost
  const total = planner.totalPlanCost();
  assert.equal(total.taskCount, 3, 'Total plan cost should include 3 tasks');
  assert.ok(total.totalScore > 0, 'Total cost should be positive');

  // Verify parallel group cost
  const groups = planner.findParallelReadyTasks();
  assert.equal(groups.length, 1, 'Three same-tool tasks should form one parallel group');
  assert.equal(groups[0].length, 3, 'Group should contain all three tasks');

  // Get the parallel group cost
  const group = planner.nextParallelGroup();
  assert.equal(group.length, 3);

  // Verify tasks have estimatedCost set
  for (const t of group) {
    assert.ok(t.estimatedCost > 0, `${t.id} should have a positive estimatedCost`);
    assert.equal(t.estimatedCost, 3, `${t.id} READ_FILE cost should be 3`);
  }
});

// ===================== Test E: Large plan — PLANNER_TOTAL_COST emitted =====================

test('Test E: Large plan — PLANNER_TOTAL_COST emitted before execution', () => {
  const tasks = [];
  for (let i = 0; i < 10; i++) {
    tasks.push(new Task({
      id: `read-${i}`,
      kind: 'CODING',
      goal: `Read file ${i}`,
      tool: 'READ_FILE',
      toolArgs: { path: `file${i}.json` }
    }));
  }
  // Add a higher-cost task
  tasks.push(new Task({
    id: 'run-all',
    kind: 'CODING',
    goal: 'Run all tests',
    tool: 'RUN_TERMINAL',
    toolArgs: { command: 'npm test' },
    dependencies: tasks.map(t => t.id)
  }));

  const planner = new Planner(tasks);

  // totalPlanCost should reflect all 11 tasks
  const total = planner.totalPlanCost();
  assert.equal(total.taskCount, 11, 'Total plan cost should include all 11 tasks');
  assert.ok(total.totalScore > 0, 'Total cost should be positive');

  // 10 READ_FILE (3 each) + 1 RUN_TERMINAL (15) = 45
  assert.equal(total.totalScore, 45, `Total score should be 10*3 + 15 = 45, got ${total.totalScore}`);

  // costBreakdown for individual tasks
  const breakdown = planner.costBreakdown(tasks[0]);
  assert.equal(breakdown.score, 3, 'READ_FILE cost breakdown should show score 3');
  assert.equal(breakdown.category, CostCategory.LOW);

  const runBreakdown = planner.costBreakdown(tasks[10]);
  assert.equal(runBreakdown.score, 15, 'RUN_TERMINAL cost breakdown should show score 15');
  assert.equal(runBreakdown.category, CostCategory.VERY_HIGH);

  // Independent costEstimator functions
  const readEst = estimateForTool('READ_FILE');
  assert.equal(readEst.score, 3);
  assert.equal(readEst.category, CostCategory.LOW);

  const termEst = estimateForTool('RUN_TERMINAL');
  assert.equal(termEst.score, 15);
  assert.equal(termEst.category, CostCategory.VERY_HIGH);

  // Verify getDefaultEstimates
  const estimates = getDefaultEstimates('READ_FILE');
  assert.equal(estimates.time, CostCategory.LOW);
  assert.equal(estimates.cpu, CostCategory.LOW);
  assert.equal(estimates.risk, CostCategory.LOW);

  // Verify calculateCost
  const calc = calculateCost(estimates);
  assert.equal(calc.score, 3);
  assert.equal(calc.category, CostCategory.LOW);

  // Verify costBreakdown
  const breakdown2 = costBreakdown(estimates);
  assert.equal(breakdown2.time, CostCategory.LOW);
  assert.equal(breakdown2.score, 3);
  assert.equal(breakdown2.category, CostCategory.LOW);
});

// ===================== Test F: ANALYSIS kind with requestedFiles =====================

test('Test F: ANALYSIS kind — READ_FILE tasks with cost and ordering', () => {
  // ANALYSIS kind creates READ_FILE tasks for requested files
  const criteria = {
    taskType: 'ANALYSIS',
    requestedFiles: ['package.json', 'src/agent/runAgentLoop.js'],
    requiredCommands: []
  };
  const { tasks } = buildPlan('Read package.json and runAgentLoop.js', criteria);

  // Verify 2 READ_FILE tasks (no RUN_TERMINAL — requiredCommands handled by runAgentLoop)
  assert.equal(tasks.length, 2, 'Should create 2 READ_FILE tasks');
  const readTasks = tasks.filter(t => t.tool === 'READ_FILE');
  assert.equal(readTasks.length, 2, 'Should create 2 READ_FILE tasks');
  assert.equal(readTasks[0].kind, 'ANALYSIS', 'Task kind should be ANALYSIS');

  // Create planner from tasks — PLANNER_TOTAL_COST emitted in constructor
  const planner = new Planner(tasks);

  // All tasks have estimatedCost and estimatedCategory
  for (const task of tasks) {
    const node = planner.graph.getNode(task.id);
    assert.ok(node.estimatedCost > 0, `${task.id} should have estimatedCost`);
    assert.ok(node.estimatedCategory, `${task.id} should have estimatedCategory`);
    assert.ok(node.estimatedRisk, `${task.id} should have estimatedRisk`);
  }

  // Both READ_FILE tasks are READY
  const readNode1 = planner.graph.getNode(readTasks[0].id);
  const readNode2 = planner.graph.getNode(readTasks[1].id);
  assert.equal(readNode1.status, TaskStatus.READY, 'READ_FILE should be READY');
  assert.equal(readNode2.status, TaskStatus.READY, 'READ_FILE should be READY');

  // Verify getNextTask returns READ_FILE first (lowest cost)
  const first = planner.getNextTask();
  assert.equal(first.tool, 'READ_FILE', 'getNextTask should return READ_FILE first');

  // Total cost should include both tasks
  const total = planner.totalPlanCost();
  assert.equal(total.taskCount, 2, 'Total cost should include 2 tasks');
  assert.equal(total.totalScore, 6, `Total score should be 2*3 = 6, got ${total.totalScore}`);
});
