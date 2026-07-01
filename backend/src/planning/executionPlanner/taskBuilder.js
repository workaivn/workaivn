import { toArray, toPosix, unique, collectPathLike, scoreToConfidence } from "./utils.js";
import { EXECUTION_TASK_KIND, EXECUTION_TASK_STATUS } from "./types.js";

function pushRecord(records, seen, record) {
  const path = toPosix(record.path || record.targetPath || record.file || record.entryPoint || record.sourcePath || "");
  const operation = String(record.operation || record.action || record.kind || "").trim().toUpperCase();
  const key = `${path.toLowerCase()}::${operation}`;
  if (!path || seen.has(key)) return;
  seen.add(key);
  records.push({ ...record, path });
}

function collectRecordsFromEntries(entries = [], { source, operation, confidence }) {
  const records = [];
  const seen = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry) continue;
    if (typeof entry === "string") {
      pushRecord(records, seen, { path: entry, source, operation, confidence });
      continue;
    }
    const path = collectPathLike(entry);
    if (!path) continue;
    pushRecord(records, seen, {
      ...entry,
      path,
      source: entry.source || source,
      operation: String(entry.operation || entry.action || operation || "").trim().toUpperCase(),
      confidence: entry.confidence ?? confidence
    });
  }
  return records;
}

export function collectExecutionEvidence({
  blueprint = null,
  componentTree = null,
  dependencyGraph = null,
  uiPlan = null,
  knowledgeGraph = null,
  impactAnalysis = null
} = {}) {
  const records = [];
  records.push(...collectRecordsFromEntries(blueprint?.filePlan || [], { source: "blueprint.filePlan", operation: "UPDATE_FILE", confidence: 0.95 }));
  records.push(...collectRecordsFromEntries(blueprint?.scaffoldPlan || [], { source: "blueprint.scaffoldPlan", operation: "CREATE_FILE", confidence: 0.92 }));
  records.push(...collectRecordsFromEntries(impactAnalysis?.affectedFiles || [], { source: "impactAnalysis", operation: "UPDATE_FILE", confidence: 0.9 }));

  const componentEntries = Array.isArray(componentTree?.components) ? componentTree.components : [];
  for (const component of componentEntries) {
    const path = toPosix(component.path || component.targetPath || component.file || component.entryPoint || component.sourcePath || "");
    if (path) {
      pushRecord(records, new Set(records.map(record => `${record.path.toLowerCase()}::${String(record.operation || "").toUpperCase()}`)), {
        ...component,
        path,
        source: "componentTree",
        operation: "READ_FILE",
        confidence: 0.8
      });
    } else if (component?.name) {
      pushRecord(records, new Set(records.map(record => `${record.path.toLowerCase()}::${String(record.operation || "").toUpperCase()}`)), {
        path: component.name,
        source: "componentTree",
        operation: "SEARCH_FILES",
        confidence: 0.7
      });
    }
  }

  const dependencyEntries = Array.isArray(dependencyGraph?.nodes) ? dependencyGraph.nodes : [];
  for (const node of dependencyEntries.slice(0, 50)) {
    const path = toPosix(node.path || node.targetPath || node.file || node.entryPoint || node.sourcePath || "");
    if (!path) continue;
    pushRecord(records, new Set(records.map(record => `${record.path.toLowerCase()}::${String(record.operation || "").toUpperCase()}`)), {
      ...node,
      path,
      source: "dependencyGraph",
      operation: node.operation || "READ_FILE",
      confidence: node.confidence ?? 0.78
    });
  }

  const uiEntries = [
    ...(Array.isArray(uiPlan?.pages) ? uiPlan.pages : []),
    ...(Array.isArray(uiPlan?.layouts) ? uiPlan.layouts : []),
    ...(Array.isArray(uiPlan?.widgets) ? uiPlan.widgets : [])
  ];
  for (const entry of uiEntries) {
    const path = toPosix(entry.path || entry.targetPath || entry.file || entry.entryPoint || entry.sourcePath || "");
    if (!path && !entry?.name && !entry?.route) continue;
    pushRecord(records, new Set(records.map(record => `${record.path.toLowerCase()}::${String(record.operation || "").toUpperCase()}`)), {
      ...entry,
      path: path || entry.route || entry.name,
      source: "uiPlan",
      operation: path ? "READ_FILE" : "SEARCH_FILES",
      confidence: 0.72
    });
  }

  const knowledgeEntries = Array.isArray(knowledgeGraph?.nodes) ? knowledgeGraph.nodes : [];
  for (const node of knowledgeEntries.slice(0, 50)) {
    const path = toPosix(node.path || node.targetPath || node.file || node.entryPoint || node.sourcePath || "");
    if (!path) continue;
    pushRecord(records, new Set(records.map(record => `${record.path.toLowerCase()}::${String(record.operation || "").toUpperCase()}`)), {
      ...node,
      path,
      source: "knowledgeGraph",
      operation: node.operation || "READ_FILE",
      confidence: node.confidence ?? 0.76
    });
  }

  return unique(records.map(record => JSON.stringify(record))).map(text => JSON.parse(text));
}

function buildTaskBase({ id, kind, tool, toolArgs, reason, dependsOn, expectedOutput, validation, retryPolicy, priority, risk, source, evidence, confidence, critical = true }) {
  return {
    id,
    kind,
    tool,
    toolArgs: toolArgs || {},
    reason: reason || "",
    dependsOn: unique((dependsOn || []).map(value => String(value || "").trim()).filter(Boolean)),
    expectedOutput: expectedOutput || {},
    validation: validation || {},
    retryPolicy: retryPolicy || { maxAttempts: 2, backoff: "deterministic" },
    status: EXECUTION_TASK_STATUS.PENDING,
    priority: priority ?? 50,
    risk: risk || "unknown",
    source: source || "inference",
    evidence: Array.isArray(evidence) ? evidence : [],
    confidence: confidence ?? 0.6,
    critical
  };
}

function mergeEvidence(existing = [], incoming = []) {
  return unique([
    ...toArray(existing).map(item => JSON.stringify(item)),
    ...toArray(incoming).map(item => JSON.stringify(item))
  ]).map(text => JSON.parse(text));
}

function parentDir(value = "") {
  const normalized = toPosix(value);
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return ".";
  return normalized.slice(0, index);
}

function inferOperation(record = {}, existingFiles = []) {
  const existing = new Set((Array.isArray(existingFiles) ? existingFiles : []).map(file => toPosix(file).toLowerCase()));
  const path = toPosix(record.path || record.targetPath || record.file || "");
  const op = String(record.operation || record.action || "").toUpperCase();
  if (op.includes("DELETE")) return "DELETE_FILE";
  if (op.includes("RENAME")) return "RENAME_FILE";
  if (op.includes("UPDATE") || op.includes("PATCH") || op.includes("MODIFY")) return existing.has(path.toLowerCase()) ? "APPLY_PATCH" : "WRITE_FILE";
  if (op.includes("CREATE")) return "WRITE_FILE";
  if (existing.has(path.toLowerCase())) return "APPLY_PATCH";
  return "WRITE_FILE";
}

function collectAllowedPaths(records = []) {
  const allowed = new Set();
  for (const record of records) {
    const path = toPosix(record.path || record.targetPath || record.file || record.route || record.name || "");
    if (!path) continue;
    allowed.add(path.toLowerCase());
    allowed.add(parentDir(path).toLowerCase());
  }
  return allowed;
}

function createImplementationTasks(records = [], context = {}) {
  const existingFiles = Array.isArray(context.workspaceState?.existingFiles) ? context.workspaceState.existingFiles : [];
  const inspectId = context.workspaceState?.workspaceRoot ? `inspect:${context.workspaceState.workspaceRoot}` : `inspect:workspace`;
  const tasks = [];
  const taskMap = new Map();
  const upsertTask = task => {
    const existing = taskMap.get(task.id);
    if (existing) {
      existing.dependsOn = unique([...(existing.dependsOn || []), ...(task.dependsOn || [])]);
      existing.evidence = mergeEvidence(existing.evidence, task.evidence);
      existing.confidence = Math.max(Number(existing.confidence || 0), Number(task.confidence || 0));
      existing.priority = Math.max(Number(existing.priority || 0), Number(task.priority || 0));
      return existing;
    }
    taskMap.set(task.id, task);
    tasks.push(task);
    return task;
  };

  upsertTask(buildTaskBase({
      id: inspectId,
      kind: EXECUTION_TASK_KIND.INSPECT,
      tool: "LIST_FILES",
      toolArgs: { path: "." },
      reason: "Inspect workspace before executing verified file operations",
      dependsOn: [],
      expectedOutput: { workspaceInventory: true },
      validation: { type: "workspace-inspection" },
      priority: 100,
      risk: "low",
      source: "workspace-inspect",
      evidence: [{ type: "workspaceRoot", value: context.workspaceState?.workspaceRoot || "" }],
      confidence: 0.9
    }));

  const seenParentTasks = new Set();
  const seenReadTasks = new Set();

  for (const record of records) {
    const path = toPosix(record.path || record.targetPath || record.file || "");
    if (!path) continue;
    const operation = inferOperation(record, existingFiles);
    const parent = parentDir(path);
    const isExisting = new Set(existingFiles.map(file => toPosix(file).toLowerCase())).has(path.toLowerCase());
    const sourceEvidence = [{ type: record.source || "artifact", value: record }];

    if (operation === "WRITE_FILE" && parent && parent !== "." && !seenParentTasks.has(parent.toLowerCase())) {
      const parentTaskId = `inspect:${parent}`;
      upsertTask(buildTaskBase({
        id: parentTaskId,
        kind: EXECUTION_TASK_KIND.INSPECT,
        tool: "LIST_FILES",
        toolArgs: { path: parent },
        reason: `Verify parent path for ${path}`,
        dependsOn: [inspectId],
        expectedOutput: { directory: parent },
        validation: { type: "parent-path-exists", path: parent },
        priority: 95,
        risk: "low",
        source: record.source || "artifact",
        evidence: sourceEvidence,
        confidence: scoreToConfidence(Number(record.confidence ?? 0.75))
      }));
      seenParentTasks.add(parent.toLowerCase());
    }

    if ((operation === "APPLY_PATCH" || operation === "RENAME_FILE" || operation === "DELETE_FILE") && !seenReadTasks.has(path.toLowerCase())) {
      upsertTask(buildTaskBase({
        id: `read:${path}`,
        kind: EXECUTION_TASK_KIND.READ,
        tool: "READ_FILE",
        toolArgs: { path },
        reason: `Read existing file before ${operation.toLowerCase().replace("_file", "")}`,
        dependsOn: [inspectId],
        expectedOutput: { path, exists: true },
        validation: { type: "read-before-write", path },
        priority: 90,
        risk: "medium",
        source: record.source || "artifact",
        evidence: sourceEvidence,
        confidence: scoreToConfidence(Number(record.confidence ?? 0.8))
      }));
      seenReadTasks.add(path.toLowerCase());
    }

    const tool = operation === "APPLY_PATCH" ? "APPLY_PATCH" : "WRITE_FILE";
    const kind = operation === "APPLY_PATCH" ? EXECUTION_TASK_KIND.MODIFY : operation === "RENAME_FILE" ? EXECUTION_TASK_KIND.RENAME : operation === "DELETE_FILE" ? EXECUTION_TASK_KIND.DELETE : EXECUTION_TASK_KIND.CREATE;
    const dependencies = [inspectId];
    if ((operation === "APPLY_PATCH" || operation === "RENAME_FILE" || operation === "DELETE_FILE") && seenReadTasks.has(path.toLowerCase())) {
      dependencies.push(`read:${path}`);
    }
    if (operation === "WRITE_FILE" && parent && parent !== "." && seenParentTasks.has(parent.toLowerCase())) {
      dependencies.push(`inspect:${parent}`);
    }

    upsertTask(buildTaskBase({
      id: `${operation.toLowerCase()}:${path}`,
      kind,
      tool,
      toolArgs: { path, file: path, content: record.content || record.expectedContent || null },
      reason: record.reason || `${operation} planned for ${path}`,
      dependsOn: dependencies,
      expectedOutput: { path, operation, source: record.source || "artifact" },
      validation: { type: "file-target", path, operation },
      priority: kind === EXECUTION_TASK_KIND.MODIFY ? 80 : 82,
      risk: operation === "DELETE_FILE" || operation === "RENAME_FILE" ? "high" : "medium",
      source: record.source || "artifact",
      evidence: sourceEvidence,
      confidence: scoreToConfidence(Number(record.confidence ?? 0.7))
    }));
  }

  return {
    tasks,
    allowedPaths: collectAllowedPaths(records),
    inspectId
  };
}

function createValidationTasks(validationPlan = {}, context = {}, implementationTasks = []) {
  const tasks = [];
  const taskMap = new Map();
  const upsertTask = task => {
    const existing = taskMap.get(task.id);
    if (existing) {
      existing.dependsOn = unique([...(existing.dependsOn || []), ...(task.dependsOn || [])]);
      existing.evidence = mergeEvidence(existing.evidence, task.evidence);
      existing.confidence = Math.max(Number(existing.confidence || 0), Number(task.confidence || 0));
      existing.priority = Math.max(Number(existing.priority || 0), Number(task.priority || 0));
      return existing;
    }
    taskMap.set(task.id, task);
    tasks.push(task);
    return task;
  };
  const entries = [
    ...(Array.isArray(validationPlan.commands) ? validationPlan.commands.map(command => ({ type: "command", command })) : []),
    ...(Array.isArray(validationPlan.checks) ? validationPlan.checks.map(check => ({ type: "check", ...check })) : [])
  ];
  const deps = unique((Array.isArray(implementationTasks) ? implementationTasks : []).map(task => task.id).filter(Boolean));
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const id = entry.type === "command" ? `validate:command:${index}:${entry.command}` : `validate:check:${index}:${entry.type}`;
    upsertTask(buildTaskBase({
      id,
      kind: EXECUTION_TASK_KIND.VALIDATE,
      tool: entry.type === "command" ? "RUN_TERMINAL" : "VALIDATE",
      toolArgs: entry.type === "command" ? { command: entry.command } : { ...entry },
      reason: entry.type === "command" ? `Run validation command: ${entry.command}` : `Run validation check: ${entry.type}`,
      dependsOn: deps,
      expectedOutput: { validation: entry },
      validation: { ...entry, required: entry.required !== false },
      priority: 70 - index,
      risk: "medium",
      source: entry.source || "validation",
      evidence: [{ type: "validation", value: entry }],
      confidence: entry.confidence ?? 0.8,
      critical: true
    }));
  }
  if (tasks.length === 0 && implementationTasks.length > 0) {
    upsertTask(buildTaskBase({
      id: "final-validation:file-existence",
      kind: EXECUTION_TASK_KIND.VALIDATE,
      tool: "VALIDATE",
      toolArgs: { type: "file-existence", files: unique((Array.isArray(implementationTasks) ? implementationTasks : []).map(task => String(task.toolArgs?.path || task.toolArgs?.file || task.toolArgs?.target || "").trim()).filter(Boolean)) },
      reason: "Fallback validation based on resolved implementation tasks",
      dependsOn: deps,
      expectedOutput: { validation: { type: "file-existence" } },
      validation: { type: "file-existence", files: unique((Array.isArray(implementationTasks) ? implementationTasks : []).map(task => String(task.toolArgs?.path || task.toolArgs?.file || task.toolArgs?.target || "").trim()).filter(Boolean)) },
      priority: 60,
      risk: "medium",
      source: "validation-fallback",
      evidence: [],
      confidence: 0.6,
      critical: true
    }));
  }
  return tasks;
}

function createFinalTask(dependencies = []) {
  return buildTaskBase({
    id: "final:execution",
    kind: EXECUTION_TASK_KIND.FINALIZE,
    tool: "FINAL",
    toolArgs: {},
    reason: "Finalize execution only after all required implementation and validation tasks complete",
    dependsOn: unique(dependencies),
    expectedOutput: { finalized: true },
    validation: { type: "final-state" },
    priority: 1,
    risk: "low",
    source: "finalization",
    evidence: [],
    confidence: 0.9,
    critical: false
  });
}

export function buildExecutionTasks(input = {}) {
  const evidence = collectExecutionEvidence(input);
  const implementation = createImplementationTasks(evidence, input);
  const validationPlan = input.validationPlan || {};
  const implementationTasks = implementation.tasks.filter(task => task.tool !== "LIST_FILES");
  const validationTasks = createValidationTasks(validationPlan, input, implementationTasks);
  const finalTask = createFinalTask(validationTasks.map(task => task.id));
  const tasks = [...implementation.tasks, ...validationTasks, finalTask];
  return {
    tasks,
    evidence,
    allowedPaths: implementation.allowedPaths,
    inspectId: implementation.inspectId,
    finalTaskId: finalTask.id
  };
}
