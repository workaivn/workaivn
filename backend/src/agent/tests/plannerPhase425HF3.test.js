import test from "node:test";
import assert from "node:assert/strict";

import { createProjectScanSnapshot } from "../context/ProjectScanSnapshot.js";
import { validateContextConsistency } from "../context/ContextConsistencyValidator.js";
import { buildPlanningContext } from "../planner/context/PlanningContextBuilder.js";
import { expandPlannerTasks } from "../planner/taskExpander.js";
import { Planner } from "../planner/planner.js";
import { Task } from "../planner/task.js";

test("Phase 4.25-HF3: ProjectScanSnapshot is immutable and preserves scan facts", () => {
  const snapshot = createProjectScanSnapshot({
    workspaceRoot: "C:/workspace",
    projectType: "vite-react",
    packageJsonFound: true,
    packageManager: "npm",
    entryFiles: ["src/App.tsx", "src/main.tsx"],
    buildCommands: ["npm run build"],
    runCommands: ["npm run dev"]
  });

  assert.equal(snapshot.packageJsonFound, true);
  assert.equal(snapshot.projectType, "vite-react");
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.entryFiles), true);
  assert.throws(() => {
    snapshot.packageJsonFound = false;
  });
});

test("Phase 4.25-HF3: PlanningContext preserves immutable scan facts while deriving verified context", () => {
  const facts = createProjectScanSnapshot({
    workspaceRoot: "C:/workspace",
    projectType: "vite-react",
    packageJsonFound: true,
    packageManager: "npm",
    entryFiles: ["src/App.tsx"],
    buildCommands: ["npm run build"],
    runCommands: ["npm run dev"]
  });

  const { context, validation, snapshot } = buildPlanningContext({
    workspaceState: { existingFiles: ["package.json", "src/App.tsx"], packageJsonFound: true },
    projectScan: facts,
    validatedAssumptions: []
  });

  assert.equal(validation.valid, true);
  assert.equal(context.facts.packageJsonFound, true);
  assert.equal(context.packageJsonFound, true);
  assert.equal(snapshot.facts.packageJsonFound, true);
  assert.equal(snapshot.derived.verifiedPackageManager, "npm");
  assert.ok(context.verifiedCommands.includes("npm run build"));
});

test("Phase 4.25-HF3: Context consistency rejects verified commands when package facts are false", () => {
  const report = validateContextConsistency({
    facts: createProjectScanSnapshot({
      workspaceRoot: "C:/workspace",
      projectType: "generic",
      packageJsonFound: false,
      buildCommands: []
    }),
    context: {
      packageJsonFound: false,
      verifiedCommands: ["npm run build"],
      verifiedFiles: [],
      blockedRecommendations: [],
      plannerPolicies: {}
    }
  });

  assert.equal(report.valid, false);
  assert.ok(report.violations.some(v => String(v.reason || "").includes("packageJsonFound is false")));
});

test("Phase 4.25-HF3: reasoning selector prefers ProjectScan entry files and emits scan confirmation", () => {
  const planner = new Planner([
    new Task({
      id: "root",
      kind: "REASONING",
      goal: "Create a landing page",
      tool: null,
      dependencies: []
    })
  ]);

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.map(item => typeof item === "string" ? item : JSON.stringify(item)).join(" "));
  };

  try {
    const expanded = expandPlannerTasks(planner, {
      goal: "Create a landing page",
      projectType: "react",
      entryFiles: ["src/App.tsx"],
      scan: {
        entryFiles: ["src/App.tsx"],
        buildCommands: ["npm run build"],
        runCommands: ["npm run dev"]
      },
      contextFiles: ["src/App.tsx"],
      fileContents: new Map()
    });

    assert.ok(Array.isArray(expanded));
    assert.ok(expanded.length > 0);
    assert.ok(logs.some(line => line.includes("REASONING_TARGET_CANONICAL_SELECTED")), JSON.stringify(logs));
  } finally {
    console.log = originalLog;
  }
});
