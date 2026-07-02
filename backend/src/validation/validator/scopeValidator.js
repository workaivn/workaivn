function log(event, data) {
  console.log(`[${event}]`, data);
}

export function validateScope({
  changedFiles = [],
  executionPlan = null,
  knowledgeGraph = null,
  dependencyGraph = null,
  workspaceState = {},
  userPrompt = ''
} = {}) {
  log('VALIDATOR_SCOPE_CHECK', { changedFilesCount: changedFiles.length });

  const passed = [];
  const failed = [];
  const warnings = [];
  const unexpectedChanges = [];
  const requiredFixes = [];

  const approvedScope = buildApprovedScope(executionPlan, workspaceState, knowledgeGraph, dependencyGraph, userPrompt);

  const changedFilePaths = [];
  for (const f of changedFiles) {
    const filePath = f.path || f.file || f;
    if (filePath) changedFilePaths.push({ path: filePath, change: f });
  }

  for (const entry of changedFilePaths) {
    const normalizedPath = normalize(entry.path);
    const isApproved = approvedScope.some(approved => {
      if (typeof approved === 'string') {
        return normalizedPath === normalize(approved);
      }
      if (approved.pattern) {
        return approved.pattern.test(normalizedPath);
      }
      return false;
    });

    if (!isApproved) {
      const severity = assessOutOfScopeSeverity(entry.path, workspaceState, knowledgeGraph);
      const changeDetail = describeChange(entry.change);

      if (severity === 'high') {
        failed.push({ path: entry.path, message: `Out-of-scope change: '${entry.path}' (${changeDetail})` });
        requiredFixes.push(`Unexpected change to '${entry.path}' is outside approved scope`);
      } else {
        warnings.push({ path: entry.path, message: `Out-of-scope change: '${entry.path}' (${changeDetail})` });
      }
      unexpectedChanges.push({ path: entry.path, detail: changeDetail, severity });
    } else {
      passed.push({ path: entry.path, message: `Changed file '${entry.path}' is within approved scope` });
    }
  }

  return { passed, failed, warnings, unexpectedChanges, requiredFixes };
}

function normalize(filePath) {
  if (!filePath) return '';
  return filePath.replace(/\\/g, '/').toLowerCase();
}

function buildApprovedScope(executionPlan, workspaceState, knowledgeGraph, dependencyGraph, userPrompt) {
  const scope = [];

  if (executionPlan?.tasks) {
    for (const task of executionPlan.tasks) {
      if (task.tool === 'READ_FILE' || task.tool === 'WRITE_FILE' || task.tool === 'APPLY_PATCH') {
        const path = task.toolArgs?.path || task.toolArgs?.file || '';
        if (path) scope.push(path);
      }
      const goal = task.goal || '';
      const fileInGoal = goal.match(/['"]?([\w/.-]+\.[a-zA-Z]+)['"]?/);
      if (fileInGoal && !scope.includes(fileInGoal[1])) {
        scope.push(fileInGoal[1]);
      }
    }
  }

  const recoveryScope = workspaceState?.recoveryScope || [];
  for (const p of recoveryScope) {
    if (p && !scope.includes(p)) scope.push(p);
  }

  const userPromptWords = (userPrompt || '').toLowerCase().split(/\s+/);
  const promptFileRefs = (userPrompt || '').match(/['"]?([\w/.-]+\.[a-zA-Z]+)['"]?/g) || [];
  for (const ref of promptFileRefs) {
    const cleaned = ref.replace(/['"]/g, '');
    if (cleaned && !scope.includes(cleaned)) scope.push(cleaned);
  }

  if (knowledgeGraph?.edges) {
    for (const edge of knowledgeGraph.edges) {
      if (edge.type === 'affects' && edge.target) {
        if (!scope.includes(edge.target)) scope.push(edge.target);
      }
    }
  }

  if (dependencyGraph?.edges) {
    for (const edge of dependencyGraph.edges) {
      if (edge.type === 'affects' && edge.target) {
        if (!scope.includes(edge.target)) scope.push(edge.target);
      }
    }
  }

  if (workspaceState?.validationRequiredScope) {
    for (const p of workspaceState.validationRequiredScope) {
      if (p && !scope.includes(p)) scope.push(p);
    }
  }

  return scope;
}

function assessOutOfScopeSeverity(filePath, workspaceState, knowledgeGraph) {
  const lowerPath = filePath.toLowerCase();

  const existingFiles = workspaceState?.existingFiles || [];
  const isExisting = existingFiles.some(f => normalize(f) === normalize(filePath));
  if (isExisting) return 'low';

  if (lowerPath.includes('node_modules') || lowerPath.includes('.git')) return 'low';

  const criticalPaths = [/package\.json$/, /\/(src|app|lib)\//, /\.(env|config)\.[a-z]+$/];
  for (const pattern of criticalPaths) {
    if (pattern.test(lowerPath)) return 'high';
  }

  return 'medium';
}

function describeChange(change) {
  if (!change) return 'unknown change';
  if (change.content !== undefined) return 'content modified';
  if (change.deleted === true) return 'deleted';
  if (change.created === true) return 'created';
  return 'modified';
}
