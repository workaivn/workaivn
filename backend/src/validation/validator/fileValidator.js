import path from 'node:path';

function log(event, data) {
  console.log(`[${event}]`, data);
}

export function validateFileChanges({
  executionPlan = null,
  changedFiles = [],
  workspaceState = {},
  codeGenResults = [],
  taskStates = [],
  knowledgeGraph = null
} = {}) {
  log('VALIDATOR_FILE_CHECK', { changedFilesCount: changedFiles.length });

  const passed = [];
  const failed = [];
  const warnings = [];
  const unexpectedChanges = [];
  const requiredFixes = [];

  const planTasks = executionPlan?.tasks || [];
  const workspaceRoot = workspaceState?.workspaceRoot || '';
  const existingFiles = workspaceState?.existingFiles || [];
  const approvedScope = buildApprovedScope(planTasks, workspaceState);
  const writeTasks = planTasks.filter(t => t.tool === 'WRITE_FILE' || t.kind === 'WRITE_FILE');

  const changedFilePaths = new Set();
  for (const f of changedFiles) {
    const filePath = f.path || f.file || f;
    if (filePath) changedFilePaths.add(normalize(filePath));
  }

  const existingFileSet = new Set(existingFiles.map(normalize));

  const codeGenTargets = new Set();
  for (const r of codeGenResults) {
    const target = r.filePath || r.path || r.file || r.target;
    if (target) codeGenTargets.add(normalize(target));
  }

  for (const task of writeTasks) {
    const filePath = task.toolArgs?.path || task.toolArgs?.file || '';
    if (!filePath) continue;

    const normalizedPath = normalize(filePath);
    const fileExistsInChanges = changedFilePaths.has(normalizedPath);
    const fileExistsInWorkspace = existingFileSet.has(normalizedPath);
    const fileInCodeGen = codeGenTargets.has(normalizedPath);

    if (fileExistsInChanges || fileExistsInWorkspace || fileInCodeGen) {
      passed.push({ id: task.id, message: `Expected file '${filePath}' exists or was created` });
    } else {
      failed.push({ id: task.id, message: `Expected file '${filePath}' not found in changed files, workspace, or code generation results` });
      requiredFixes.push(`File '${filePath}' was expected by plan but is missing from workspace evidence`);
    }

    if (filePath && workspaceRoot && !isWithinWorkspace(filePath, workspaceRoot)) {
      failed.push({ id: task.id, message: `Target path '${filePath}' is outside workspace '${workspaceRoot}'` });
      requiredFixes.push(`Target path '${filePath}' is outside the workspace`);
    }

    if (fileExistsInChanges) {
      const changeEntry = changedFiles.find(f => normalize(f.path || f.file || f) === normalizedPath);
      const content = changeEntry?.content || changeEntry?.result || '';
      if (content !== undefined && content !== null && String(content).trim() === '' && !isValidEmptyFile(filePath)) {
        warnings.push({ id: task.id, message: `File '${filePath}' was written but content appears empty` });
      }
    }
  }

  if (changedFiles.length > 0 && writeTasks.length > 0) {
    const plannedPaths = new Set(writeTasks.map(t => normalize(t.toolArgs?.path || t.toolArgs?.file || '')).filter(Boolean));
    for (const f of changedFiles) {
      const filePath = normalize(f.path || f.file || f);
      if (!filePath) continue;
      if (!plannedPaths.has(filePath) && !approvedScope.has(filePath)) {
        const isExistingWorkspaceFile = existingFileSet.has(filePath);
        if (!isExistingWorkspaceFile) {
          unexpectedChanges.push({ path: filePath, message: `File '${filePath}' was changed but is not in the execution plan or approved scope` });
        } else {
          warnings.push({ path: filePath, message: `Existing workspace file '${filePath}' was modified outside planned scope` });
        }
      }
    }
  }

  if (knowledgeGraph) {
    const duplicateWarnings = detectDuplicateEntities(knowledgeGraph, changedFiles);
    for (const w of duplicateWarnings) {
      warnings.push(w);
    }
  }

  return { passed, failed, warnings, unexpectedChanges, requiredFixes };
}

function normalize(filePath) {
  if (!filePath) return '';
  const str = typeof filePath === 'string' ? filePath : (filePath.path || filePath.file || filePath.filePath || '');
  if (!str) return '';
  return str.replace(/\\/g, '/').toLowerCase();
}

function isWithinWorkspace(filePath, workspaceRoot) {
  const normalizedRoot = normalize(workspaceRoot);
  const normalizedFile = normalize(filePath);
  return normalizedFile.startsWith(normalizedRoot) || !path.isAbsolute(filePath);
}

function isValidEmptyFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ['.md', '.txt', '.gitkeep', '.gitignore', '.dockerignore', '.env.example'].includes(ext) || filePath.endsWith('.gitkeep');
}

function buildApprovedScope(planTasks, workspaceState) {
  const scope = new Set();
  for (const task of planTasks) {
    const filePath = task.toolArgs?.path || task.toolArgs?.file || '';
    if (filePath) scope.add(normalize(filePath));
  }
  const recoveryScope = workspaceState?.recoveryScope || [];
  for (const p of recoveryScope) {
    if (p) scope.add(normalize(p));
  }
  return scope;
}

function detectDuplicateEntities(knowledgeGraph, changedFiles) {
  const warnings = [];
  if (!knowledgeGraph?.nodes) return warnings;

  const changedNames = new Set();
  for (const f of changedFiles) {
    const filePath = f.path || f.file || f;
    if (filePath) {
      const name = path.basename(filePath, path.extname(filePath)).toLowerCase();
      if (name) changedNames.add(name);
    }
  }

  if (changedNames.size === 0) return warnings;

  const entityNameCount = new Map();
  for (const node of knowledgeGraph.nodes) {
    const nodeName = (node.name || node.id || '').toLowerCase();
    if (nodeName && changedNames.has(nodeName)) {
      entityNameCount.set(nodeName, (entityNameCount.get(nodeName) || 0) + 1);
    }
  }

  for (const [name, count] of entityNameCount) {
    if (count > 1) {
      warnings.push({ message: `Potential duplicate entity '${name}' detected (${count} occurrences in knowledge graph)` });
    }
  }

  return warnings;
}
