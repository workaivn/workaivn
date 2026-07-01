import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildFeatureBlueprint } from "./featureBlueprint/index.js";
import {
  analyzeRisk,
  buildExecutionPlan,
  canFinalizeExecution,
  guardScope,
  loadExecutionPlan,
  planRetry,
  planValidationCommands,
  resolveTaskOrder,
  serializeExecutionPlan,
  summarizeExecutionPlan,
  updateTaskStatus,
  validateTaskGraph,
  buildTaskGraph
} from "./executionPlanner/index.js";

async function makeWorkspace(structure = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workai-execution-planner-"));
  for (const [relativePath, content] of Object.entries(structure)) {
    const target = path.join(root, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }
  return root;
}

async function captureLogs(fn) {
  const logs = [];
  const original = console.log;
  console.log = (...args) => {
    logs.push(args.map(value => (typeof value === "string" ? value : JSON.stringify(value))).join(" "));
  };
  try {
    const result = await fn();
    return { result, logs };
  } finally {
    console.log = original;
  }
}

test("execution planner turns a SaaS landing request into a multi-step plan", async () => {
  const workspaceRoot = await makeWorkspace();
  try {
    const blueprint = await buildFeatureBlueprint("Create a SaaS landing page", { workspaceRoot });
    const { result: plan, logs } = await captureLogs(() => buildExecutionPlan({
      prompt: "Create a SaaS landing page",
      workspaceRoot,
      blueprint
    }));

    assert.ok(plan.summary.taskCount > 1, "plan should contain multiple tasks");
    assert.ok(plan.tasks.some(task => task.tool === "WRITE_FILE"), "plan should include write tasks");
    assert.ok(plan.tasks.some(task => task.tool === "RUN_TERMINAL" || task.tool === "VALIDATE"), "plan should include validation");
    assert.equal(plan.tasks[0].tool, "LIST_FILES", "workspace inspection should happen first");
    assert.ok(plan.finalizationRules.some(rule => rule.type === "no-finalization-on-unfinished-graph"));
    assert.ok(logs.some(line => line.includes("[EXECUTION_PLAN_START]")));
    assert.ok(logs.some(line => line.includes("[EXECUTION_PLAN_COMPLETE]")));
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("execution planner reads before patching existing files and keeps validation evidence", async () => {
  const workspaceRoot = await makeWorkspace({
    "src/App.tsx": "export default function App() { return <main />; }",
    "src/components/Button.tsx": "export function Button() { return null; }",
    "package.json": JSON.stringify({ name: "demo", scripts: { build: "vite build" } }, null, 2)
  });

  try {
    const plan = await buildExecutionPlan({
      prompt: "Modify src/App.tsx",
      workspaceRoot,
      workspaceState: {
        workspaceRoot,
        existingFiles: ["src/App.tsx", "src/components/Button.tsx", "package.json"],
        packageJson: { scripts: { build: "vite build" } },
        scan: { packageManager: "bun", buildCommands: ["bun build"] }
      },
      blueprint: {
        filePlan: [
          { path: "src/App.tsx", operation: "UPDATE_FILE", reason: "Adjust App shell" }
        ]
      },
      componentTree: {
        components: [{ path: "src/components/Button.tsx", name: "Button" }]
      },
      dependencyGraph: {
        nodes: [{ path: "src/App.tsx" }],
        edges: [{ from: "src/App.tsx", to: "src/components/Button.tsx" }]
      }
    });

    const readTask = plan.tasks.find(task => task.tool === "READ_FILE" && task.toolArgs?.path === "src/App.tsx");
    const patchTask = plan.tasks.find(task => task.tool === "APPLY_PATCH" && task.toolArgs?.path === "src/App.tsx");
    assert.ok(readTask, "existing file should be read first");
    assert.ok(patchTask, "existing file should be patched");
    assert.ok(patchTask.dependsOn.includes(readTask.id), "patch should depend on the read");
    assert.ok(plan.validation.some(entry => entry.type === "command" && entry.command === "bun build"), "validation should use discovered command evidence");
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("execution planner verifies parent directories before creating new files", async () => {
  const workspaceRoot = await makeWorkspace();
  try {
    const plan = await buildExecutionPlan({
      prompt: "Create src/features/widget.ts",
      workspaceRoot,
      workspaceState: {
        workspaceRoot,
        existingFiles: []
      },
      blueprint: {
        filePlan: [
          { path: "src/features/widget.ts", operation: "CREATE_FILE", reason: "Create widget module" }
        ]
      }
    });

    const parentInspect = plan.tasks.find(task => task.tool === "LIST_FILES" && task.toolArgs?.path === "src/features");
    const writeTask = plan.tasks.find(task => task.tool === "WRITE_FILE" && task.toolArgs?.path === "src/features/widget.ts");
    assert.ok(parentInspect, "parent path should be verified");
    assert.ok(writeTask, "write task should exist");
    assert.ok(writeTask.dependsOn.includes(parentInspect.id), "write should depend on parent verification");
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("validation planning uses discovered commands instead of assuming npm", () => {
  const validation = planValidationCommands({
    workspaceState: {
      packageManager: "bun",
      packageJson: { scripts: { build: "vite build" } },
      scan: { buildCommands: ["bun build"], testCommands: ["bun test"] }
    }
  });

  assert.equal(validation.commands[0], "bun build");
  assert.equal(validation.commands.some(command => command.includes("npm")), false);
});

test("retry planning stays inside failure scope and adds deterministic validation", () => {
  const retry = planRetry({
    failure: {
      error: "Cannot find module lucide-react",
      path: "src/App.tsx",
      retryCommand: "bun add lucide-react"
    }
  });

  assert.ok(retry.tasks.some(task => task.tool === "READ_FILE" && task.toolArgs?.path === "src/App.tsx"));
  assert.ok(retry.tasks.some(task => task.tool === "RUN_TERMINAL" && task.toolArgs?.command === "bun add lucide-react"));
  assert.ok(retry.tasks.some(task => task.tool === "RUN_TERMINAL" && task.reason.includes("Retry validation")));
});

test("circular task graphs are rejected", () => {
  const result = validateTaskGraph({
    nodes: [
      { id: "a", kind: "read", tool: "READ_FILE", dependsOn: ["b"] },
      { id: "b", kind: "modify", tool: "APPLY_PATCH", dependsOn: ["a"] }
    ]
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.type === "cycle"));
});

test("scope guard blocks out-of-scope writes", () => {
  const guarded = guardScope({
    tasks: [
      { id: "write-x", kind: "create", tool: "WRITE_FILE", toolArgs: { path: "src/outside.js" }, status: "PENDING" }
    ],
    summary: {}
  }, {
    allowedPaths: ["src/math.js"]
  });

  assert.equal(guarded.blockedTasks.length, 1);
  assert.equal(guarded.tasks[0].status, "BLOCKED");
});

test("resume and finalization preserve pending tasks until all critical work is done", async () => {
  const workspaceRoot = await makeWorkspace();
  try {
    const plan = await buildExecutionPlan({
      prompt: "Create a static HTML landing page",
      workspaceRoot,
      blueprint: {
        filePlan: [
          { path: "index.html", operation: "CREATE_FILE", reason: "Create entry page" }
        ],
        validation: {
          command: "bun build"
        }
      }
    });

    assert.equal(canFinalizeExecution(plan).canFinalize, false);

    for (const task of plan.tasks) {
      if (task.tool === "FINAL") continue;
      task.status = "DONE";
    }
    const finalState = canFinalizeExecution(plan);
    assert.equal(finalState.canFinalize, true);

    const finalTask = plan.tasks.find(task => task.tool === "FINAL");
    if (finalTask) finalTask.status = "DONE";

    const summary = summarizeExecutionPlan(plan);
    assert.ok(summary.complete);

    const savedPath = await serializeExecutionPlan(plan, { workspaceId: workspaceRoot });
    const loaded = await loadExecutionPlan(workspaceRoot);
    assert.equal(savedPath.endsWith("execution-plan.json"), true);
    assert.equal(loaded.planId, plan.planId);
    assert.ok(Array.isArray(loaded.tasks) && loaded.tasks.length > 0);

    const resumed = typeof structuredClone === "function" ? structuredClone(loaded) : JSON.parse(JSON.stringify(loaded));
    const firstTask = resumed.tasks.find(task => task.tool !== "FINAL");
    const updated = updateTaskStatus(firstTask, "DONE");
    assert.equal(updated.status, "DONE");
    assert.equal(firstTask.status, "DONE");
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("different verified artifacts produce different execution plans for the same prompt", async () => {
  const workspaceRoot = await makeWorkspace();
  try {
    const prompt = "Build the app";
    const planA = await buildExecutionPlan({
      prompt,
      workspaceRoot,
      blueprint: { filePlan: [{ path: "index.html", operation: "CREATE_FILE", reason: "Static site" }] }
    });
    const planB = await buildExecutionPlan({
      prompt,
      workspaceRoot,
      blueprint: { filePlan: [{ path: "src/server.js", operation: "CREATE_FILE", reason: "API server" }] }
    });

    assert.notDeepEqual(
      planA.summary.targetFiles,
      planB.summary.targetFiles,
      "the same prompt should still yield different plans when verified artifacts differ"
    );
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("risk analysis escalates configuration-heavy plans", () => {
  const risk = analyzeRisk({
    tasks: [
      { id: "write-package", kind: "modify", tool: "APPLY_PATCH", toolArgs: { path: "package.json" } }
    ],
    blueprint: {
      filePlan: [{ path: "package.json", operation: "UPDATE_FILE" }]
    }
  });

  assert.equal(risk.riskLevel, "high");
});

test("topological ordering preserves dependencies", () => {
  const graph = buildTaskGraph([
    { id: "read", kind: "read", tool: "READ_FILE", dependsOn: [] },
    { id: "write", kind: "create", tool: "WRITE_FILE", dependsOn: ["read"] },
    { id: "final", kind: "finalize", tool: "FINAL", dependsOn: ["write"] }
  ]);
  const ordered = resolveTaskOrder(graph.nodes);
  assert.deepEqual(ordered.map(task => task.id), ["read", "write", "final"]);
});
