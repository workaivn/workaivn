import test from "node:test";
import assert from "node:assert/strict";
import AgentRun from "../../../models/AgentRun.js";
import { getAgentRun } from "../aiagent.controller.js";

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

test("agent run detail rejects invalid runId before querying MongoDB", async () => {
  const originalFindById = AgentRun.findById;
  let findByIdCalled = false;

  AgentRun.findById = () => {
    findByIdCalled = true;
    throw new Error("findById should not be called for invalid runId");
  };

  try {
    const res = mockRes();
    await getAgentRun({ params: { runId: "not-a-valid-object-id" } }, res);

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.payload, { success: false, error: "Invalid runId" });
    assert.equal(findByIdCalled, false);
  } finally {
    AgentRun.findById = originalFindById;
  }
});
