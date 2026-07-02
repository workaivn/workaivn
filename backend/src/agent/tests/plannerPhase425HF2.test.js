import test from "node:test";
import assert from "node:assert/strict";

import { promoteProposalGraphToTasks } from "../planner/proposals/index.js";

function baseContext(overrides = {}) {
  return {
    workspaceState: {
      existingFiles: [],
      packageJsonFound: false
    },
    plannerPolicies: {},
    verifiedCommands: [],
    verifiedFiles: [],
    blockedRecommendations: [],
    rejectedAssumptions: [],
    unverifiedPrerequisites: [],
    ...overrides
  };
}

test("Phase 4.25-HF2: rejected scaffold files cannot be promoted into executable tasks", () => {
  const promoted = promoteProposalGraphToTasks({
    proposals: [
      {
        proposalId: "proposal-package",
        proposalType: "PROJECT_STRUCTURE",
        suggestedFiles: ["package.json"],
        source: "runtime-plan"
      }
    ]
  }, baseContext({
    blockedRecommendations: [{ path: "package.json", reason: "File not found in workspace" }]
  }));

  assert.equal(promoted.tasks.length, 0);
  assert.equal(promoted.rejected.length, 1);
  assert.ok(promoted.diagnostics.length > 0);
  assert.equal(promoted.diagnostics[0].type, 'authority_rejection');
});

test("Phase 4.25-HF2: blocked index.html proposals are rejected before task creation", () => {
  const promoted = promoteProposalGraphToTasks({
    proposals: [
      {
        proposalId: "proposal-html",
        proposalType: "PROJECT_STRUCTURE",
        suggestedFiles: ["index.html"],
        source: "runtime-plan"
      }
    ]
  }, baseContext({
    workspaceState: {
      existingFiles: ["src/App.tsx"],
      packageJsonFound: true
    },
    blockedRecommendations: [{ path: "index.html", reason: "File not found in workspace" }]
  }));

  assert.equal(promoted.tasks.length, 0);
  assert.equal(promoted.rejected.length, 1);
});

test("Phase 4.25-HF2: explicit user file creation can override a rejected scaffold assumption", () => {
  const promoted = promoteProposalGraphToTasks({
    proposals: [
      {
        proposalId: "proposal-create-pkg",
        proposalType: "FILE",
        suggestedFiles: ["package.json"],
        authority: { source: "explicit_user_request" },
        metadata: { explicitUserRequest: true }
      }
    ]
  }, baseContext({
    plannerPolicies: { ALLOW_NEW_FILE_CREATION: true },
    blockedRecommendations: [{ path: "package.json", reason: "File not found in workspace" }]
  }));

  assert.equal(promoted.tasks.length, 1);
  assert.equal(promoted.tasks[0].tool, "WRITE_FILE");
  assert.equal(promoted.tasks[0].toolArgs?.path, "package.json");
  assert.equal(promoted.tasks[0].unitType, "WRITE");
  assert.ok(promoted.tasks[0].executionContract != null);
  assert.equal(promoted.tasks[0].approvedByFirewall, true);
  assert.equal(promoted.rejected.length, 0);
});

test("Phase 4.25-HF2: unverified execution and validation commands are rejected", () => {
  const execution = promoteProposalGraphToTasks({
    proposals: [
      {
        proposalId: "proposal-install",
        proposalType: "EXECUTION",
        suggestedCommands: ["npm install"],
        source: "runtime-plan"
      }
    ]
  }, baseContext());

  const validation = promoteProposalGraphToTasks({
    proposals: [
      {
        proposalId: "proposal-validate",
        proposalType: "VALIDATION",
        suggestedCommands: ["npm run build"],
        source: "runtime-plan"
      }
    ]
  }, baseContext());

  assert.equal(execution.tasks.length, 0);
  assert.equal(execution.rejected.length, 1);
  assert.equal(validation.tasks.length, 0);
  assert.equal(validation.rejected.length, 1);
});

test("Phase 4.25-HF2: proposal without authority is rejected and does not become executable task", () => {
  const promoted = promoteProposalGraphToTasks({
    proposals: [
      {
        proposalId: "proposal-optional",
        proposalType: "FEATURE",
        suggestedFiles: ["src/optional.js"],
        required: false
      }
    ]
  }, baseContext());

  assert.equal(promoted.tasks.length, 0);
  assert.equal(promoted.rejected.length, 1);
  assert.equal(promoted.promotedDescriptors.length, 0);
});
