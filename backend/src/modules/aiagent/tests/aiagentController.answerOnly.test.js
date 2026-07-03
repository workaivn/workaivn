import test from "node:test";
import assert from "node:assert/strict";

import AiAgent from "../../../models/AiAgent.js";
import AgentRun from "../../../models/AgentRun.js";
import AgentTask from "../../../models/AgentTask.js";
import { runAgentPrompt, runTask } from "../aiagent.controller.js";

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

test("answer-only prompt returns direct text before task/run bootstrap", async () => {
  const originalFindById = AiAgent.findById;
  const originalFindOne = AiAgent.findOne;
  const originalTaskCreate = AgentTask.create;
  const originalRunCreate = AgentRun.create;

  let agentLookupCalled = false;
  let taskCreateCalled = false;
  let runCreateCalled = false;

  AiAgent.findById = () => {
    agentLookupCalled = true;
    throw new Error("agent lookup must not run for answer-only prompts");
  };
  AiAgent.findOne = () => {
    agentLookupCalled = true;
    throw new Error("agent selection must not run for answer-only prompts");
  };
  AgentTask.create = () => {
    taskCreateCalled = true;
    throw new Error("task creation must not run for answer-only prompts");
  };
  AgentRun.create = () => {
    runCreateCalled = true;
    throw new Error("run creation must not run for answer-only prompts");
  };

  try {
    const res = mockRes();
    await runAgentPrompt({ body: { prompt: "1+1=2" } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.data.final, "2");
    assert.equal(res.payload.data.answer, "2");
    assert.equal(res.payload.data.taskMode, "ANSWER_ONLY");
    assert.equal(res.payload.data.workspaceRoot, null);
    assert.equal(agentLookupCalled, false);
    assert.equal(taskCreateCalled, false);
    assert.equal(runCreateCalled, false);
  } finally {
    AiAgent.findById = originalFindById;
    AiAgent.findOne = originalFindOne;
    AgentTask.create = originalTaskCreate;
    AgentRun.create = originalRunCreate;
  }
});

test("answer-only task returns direct text before agent lookup or workspace access", async () => {
  const originalFindById = AgentTask.findById;
  const originalAgentFindById = AiAgent.findById;

  let agentLookupCalled = false;

  AgentTask.findById = async () => ({
    _id: "task-1",
    normalizedPrompt: "1+1=2",
    inputPrompt: "1+1=2",
    status: "draft",
    save: async () => {}
  });
  AiAgent.findById = () => {
    agentLookupCalled = true;
    throw new Error("agent lookup must not run for answer-only tasks");
  };

  try {
    const res = mockRes();
    await runTask({ params: { taskId: "task-1" }, body: { agentId: "agent-1", workspaceId: "workspace-1" } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.data.final, "2");
    assert.equal(res.payload.data.answer, "2");
    assert.equal(res.payload.data.taskMode, "ANSWER_ONLY");
    assert.equal(agentLookupCalled, false);
  } finally {
    AgentTask.findById = originalFindById;
    AiAgent.findById = originalAgentFindById;
  }
});
