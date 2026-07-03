import path from 'node:path';

function log(event, data) {
  console.log(`[${event}]`, data);
}

const LOCAL_IMPORT_PATTERN = /from\s+['"](\.[^'"]+)['"]|require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
const ABSOLUTE_IMPORT_PATTERN = /from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

export function validateImportsExports({
  changedFiles = [],
  codeGenResults = [],
  dependencyGraph = null,
  knowledgeGraph = null,
  workspaceState = {},
  executionPlan = null
} = {}) {
  log('VALIDATOR_IMPORT_EXPORT_CHECK', { changedFilesCount: changedFiles.length });

  const passed = [];
  const failed = [];
  const warnings = [];
  const requiredFixes = [];

  const workspaceRoot = workspaceState?.workspaceRoot || '';
  const allFiles = workspaceState?.existingFiles || [];
  const allFileSet = new Set(allFiles.map(normalize));

  const changedContent = new Map();
  for (const f of changedFiles) {
    const filePath = normalize(f.path || f.file || f);
    const content = f.content || f.result || '';
    if (filePath) changedContent.set(filePath, content);
  }

  for (const r of codeGenResults) {
    const filePath = normalize(r.filePath || r.path || r.file || r.target);
    const content = r.content || r.code || r.result || '';
    if (filePath && !changedContent.has(filePath)) {
      changedContent.set(filePath, content);
    }
  }

  for (const [filePath, content] of changedContent) {
    if (!content || typeof content !== 'string') continue;

    const localImports = extractLocalImports(content, filePath);
    for (const imp of localImports) {
      const resolvedPath = resolveLocalPath(filePath, imp);
      if (resolvedPath && !allFileSet.has(normalize(resolvedPath))) {
        failed.push({
          file: filePath,
          message: `Import '${imp}' from '${filePath}' references non-existent local module '${resolvedPath}'`
        });
        requiredFixes.push(`Missing local module '${resolvedPath}' imported from '${filePath}'`);
      }
    }

    const externalImports = extractExternalImports(content, filePath);
    for (const imp of externalImports) {
      if (workspaceRoot && !imp.startsWith('.') && !imp.startsWith('/')) {
        continue;
      }
      if (imp.startsWith('/') || imp.startsWith('.')) {
        continue;
      }
      if (imp.startsWith(workspaceRoot) || imp.startsWith('/')) {
        failed.push({
          file: filePath,
          message: `Import '${imp}' from '${filePath}' points outside workspace`
        });
        requiredFixes.push(`Import '${imp}' in '${filePath}' points outside the workspace`);
      }
    }
  }

  const planImports = extractPlannedImports(executionPlan);
  for (const planned of planImports) {
    const sourceFile = normalize(planned.source);
    const targetModule = normalize(planned.target);
    if (sourceFile && targetModule && !allFileSet.has(targetModule)) {
      const codeGenMatch = [...changedContent.keys()].some(f => f === targetModule || f.endsWith(targetModule));
      if (!codeGenMatch) {
        warnings.push({
          message: `Planned import from '${planned.source}' to '${planned.target}' not verified: target not found in workspace or code generation results`
        });
      }
    }
  }

  if (dependencyGraph) {
    const circularIssues = detectCircularDependencies(dependencyGraph, changedContent);
    for (const issue of circularIssues) {
      failed.push({ message: issue });
      requiredFixes.push(issue);
    }
  }

  return { passed, failed, warnings, requiredFixes };
}

function normalize(filePath) {
  if (!filePath) return '';
  const str = typeof filePath === 'string' ? filePath : (filePath.path || filePath.file || filePath.filePath || '');
  if (!str) return '';
  return str.replace(/\\/g, '/').toLowerCase();
}

function extractLocalImports(content, sourceFile) {
  const imports = [];
  let match;
  const regex = new RegExp(LOCAL_IMPORT_PATTERN.source, 'g');
  while ((match = regex.exec(content)) !== null) {
    const imp = match[1] || match[2];
    if (imp) imports.push(imp);
  }
  return imports;
}

function extractExternalImports(content, sourceFile) {
  const imports = [];
  let match;
  while ((match = ABSOLUTE_IMPORT_PATTERN.exec(content)) !== null) {
    const imp = match[1] || match[2];
    if (imp && !imp.startsWith('.')) imports.push(imp);
  }
  return imports;
}

function resolveLocalPath(sourceFile, importPath) {
  if (!importPath) return null;
  const sourceDir = path.dirname(sourceFile);
  const resolved = path.resolve(sourceDir, importPath);
  const candidates = [resolved, `${resolved}.js`, `${resolved}.jsx`, `${resolved}.ts`, `${resolved}.tsx`, `${resolved}.mjs`, `${resolved}.cjs`, `${resolved}/index.js`, `${resolved}/index.jsx`, `${resolved}/index.ts`, `${resolved}/index.tsx`, `${resolved}/index.mjs`, `${resolved}/index.cjs`];
  return candidates[0];
}

function extractPlannedImports(executionPlan) {
  if (!executionPlan?.tasks) return [];
  const imports = [];
  for (const task of executionPlan.tasks) {
    if (task.tool === 'WRITE_FILE' || task.kind === 'WRITE_FILE') {
      const filePath = task.toolArgs?.path || task.toolArgs?.file;
      const goal = task.goal || '';
      const importMatch = goal.match(/import\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/i);
      if (importMatch && filePath) {
        imports.push({ source: filePath, target: importMatch[1] });
      }
    }
  }
  return imports;
}

function detectCircularDependencies(dependencyGraph, changedContent) {
  const issues = [];
  if (!dependencyGraph?.edges) return issues;

  const visited = new Set();
  const recursionStack = new Set();

  function dfs(nodeId, path) {
    if (recursionStack.has(nodeId)) {
      const cycleStart = path.indexOf(nodeId);
      if (cycleStart !== -1) {
        const cycle = path.slice(cycleStart).concat(nodeId);
        issues.push(`Circular dependency detected: ${cycle.join(' -> ')}`);
      }
      return;
    }
    if (visited.has(nodeId)) return;

    visited.add(nodeId);
    recursionStack.add(nodeId);
    path.push(nodeId);

    const outgoing = dependencyGraph.edges
      .filter(e => (e.source === nodeId || e.from === nodeId) && (e.type === 'imports' || e.type === 'dependsOn'))
      .map(e => e.target || e.to);

    for (const target of outgoing) {
      if (target) dfs(target, [...path]);
    }

    recursionStack.delete(nodeId);
  }

  for (const node of (dependencyGraph.nodes || [])) {
    const nodeId = node.id || node.file || node.path || '';
    if (nodeId && !visited.has(nodeId)) {
      dfs(nodeId, []);
    }
  }

  return issues;
}
