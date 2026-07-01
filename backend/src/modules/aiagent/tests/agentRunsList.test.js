import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import AgentRun from "../../../models/AgentRun.js";
import { getAgentRuns } from "../aiagent.controller.js";

function mockRes() {
  return {
    statusCode: 200,
    payload: null,
    json(value) {
      this.payload = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    }
  };
}

test("agent runs list endpoint returns sparse recent runs and supports taskId filter", async () => {
  const originalAggregate = AgentRun.aggregate;
  let capturedPipeline = null;
  let allowDiskUseCalled = false;
  AgentRun.aggregate = (pipeline) => {
    capturedPipeline = pipeline;
    return {
      allowDiskUse(flag) {
        allowDiskUseCalled = flag;
        return Promise.resolve([
          {
            _id: "run-1",
            taskId: "task-1",
            status: "completed",
            createdAt: "2026-06-29T00:00:00.000Z",
            updatedAt: "2026-06-29T00:01:00.000Z",
            hasPlannerDebugSnapshot: true
          },
          {
            _id: "run-2",
            taskId: "task-2",
            status: "needs_revision",
            createdAt: "2026-06-29T00:02:00.000Z",
            updatedAt: "2026-06-29T00:03:00.000Z",
            hasPlannerDebugSnapshot: false
          }
        ]);
      }
    };
  };

  try {
    const res = mockRes();
    await getAgentRuns({ query: { taskId: "task-1", limit: "20" } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    assert.ok(Array.isArray(capturedPipeline), "aggregate pipeline must be captured");
    assert.deepEqual(capturedPipeline[0], { $match: { taskId: "task-1" } });
    assert.deepEqual(capturedPipeline[1], { $sort: { _id: -1 } });
    assert.deepEqual(capturedPipeline[2], { $limit: 20 });
    assert.equal(allowDiskUseCalled, true, "aggregate query must opt into disk use for sorting");
    assert.equal(res.payload.data.length, 2);
    assert.deepEqual(res.payload.data[0], {
      id: "run-1",
      taskId: "task-1",
      status: "completed",
      success: true,
      createdAt: "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:01:00.000Z",
      hasPlannerDebugSnapshot: true
    });
    assert.equal(res.payload.data[1].success, false);
    assert.equal(res.payload.data[1].hasPlannerDebugSnapshot, false);
  } finally {
    AgentRun.aggregate = originalAggregate;
  }
});

test("planner debug HTML uses the sparse recent-runs endpoint", async () => {
  const html = await fs.readFile(path.resolve(process.cwd(), "generated/planner-debug.html"), "utf8");

  assert.ok(html.includes("api/ai/agent-runs"), "planner debug HTML must call the recent-runs endpoint");
  assert.ok(html.includes("taskId"), "planner debug HTML must support taskId filtering");
});
