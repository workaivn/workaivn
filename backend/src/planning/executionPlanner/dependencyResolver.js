import { unique, normalizePath, toPosix } from "./utils.js";

function parentDir(value = "") {
  const normalized = toPosix(value);
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return ".";
  return normalized.slice(0, index);
}

export function resolveExecutionDependencies(tasks = [], { workspaceState = {} } = {}) {
  const nodes = (Array.isArray(tasks) ? tasks : []).map(task => ({
    ...task,
    dependsOn: unique((Array.isArray(task.dependsOn) ? task.dependsOn : []).map(dep => String(dep || "").trim()).filter(Boolean))
  }));

  const byPath = new Map();
  const byId = new Map(nodes.map(task => [task.id, task]));
  const dependencies = [];

  const register = (from, to, reason) => {
    if (!from || !to || from === to) return;
    const task = byId.get(to);
    if (!task) return;
    if (!task.dependsOn.includes(from)) task.dependsOn.push(from);
    dependencies.push({ from, to, reason });
  };

  for (const task of nodes) {
    const path = normalizePath(task.toolArgs?.path || task.toolArgs?.file || task.toolArgs?.target || "");
    if (path) byPath.set(path, task.id);
  }

  const inspectTask = nodes.find(task => task.tool === "LIST_FILES" && (String(task.toolArgs?.path || "").trim() === "." || String(task.toolArgs?.path || "").trim() === workspaceState.workspaceRoot || !task.toolArgs?.path));

  for (const task of nodes) {
    if (inspectTask && task.id !== inspectTask.id && task.tool !== "LIST_FILES") {
      register(inspectTask.id, task.id, "workspace-inspect");
    }

    const path = normalizePath(task.toolArgs?.path || task.toolArgs?.file || task.toolArgs?.target || "");
    if (!path) continue;

    if (task.tool === "APPLY_PATCH" || task.tool === "WRITE_FILE") {
      const readTask = nodes.find(candidate =>
        candidate.tool === "READ_FILE" &&
        normalizePath(candidate.toolArgs?.path || candidate.toolArgs?.file || "") === path
      );
      if (readTask) register(readTask.id, task.id, "read-before-write");
      if (task.tool === "WRITE_FILE") {
        const parent = parentDir(path);
        const listTask = nodes.find(candidate => candidate.tool === "LIST_FILES" && normalizePath(candidate.toolArgs?.path || candidate.toolArgs?.target || "") === normalizePath(parent));
        if (listTask) register(listTask.id, task.id, "parent-path-verified");
      }
    }

    if (task.tool === "VALIDATE" || task.tool === "RUN_TERMINAL" || task.tool === "FINAL") {
      for (const source of nodes) {
        if (source.id === task.id) continue;
        if (source.tool === "FINAL") continue;
        if (source.status === "DONE" || source.status === "SKIPPED") continue;
        if (!["VALIDATE", "RUN_TERMINAL", "FINAL"].includes(source.tool)) {
          register(source.id, task.id, "implementation-before-validation");
        }
      }
    }
  }

  return {
    tasks: nodes,
    dependencies: unique(dependencies.map(edge => JSON.stringify(edge))).map(text => JSON.parse(text))
  };
}
