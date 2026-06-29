import test from "node:test";
import assert from "node:assert/strict";
import {
  createPlannerMetrics,
  summarizePlannerMetrics,
  updatePlannerMetricsFromTask,
  updatePlannerMetricsFromToolCall
} from "../planner/plannerMetrics.js";

test("createPlannerMetrics initializes expected counters", () => {
  const metrics = createPlannerMetrics();
  const summary = summarizePlannerMetrics(metrics);

  assert.deepEqual(summary, {
    plannerTasksTotal: 0,
    plannerTasksReady: 0,
    plannerTasksRunning: 0,
    plannerTasksCompleted: 0,
    plannerTasksFailed: 0,
    plannerRecoveryTasks: 0,
    plannerRetries: 0,
    plannerLoopCount: 0,
    plannerStuckCount: 0,
    validationCommandsRun: 0,
    validationCommandsPassed: 0,
    validationCommandsFailed: 0,
    finalizerStatus: null,
    lastPlannerTaskType: null,
    lastPlannerTaskTool: null,
    lastPlannerTaskPath: null,
    lastValidationCommand: null,
    lastValidationExitCode: null
  });
});

test("completed task increments plannerTasksCompleted", () => {
  const metrics = createPlannerMetrics();
  const task = { id: "t1", kind: "CODING", tool: "WRITE_FILE", toolArgs: { path: "src/app.js" } };

  updatePlannerMetricsFromTask(metrics, task, { event: "completed" });

  const summary = summarizePlannerMetrics(metrics);
  assert.equal(summary.plannerTasksTotal, 1);
  assert.equal(summary.plannerTasksCompleted, 1);
  assert.equal(summary.plannerTasksFailed, 0);
  assert.equal(summary.lastPlannerTaskTool, "WRITE_FILE");
  assert.equal(summary.lastPlannerTaskPath, "src/app.js");
});

test("failed task increments plannerTasksFailed", () => {
  const metrics = createPlannerMetrics();
  const task = { id: "t2", kind: "CODING", tool: "RUN_TERMINAL", toolArgs: { command: "npm test" } };

  updatePlannerMetricsFromTask(metrics, task, { event: "failed" });

  const summary = summarizePlannerMetrics(metrics);
  assert.equal(summary.plannerTasksTotal, 1);
  assert.equal(summary.plannerTasksFailed, 1);
  assert.equal(summary.plannerTasksCompleted, 0);
});

test("recovery task increments plannerRecoveryTasks", () => {
  const metrics = createPlannerMetrics();
  const task = { id: "r1", kind: "RECOVERY", tool: "READ_FILE", toolArgs: { path: "src/app.js" } };

  updatePlannerMetricsFromTask(metrics, task, { event: "created" });

  const summary = summarizePlannerMetrics(metrics);
  assert.equal(summary.plannerTasksTotal, 1);
  assert.equal(summary.plannerRecoveryTasks, 1);
  assert.equal(summary.lastPlannerTaskType, "RECOVERY");
});

test("RUN_TERMINAL validation success updates validation counters", () => {
  const metrics = createPlannerMetrics();
  updatePlannerMetricsFromToolCall(metrics, {
    tool: "RUN_TERMINAL",
    args: { command: "npm test -- plannerPhase419" },
    success: true,
    result: { exitCode: 0 }
  }, {
    requiredCommands: ["npm test -- plannerPhase419"]
  });

  const summary = summarizePlannerMetrics(metrics);
  assert.equal(summary.validationCommandsRun, 1);
  assert.equal(summary.validationCommandsPassed, 1);
  assert.equal(summary.validationCommandsFailed, 0);
  assert.equal(summary.lastValidationCommand, "npm test -- plannerPhase419");
  assert.equal(summary.lastValidationExitCode, 0);
});

test("RUN_TERMINAL validation failure updates validation counters", () => {
  const metrics = createPlannerMetrics();
  updatePlannerMetricsFromToolCall(metrics, {
    tool: "RUN_TERMINAL",
    args: { command: "npm test -- plannerPhase420Metrics" },
    success: false,
    result: { exitCode: 1 }
  }, {
    requiredCommands: ["npm test -- plannerPhase420Metrics"]
  });

  const summary = summarizePlannerMetrics(metrics);
  assert.equal(summary.validationCommandsRun, 1);
  assert.equal(summary.validationCommandsPassed, 0);
  assert.equal(summary.validationCommandsFailed, 1);
  assert.equal(summary.lastValidationCommand, "npm test -- plannerPhase420Metrics");
  assert.equal(summary.lastValidationExitCode, 1);
});

test("summarizePlannerMetrics returns plain JSON only", () => {
  const metrics = createPlannerMetrics();
  updatePlannerMetricsFromTask(metrics, {
    id: "t3",
    kind: "CODING",
    tool: "READ_FILE",
    toolArgs: { path: "package.json" }
  }, { event: "started", attempts: 2 });
  metrics.finalizerStatus = "PASS";

  const summary = summarizePlannerMetrics(metrics);
  const roundTrip = JSON.parse(JSON.stringify(summary));

  assert.deepEqual(roundTrip, summary);
  assert.equal(Object.keys(summary).some((key) => key.startsWith("_")), false);
  assert.equal(summary.plannerRetries, 1);
  assert.equal(summary.finalizerStatus, "PASS");
});
