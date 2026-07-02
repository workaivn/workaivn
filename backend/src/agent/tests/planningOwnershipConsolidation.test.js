import test from "node:test";
import assert from "node:assert/strict";
import { buildPlan } from "../planner/planBuilder.js";
import { createBootstrapTaskGraph, detectProjectIntent, resolveBootstrapProfile } from "../projectIntelligence/index.js";
import { promoteProposalGraphToTasks, resolveProposalConflicts } from "../planner/proposals/index.js";

function emptyWorkspaceState(existingFiles = []) {
  return {
    existingFiles,
    hasPackageJson: existingFiles.some(file => file === "package.json"),
    hasIndexPhp: existingFiles.some(file => /(^|\/)index\.php$/i.test(file)),
    hasCsproj: existingFiles.some(file => /\.csproj$/i.test(file)),
    hasLaravel: false,
    hasFastapi: false,
    hasFlask: false,
    hasFlutter: false,
    hasReactVite: existingFiles.some(file => /(^|\/)(vite\.config\.(?:ts|js)|src\/main\.(?:tsx|jsx)|src\/App\.(?:tsx|jsx))$/i.test(file)),
    hasNext: existingFiles.some(file => /(^|\/)(next\.config\.(?:js|ts)|app\/page\.(?:tsx|jsx)|pages\/index\.(?:tsx|jsx))$/i.test(file)),
    hasNodeExpress: existingFiles.some(file => /(^|\/)(src\/server\.js|server\.js)$/i.test(file)),
    hasStaticHtml: existingFiles.some(file => /(^|\/)(index\.html|public\/index\.html)$/i.test(file)),
    scan: { projectType: "generic", packageManager: "npm", entryFiles: [], testCommands: [], buildCommands: [], runCommands: [] }
  };
}

test("bootstrap returns proposals instead of executable tasks", () => {
  const intent = detectProjectIntent("Create a static HTML landing page");
  const workspaceState = emptyWorkspaceState();
  const profile = resolveBootstrapProfile(intent, workspaceState);
  const graph = createBootstrapTaskGraph(profile, {
    objective: intent.objective,
    projectIntent: intent,
    workspaceState
  });

  assert.ok(Array.isArray(graph.proposals));
  assert.equal(Array.isArray(graph.tasks), false);
  assert.ok(graph.proposals.some(proposal => Array.isArray(proposal.proposalTypes) && proposal.proposalTypes.includes("BOOTSTRAP")));
});

test("planner keeps bootstrap proposals as recommendations until verified", () => {
  const intent = detectProjectIntent("Create a new React project");
  const workspaceState = emptyWorkspaceState();
  const profile = resolveBootstrapProfile(intent, workspaceState);
  const plan = buildPlan("Create a new React project", {
    taskType: "CODING",
    bootstrapProfile: profile,
    projectIntent: intent,
    workspaceState
  });

  assert.equal(plan.tasks.some(task => task.tool === "WRITE_FILE" && task.toolArgs?.path === "package.json"), false);
  assert.equal(plan.tasks.some(task => task.tool === "RUN_TERMINAL"), false);
  assert.equal(plan.tasks.some(task => task.tool === "LIST_FILES"), true);
  assert.equal(plan.tasks.length >= 1, true);
});

test("duplicate proposals are merged before promotion", () => {
  const resolved = resolveProposalConflicts([
    { proposalId: "a", proposalType: "FILE", suggestedFiles: ["src/App.tsx"], source: "one" },
    { proposalId: "b", proposalType: "FILE", suggestedFiles: ["src/App.tsx"], source: "two" }
  ]);

  assert.equal(resolved.proposals.length, 1);
});

test("unverified validation proposals are rejected before promotion", () => {
  const promoted = promoteProposalGraphToTasks({
    proposals: [
      { proposalId: "validation-1", proposalType: "VALIDATION", suggestedCommands: ["npm run build"], required: true }
    ]
  }, {
    plannerPolicies: { ALLOW_VALIDATION_DERIVATION: false },
    verifiedCommands: [],
    workspaceState: emptyWorkspaceState()
  });

  assert.equal(promoted.tasks.length, 0);
  assert.equal(promoted.rejected.length, 1);
});
