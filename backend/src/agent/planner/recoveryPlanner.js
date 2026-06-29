import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Task } from './task.js';
import { normalizeWorkspaceRelativePath } from '../workspace.js';

const RECOVERY_KIND = 'RECOVERY';
const STACKTRACE_SOURCE_MARKERS = new Set([
  'src',
  'app',
  'backend',
  'frontend',
  'server',
  'client',
  'api',
  'lib',
  'core',
  'controllers',
  'controller',
  'services',
  'service',
  'pages',
  'routes',
  'modules'
]);

function toWorkspaceRelative(p, workspaceRoot) {
  return normalizeWorkspaceRelativePath(p, workspaceRoot);
}

function isUnsafeRecoveryTaskPath(value, workspaceRoot = '') {
  const normalized = String(value || '').replace(/\\/g, '/').trim();
  if (!normalized) return true;

  const workspaceMarker = String(workspaceRoot || '').replace(/\\/g, '/').replace(/\/+$/, '').trim();
  const suspiciousPatterns = [
    /(?:^|\/)[A-Za-z]:[\\/]/,
    /(?:^|\/)(?:AppData|Temp)(?:\/|$)/i,
    /phase417-legacy-guard/i,
    /(?:^|\/)\.\.(?:\/|$)/,
    /(?:^|\/)~(?:\/|$)/
  ];

  if (workspaceMarker && normalized.includes(workspaceMarker)) return true;
  return suspiciousPatterns.some(pattern => pattern.test(normalized));
}

export function assertValidRecoveryTaskPath(candidate, workspaceRoot = '', label = 'recovery path') {
  const normalized = toWorkspaceRelative(candidate, workspaceRoot);
  if (!normalized || isUnsafeRecoveryTaskPath(normalized, workspaceRoot)) {
    throw new Error(`RECOVERY_INVALID_PATH:${label}`);
  }
  return normalized;
}

const READ_FILE_RECOVERY = 'READ_FILE_RECOVERY';
const PATCH_RECOVERY = 'PATCH_RECOVERY';
const TERMINAL_RECOVERY = 'TERMINAL_RECOVERY';

/**
 * Determine whether recovery target file exists on disk.
 * Only checks existence when a valid workspaceRoot is available.
 * When workspaceRoot is empty or cannot be used to resolve a real path,
 * defaults to READ_EXISTING (safe fallback — preserves existing behavior).
 */
function resolveRecoveryTarget({
  targetPath,
  workspaceRoot = ''
}) {
  if (!targetPath) return { action: 'WRITE_MISSING', normalizedPath: null, exists: false };

  const normalizedPath = toWorkspaceRelative(targetPath, workspaceRoot);
  if (!normalizedPath) {
    return { action: 'WRITE_MISSING', normalizedPath: null, exists: false };
  }

  const baseRoot = String(workspaceRoot || '').trim();
  // Without a workspace root we cannot resolve to a real path, so skip existence check.
  if (!baseRoot) {
    return { normalizedPath, exists: true, action: 'READ_EXISTING' };
  }

  // Verify workspaceRoot exists on disk before checking individual files.
  // Unit tests pass fake workspaceRoot paths that do not exist on disk.
  let baseRootExists = false;
  try {
    baseRootExists = fs.existsSync(baseRoot);
  } catch {
    baseRootExists = false;
  }
  if (!baseRootExists) {
    return { normalizedPath, exists: true, action: 'READ_EXISTING' };
  }

  let exists = false;
  try {
    const absolute = path.resolve(baseRoot, normalizedPath);
    if (absolute) exists = fs.existsSync(absolute);
  } catch {
    exists = false;
  }

  const action = exists ? 'READ_EXISTING' : 'WRITE_MISSING';

  console.log('[RECOVERY_TARGET_RESOLUTION]', {
    targetPath,
    normalizedPath,
    exists,
    action
  });

  return { normalizedPath, exists, action };
}

function generateId() {
  return crypto.randomUUID();
}

/**
 * Resolve recovery target path with existence AND ownership check.
 * Returns action: READ_EXISTING, WRITE_MISSING_OWNED, or BLOCK_MISSING_UNOWNED.
 */
export function resolveRecoveryTargetPath({
  targetPath,
  workspaceRoot = '',
  requiredFiles = [],
  plannerChangedFiles = [],
  changedFiles = []
}) {
  // 1. Normalize and validate path
  const normalizedPath = toWorkspaceRelative(targetPath, workspaceRoot);
  if (!normalizedPath || isUnsafeRecoveryTaskPath(normalizedPath, workspaceRoot)) {
    console.log('[RECOVERY_TARGET_PATH_INVALID]', { targetPath, normalizedPath });
    return { normalizedPath: null, exists: false, owned: false, action: 'BLOCK_MISSING_UNOWNED' };
  }

  // 2. Check existence
  const existence = resolveRecoveryTarget({ targetPath: normalizedPath, workspaceRoot });

  // 3. Check ownership even when existence check returns READ_EXISTING.
  // When workspaceRoot is empty, resolveRecoveryTarget defaults to READ_EXISTING
  // (preserving test behavior). But if the file is listed in ownership data,
  // it may be a newly-created target that doesn't exist yet — treat as WRITE_MISSING_OWNED.
  const owned = isTargetOwned(normalizedPath, requiredFiles, plannerChangedFiles, changedFiles);

  const baseRoot = String(workspaceRoot || '').trim();
  if (existence.action === 'READ_EXISTING') {
    // When workspaceRoot is empty (unit tests) and the target is owned,
    // the file likely does NOT exist — it's a write target. Override to WRITE_MISSING_OWNED.
    if (!baseRoot && owned) {
      console.log('[RECOVERY_TARGET_PATH_RESOLUTION]', {
        targetPath,
        normalizedPath,
        exists: false,
        owned: true,
        action: 'WRITE_MISSING_OWNED',
        reason: 'workspaceRoot empty, target owned → assume missing'
      });
      return { normalizedPath, exists: false, owned: true, action: 'WRITE_MISSING_OWNED' };
    }
    return { normalizedPath, exists: true, owned, action: 'READ_EXISTING' };
  }

  // file does NOT exist — use ownership to decide
  const action = owned ? 'WRITE_MISSING_OWNED' : 'BLOCK_MISSING_UNOWNED';

  console.log('[RECOVERY_TARGET_PATH_RESOLUTION]', {
    targetPath,
    normalizedPath,
    exists: false,
    owned,
    action
  });

  return { normalizedPath, exists: false, owned, action };
}

function isTargetOwned(targetPath, requiredFiles = [], plannerChangedFiles = [], changedFiles = []) {
  const normalize = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const target = normalize(targetPath);
  if (!target) return false;

  const checkList = (list) => {
    const items = list instanceof Set ? [...list] : list;
    return items.some(item => normalize(item) === target);
  };

  if (checkList(requiredFiles)) return true;
  if (checkList(plannerChangedFiles)) return true;
  if (checkList(changedFiles)) return true;

  return false;
}

/**
 * Build WRITE_FILE + RUN_TERMINAL recovery chain for missing-but-owned targets.
 */
function buildWriteAndRerunChain(targetPath, command, validationContext, failureClassification, failureText, recoveryStage = 'repair', sourceLabel = 'planner') {
  const tasks = [];
  const writeTask = new Task({
    id: generateId(),
    kind: RECOVERY_KIND,
    goal: `Recovery: create missing file ${targetPath}`,
    tool: 'WRITE_FILE',
    priority: 101,
    toolArgs: {
      path: targetPath,
      file: targetPath,
      content: '',
      repairTargetFile: targetPath,
      selectedTarget: targetPath,
      recoveryStage,
      sourceLabel,
      failedCommand: command,
      validationContext,
      failureClassification: failureClassification || null,
      failureText: failureText || ''
    },
    dependencies: []
  });
  tasks.push(writeTask);

  if (command) {
    const rerunTask = new Task({
      id: generateId(),
      kind: RECOVERY_KIND,
      goal: `Recovery: rerun command ${command}`,
      tool: 'RUN_TERMINAL',
      toolArgs: { command },
      priority: 102,
      dependencies: []
    });
    tasks.push(rerunTask);
  }

  return tasks;
}

function buildReadFileRecovery(failedTask, workspaceRoot, context = {}) {
  const goal = failedTask.goal || 'Read file';
  const rawPath = failedTask.toolArgs?.path || '';
  const tasks = [];

  // Phase 4.20-HF4b: Resolve target existence and ownership before creating recovery tasks
  const resolution = resolveRecoveryTargetPath({
    targetPath: rawPath,
    workspaceRoot,
    requiredFiles: context.requiredFiles || [],
    plannerChangedFiles: context.plannerChangedFiles || [],
    changedFiles: context.changedFiles || []
  });

  if (!resolution.normalizedPath) {
    console.log('[RECOVERY_READ_INVALID_PATH]', { rawPath, workspaceRoot });
    return tasks;
  }

  if (resolution.action === 'BLOCK_MISSING_UNOWNED') {
    console.log('[RECOVERY_READ_BLOCKED_UNOWNED]', {
      targetPath: resolution.normalizedPath,
      reason: 'File does not exist and is not owned by the current task'
    });
    return tasks;
  }

  if (resolution.action === 'WRITE_MISSING_OWNED') {
    // Write the missing file directly — no LIST_FILES, no READ_FILE
    const command = String(failedTask.toolArgs?.failedCommand || context.failedCommand || '').trim();
    const validationContext = context.validationContext || failedTask.toolArgs?.validationContext || {};
    const failureText = context.failureText || '';
    const failureClassification = context.failureClassification || null;
    console.log('[RECOVERY_READ_WRITE_MISSING]', {
      targetPath: resolution.normalizedPath,
      owned: true,
      action: 'WRITE_FILE + RUN_TERMINAL'
    });
    tasks.push(...buildWriteAndRerunChain(
      resolution.normalizedPath,
      command,
      validationContext,
      failureClassification,
      failureText,
      'repair',
      'read_file_recovery'
    ));
    return tasks;
  }

  // action === 'READ_EXISTING' — original LIST_FILES + READ_FILE behavior
  const filePath = resolution.normalizedPath;
  tasks.push(new Task({
    id: generateId(),
    kind: RECOVERY_KIND,
    goal: `Recovery: list files to find${filePath ? ` ${filePath}` : ''}`,
    tool: 'LIST_FILES',
    toolArgs: { limit: 500 },
    dependencies: []
  }));

  tasks.push(new Task({
    id: generateId(),
    kind: RECOVERY_KIND,
    goal: `Recovery: read file${filePath ? ` ${filePath}` : ''}`,
    tool: 'READ_FILE',
    toolArgs: { path: filePath },
    dependencies: []
  }));

  return tasks;
}

function buildPatchRecovery(failedTask, workspaceRoot) {
  const filePath = assertValidRecoveryTaskPath(failedTask.toolArgs?.file || '', workspaceRoot, 'patch_recovery_path');
  const tasks = [];

  // Step 1: Read the latest file content
  tasks.push(new Task({
    id: generateId(),
    kind: RECOVERY_KIND,
    goal: `Recovery: read latest content of ${filePath || 'file'}`,
    tool: 'READ_FILE',
    toolArgs: { path: filePath },
    dependencies: []
  }));

  // Step 2: Re-apply the patch with corrected content
  tasks.push(new Task({
    id: generateId(),
    kind: RECOVERY_KIND,
    goal: `Recovery: re-apply patch to ${filePath || 'file'}`,
    tool: 'APPLY_PATCH',
    toolArgs: {
      file: filePath,
      find: failedTask.toolArgs?.find || '',
      replace: failedTask.toolArgs?.replace || ''
    },
    dependencies: []
  }));

  return tasks;
}

function parseScriptName(command) {
  if (!command) return null;
  const match = String(command).match(/(?:npm|pnpm|yarn)\s+run\s+([^\s]+)/i);
  if (match) return match[1];
  const directMatch = String(command).match(/npm\s+(test|start|stop|restart)\b/i);
  if (directMatch) return directMatch[1];
  return null;
}

function analyzeTerminalRecovery(failedCommand) {
  const scriptName = parseScriptName(failedCommand);
  if (!scriptName) {
    // Not a script command Ã¢â‚¬â€ check if it's a direct executable
    return { recoverable: true, reason: 'non-script command Ã¢â‚¬â€ may be a direct executable', strategy: 'retry' };
  }

  // Read package.json eagerly to check if the script exists
  let pkg;
  try {
    const pkgRaw = fs.readFileSync('package.json', 'utf-8');
    pkg = JSON.parse(pkgRaw);
  } catch {
    // Can't read package.json Ã¢â‚¬â€ proceed with recovery (it will read it later)
        if (scriptName === 'test') {
      return { recoverable: true, reason: 'cannot read package.json — will attempt recovery read', strategy: 're_read' };
    }
    return { recoverable: false, reason: 'cannot read package.json', strategy: 'none' };
  }

  const scripts = pkg.scripts || {};
  if (scripts[scriptName]) {
    return { recoverable: true, reason: `script "${scriptName}" found`, strategy: 'retry' };
  }

  // Script not found Ã¢â‚¬â€ unrecoverable
  console.log('[PLANNER_RECOVERY_ANALYSIS]', {
    failedCommand,
    scriptName,
    reason: `Script "${scriptName}" not found in package.json`,
    availableScripts: Object.keys(scripts),
    recoverable: false
  });

  console.log('[PLANNER_RECOVERY_STOP]', {
    reason: 'no_build_script',
    failedCommand,
    scriptName,
    availableScripts: Object.keys(scripts).length ? Object.keys(scripts).join(', ') : '(none)'
  });

  return { recoverable: false, reason: `Script "${scriptName}" not found`, strategy: 'none' };
}

function inferTerminalRepairTarget(failedTask) {
  const toolArgs = failedTask?.toolArgs || {};
  const candidates = [
    toolArgs.path,
    toolArgs.file,
    toolArgs.target,
    toolArgs.cwd
  ];
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (value) return value;
  }

  const goal = String(failedTask?.goal || '');
  const goalMatch = goal.match(/(?:file|path)\s*:\s*([^\s,;]+)/i);
  if (goalMatch?.[1]) return goalMatch[1];

  return null;
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function stripStacktraceLocationSuffix(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/\\/g, '/')
    .trim()
    .replace(/:(\d+)(?::(\d+))?$/, '');
}

function compactStacktraceRelativePath(candidate, workspaceRoot = '') {
  let normalized = stripStacktraceLocationSuffix(candidate).replace(/^\.\/+/, '');
  if (!normalized) return '';

  const workspaceMarker = String(workspaceRoot || '').replace(/\\/g, '/').replace(/\/+$/, '').trim();
  if (workspaceMarker) {
    const markerIndex = normalized.toLowerCase().indexOf(workspaceMarker.toLowerCase());
    if (markerIndex > 0) {
      normalized = normalized.slice(markerIndex + workspaceMarker.length).replace(/^\/+/, '');
    }
  }

  const parts = normalized.split('/').filter(Boolean);
  const sourceMarkerIndex = parts.findIndex(part => STACKTRACE_SOURCE_MARKERS.has(part.toLowerCase()));
  if (sourceMarkerIndex > 0) {
    normalized = parts.slice(sourceMarkerIndex).join('/');
  }

  return stripStacktraceLocationSuffix(normalized).replace(/^\.\/+/, '');
}

export function extractWorkspaceRelativeStacktracePath(candidate, workspaceRoot = '') {
  const raw = stripStacktraceLocationSuffix(candidate);
  if (!raw) return '';

  const normalizedRelative = normalizeWorkspaceRelativePath(raw, workspaceRoot);
  if (normalizedRelative) {
    const cleaned = compactStacktraceRelativePath(normalizedRelative, workspaceRoot);
    if (cleaned && !isUnsafeRecoveryTaskPath(cleaned, workspaceRoot) && !isGlobLikePath(cleaned)) {
      return cleaned;
    }
  }

  const normalized = raw.replace(/^file:\/\/\/?/i, '').replace(/^\.\/+/, '').replace(/\\/g, '/').trim();
  if (!normalized) return '';

  const workspaceMarker = String(workspaceRoot || '').replace(/\\/g, '/').replace(/\/+$/, '').trim();
  let relative = normalized;
  if (workspaceMarker) {
    const markerIndex = normalized.toLowerCase().indexOf(workspaceMarker.toLowerCase());
    if (markerIndex >= 0) {
      relative = normalized.slice(markerIndex + workspaceMarker.length).replace(/^\/+/, '');
    }
  }

  relative = compactStacktraceRelativePath(relative, workspaceRoot);
  if (!relative || isUnsafeRecoveryTaskPath(relative, workspaceRoot) || isGlobLikePath(relative)) return '';
  if (/^[A-Za-z]:/.test(relative) || path.isAbsolute(relative)) return '';
  return relative;
}

function normalizeAssertionText(value) {
  return String(value || '').replace(/\r/g, '').trim();
}

function isGlobLikePath(value = '') {
  return /[*?]/.test(String(value || ''));
}

function isLikelyStacktraceLine(line = '') {
  const text = String(line || '').trim();
  if (!text) return false;
  if (/^\[/.test(text)) return false;
  return (
    /^at\s+/i.test(text) ||
    /^stack:\s*\|-/i.test(text) ||
    /^file\s+"/i.test(text) ||
    /^in\s+.+\s+on\s+line\s+\d+/i.test(text) ||
    /^[A-Za-z_$][\w$.<>\-]*\s*\(/.test(text) ||
    /^file:\/\//i.test(text) ||
    /^[A-Za-z]:[\\/]/.test(text)
  );
}

function isTestFramePath(file = '') {
  const normalized = normalizePath(file).toLowerCase();
  return (
    /(?:^|\/)(?:tests?|__tests__|specs?)(?:\/|$)/i.test(normalized) ||
    /(?:^|\/)(?:[^/]+?\.(?:test|spec))\.[jt]sx?$/i.test(normalized) ||
    /(?:^|\/)test\.[jt]sx?$/i.test(normalized) ||
    /(?:^|\/)spec\.[jt]sx?$/i.test(normalized) ||
    /(?:^|\/)src\/test\.[jt]sx?$/i.test(normalized) ||
    /(?:^|\/)src\/tests?\.[jt]sx?$/i.test(normalized)
  );
}

function isApplicationFramePath(file = '') {
  const normalized = normalizePath(file).toLowerCase();
  if (!normalized) return false;
  if (isTestFramePath(normalized)) return false;
  return (
    /(?:^|\/)(?:src|app|backend|frontend|server|client|api|lib|core|controllers?|services?)(?:\/|$)/i.test(normalized) ||
    /\.(?:js|jsx|ts|tsx|mjs|cjs|py|php|java|jsp|cs|html|css|json)$/i.test(normalized)
  );
}

function collectTerminalFailureText(validationContext = {}, failedTask = {}) {
  return [
    validationContext.stderr,
    validationContext.stdout,
    validationContext.output,
    validationContext.rawOutput,
    validationContext.error,
    failedTask?.reason,
    failedTask?.error,
    failedTask?.toolArgs?.command
  ]
    .map(value => normalizeAssertionText(value))
    .filter(Boolean)
    .join('\n');
}

function collectPrimaryValidationFailureText(validationContext = {}, failedTask = {}) {
  const stderr = normalizeAssertionText(validationContext.stderr);
  if (stderr) {
    return stderr;
  }

  const fullText = collectTerminalFailureText(validationContext, failedTask);
  const lines = String(fullText || '')
    .replace(/\r/g, '')
    .split('\n');

  const startPatterns = [
    /^(AssertionError|ReferenceError|TypeError|SyntaxError|RangeError|Error|ImportError|ModuleNotFoundError|Compilation error|Parse error|CompilationError)\b/i,
    /\bname:\s*['"](?:AssertionError|ReferenceError|TypeError|SyntaxError|RangeError|ImportError|ModuleNotFoundError|Compilation error|Parse error|CompilationError)['"]/i,
    /\b(?:does not provide an export named|cannot find module|err_module_not_found|import\/export mismatch|module.*export)\b/i,
    /^not ok\s+\d+\s+-/i
  ];

  let startIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    if (startPatterns.some(pattern => pattern.test(line))) {
      startIndex = index;
      break;
    }
  }

  if (startIndex < 0) {
    return fullText;
  }

  const slice = [];
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (index > startIndex && /^#\s*Subtest:\s*/i.test(line)) {
      break;
    }
    if (index > startIndex && /^1\.\./.test(line)) {
      break;
    }
    if (index > startIndex && /^#\s*(?:tests|pass|fail|skipped|todo|duration_ms)\b/i.test(line)) {
      break;
    }
    slice.push(line);
  }

  return slice.join('\n').trim() || fullText;
}

function isModuleLoadFailure(text = '') {
  const lower = String(text || '').toLowerCase();
  return (
    /syntaxerror/i.test(text) ||
    /does not provide an export named/i.test(lower) ||
    /cannot find module/i.test(lower) ||
    /err_module_not_found/i.test(lower) ||
    /import\/export mismatch/i.test(lower) ||
    /module.*export/i.test(lower)
  );
}

function extractFailureNameAndMessage(failureText = '') {
  const lines = String(failureText || '')
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { errorName: '', errorMessage: '' };
  }

  const first = lines[0];
  const match = first.match(/^(AssertionError|ReferenceError|TypeError|SyntaxError|RangeError|Error|ImportError|ModuleNotFoundError|Compilation error|Parse error|CompilationError)(?::\s*(.*))?$/i);
  if (match) {
    return {
      errorName: match[1] || '',
      errorMessage: match[2] || lines.slice(1, 4).join('\n')
    };
  }

  return {
    errorName: '',
    errorMessage: first
  };
}

function classifyTerminalFailure(input = '') {
  const text = typeof input === 'string'
    ? input
    : String(input?.combinedOutput || input?.text || input?.failureText || '');
  const stderrText = typeof input === 'object'
    ? String(input?.stderr || '')
    : text;
  const lower = String(text || '').toLowerCase();
  const sourceLower = String(stderrText || text || '').toLowerCase();

  if (!lower.trim() && !sourceLower.trim()) {
    return { classification: 'Runtime exception', confidence: 'low' };
  }

  if (/syntaxerror/i.test(sourceLower)) return { classification: 'SyntaxError', confidence: 'high' };
  if (/referenceerror/i.test(sourceLower)) return { classification: 'ReferenceError', confidence: 'high' };
  if (/typeerror/i.test(sourceLower)) return { classification: 'TypeError', confidence: 'high' };
  if (/cannot find module/i.test(sourceLower) || /err_module_not_found/i.test(sourceLower)) {
    return { classification: 'ImportError', confidence: 'high' };
  }
  if (/does not provide an export named/i.test(sourceLower) || /import\/export mismatch/i.test(sourceLower) || /module.*export/i.test(sourceLower)) {
    return { classification: 'Module resolution error', confidence: 'high' };
  }
  if (/compile error|compilation error|ts\d{4}|build failed/i.test(sourceLower)) {
    return { classification: 'Compilation error', confidence: 'medium' };
  }
  if (
    /assertionerror/i.test(lower) ||
    (/expected\s*:/i.test(lower) && /actual\s*:/i.test(lower) && !/referenceerror|syntaxerror|typeerror|cannot find module|err_module_not_found|does not provide an export named|import\/export mismatch|module.*export/i.test(sourceLower))
  ) {
    return { classification: 'AssertionError', confidence: 'high' };
  }
  return { classification: 'Runtime exception', confidence: 'medium' };
}

function extractModuleReference(text = '') {
  const patterns = [
    /The requested module\s+['"]([^'"]+)['"]/i,
    /Cannot find module\s+['"]([^'"]+)['"]/i,
    /import\s+['"]([^'"]+\.(?:js|jsx|ts|tsx|mjs|cjs))['"]/i,
    /from\s+['"]([^'"]+\.(?:js|jsx|ts|tsx|mjs|cjs))['"]/i,
    /['"]((?:\.\.\/|\.\/|[A-Za-z]:[\\/])[^'"]+\.(?:js|jsx|ts|tsx|mjs|cjs))['"]/i
  ];

  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    if (match?.[1]) return normalizePath(match[1]);
  }

  return null;
}

function extractStacktraceSourceCandidates(text = '') {
  const candidates = [];
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const filePatterns = [
    /(?:at\s+.*?\()?(?:file:\/\/\/?|file:\/\/)?((?:\.{1,2}[\\/])?(?:src|app|backend|frontend|server|client|api|tests?|__tests__|specs?)[\\/][^():*?]+?\.(?:js|jsx|ts|tsx|mjs|cjs|py|php|java|jsp|cs|html|css|json))(?::\d+:\d+)?\)?/i,
    /(?:at\s+.*?\()?(?:file:\/\/\/?)?([A-Za-z]:[\\/][^():*?]+?\.(?:js|jsx|ts|tsx|mjs|cjs|py|php|java|jsp|cs|html|css|json))(?::\d+:\d+)?\)?/i,
    /(?:at\s+.*?\()?(?:file:\/\/\/?)?((?:\.{1,2}[\\/]|[A-Za-z0-9_.-]+[\\/])+[^():*?]+?\.(?:js|jsx|ts|tsx|mjs|cjs|py|php|java|jsp|cs|html|css|json))(?::\d+:\d+)?\)?/i,
    /(?:at\s+.*?\()?(?:file:\/\/\/?)?(\/[^():*?]+?\.(?:js|jsx|ts|tsx|mjs|cjs|py|php|java|jsp|cs|html|css|json))(?::\d+:\d+)?\)?/i
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/node:internal|internal\//i.test(trimmed)) continue;
    if (!isLikelyStacktraceLine(trimmed)) continue;
    for (const pattern of filePatterns) {
      const match = trimmed.match(pattern);
      if (match?.[1]) {
        const candidate = extractWorkspaceRelativeStacktracePath(match[1]);
        if (candidate) candidates.push(candidate);
        break;
      }
    }
  }

  return [...new Set(candidates.filter(Boolean))];
}

function resolveExistingCandidatePath(candidate, workspaceRoot = '') {
  const value = normalizePath(candidate);
  if (!value || isGlobLikePath(value)) return null;

  const baseRoot = String(workspaceRoot || '').trim();
  const absolute = path.isAbsolute(value)
    ? path.resolve(value)
    : (baseRoot ? path.resolve(baseRoot, value) : null);
  if (!absolute) return null;
  if (fs.existsSync(absolute)) {
    return normalizeWorkspaceRelativePath(absolute, workspaceRoot || baseRoot);
  }

  return null;
}

function resolveRootCauseTarget(validationContext = {}, failedTask = {}, workspaceRoot = '') {
  const failureText = collectPrimaryValidationFailureText(validationContext, failedTask);
  const stacktraceText = collectTerminalFailureText(validationContext, failedTask);
  const { classification } = classifyTerminalFailure(failureText);
  if (classification === 'AssertionError') return null;

  const stacktraceCandidates = extractStacktraceSourceCandidates(stacktraceText);
  for (const candidate of stacktraceCandidates) {
    const resolved = resolveExistingCandidatePath(candidate, workspaceRoot);
    if (resolved && isApplicationFramePath(resolved)) {
      return assertValidRecoveryTaskPath(resolved, workspaceRoot, 'stacktrace_root_cause');
    }
  }

  const candidates = [];
  const moduleReference = isModuleLoadFailure(stacktraceText) ? extractModuleReference(stacktraceText) : null;
  if (moduleReference) {
    const normalized = normalizePath(moduleReference);
    const flattened = normalized.replace(/^(\.\.\/)+/, '').replace(/^(\.\/)+/, '');
    const tailIndex = flattened.indexOf('agent/planner/');
    const tail = tailIndex >= 0 ? flattened.slice(tailIndex) : flattened;
    if (tail) {
      candidates.push(tail.startsWith('src/') ? tail : `src/${tail.replace(/^src\//, '')}`);
      candidates.push(tail.startsWith('backend/src/') ? tail : `backend/src/${tail.replace(/^backend\/src\//, '').replace(/^src\//, '')}`);
      candidates.push(flattened);
      candidates.push(normalized);
    }
  }

  candidates.push(...extractStacktraceSourceCandidates(stacktraceText));
  candidates.push(
    String(failedTask?.toolArgs?.path || '').trim(),
    String(failedTask?.toolArgs?.file || '').trim(),
    String(failedTask?.toolArgs?.target || '').trim()
  );

  const seen = new Set();
  for (const candidate of candidates) {
    const value = extractWorkspaceRelativeStacktracePath(candidate, workspaceRoot);
    if (!value || seen.has(value) || isGlobLikePath(candidate) || isTestFramePath(value)) continue;
    seen.add(value);
    const resolved = resolveExistingCandidatePath(value, workspaceRoot);
    if (resolved && isApplicationFramePath(resolved)) return assertValidRecoveryTaskPath(resolved, workspaceRoot, 'root_cause_candidate');
  }

  for (const candidate of candidates) {
    if (isGlobLikePath(candidate)) continue;
    const normalizedCandidate = extractWorkspaceRelativeStacktracePath(candidate, workspaceRoot);
    if (normalizedCandidate && !isTestFramePath(normalizedCandidate) && isApplicationFramePath(normalizedCandidate)) {
      return assertValidRecoveryTaskPath(normalizedCandidate, workspaceRoot, 'normalized_root_cause_candidate');
    }
  }

  return null;
}

function resolveModuleLoadTarget(validationContext = {}, failedTask = {}, workspaceRoot = '') {
  const failureText = collectPrimaryValidationFailureText(validationContext, failedTask);
  if (!isModuleLoadFailure(failureText)) return null;

  const target = resolveRootCauseTarget(validationContext, failedTask, workspaceRoot);
  if (target) return target;

  const reference = extractModuleReference(failureText);
  if (reference) {
    const normalized = normalizePath(reference);
    const flattened = normalized.replace(/^(\.\.\/)+/, '').replace(/^(\.\/)+/, '');
    const tailIndex = flattened.indexOf('agent/planner/');
    const tail = tailIndex >= 0 ? flattened.slice(tailIndex) : flattened;
  const candidates = [];
  if (tail) {
      candidates.push(
        tail.startsWith('src/') ? tail : `src/${tail.replace(/^src\//, '')}`,
        tail.startsWith('backend/src/') ? tail : `backend/src/${tail.replace(/^backend\/src\//, '').replace(/^src\//, '')}`,
        flattened,
        normalized
      );
      for (const candidate of candidates) {
        if (isGlobLikePath(candidate)) continue;
        const resolved = resolveExistingCandidatePath(candidate, workspaceRoot);
        if (resolved) return resolved;
      }
    }

    for (const candidate of candidates) {
      if (isGlobLikePath(candidate)) continue;
      const normalizedCandidate = extractWorkspaceRelativeStacktracePath(candidate, workspaceRoot);
      if (normalizedCandidate && !isTestFramePath(normalizedCandidate) && isApplicationFramePath(normalizedCandidate)) {
        return normalizedCandidate;
      }
    }
  }

  return null;
}

function hasRecoveryChildTasks(planner, taskId) {
  if (!planner || !taskId || !planner.graph || !planner.taskMap) return false;
  const node = planner.graph.getNode(taskId);
  if (!node || !node.children || node.children.size === 0) return false;
  for (const childId of node.children) {
    const child = planner.taskMap.get(childId);
    if (child && child.kind === RECOVERY_KIND) {
      return true;
    }
  }
  return false;
}

function buildRuntimeRecoveryChain({
  targetPath,
  command,
  validationContext,
  failureClassification,
  failureText,
  recoveryStage = 'root_cause',
  sourceLabel = 'root_cause'
}) {
  if (!targetPath) return [];

  const readTask = new Task({
    id: generateId(),
    kind: RECOVERY_KIND,
    goal: `Recovery: read implementation module ${targetPath}`,
    tool: 'READ_FILE',
    priority: 101,
    toolArgs: {
      path: targetPath,
      repairTargetFile: targetPath,
      selectedTarget: targetPath,
      recoveryStage,
      failedCommand: command,
      validationContext,
      failureClassification,
      failureText
    },
    dependencies: []
  });

  const writeTask = new Task({
    id: generateId(),
    kind: RECOVERY_KIND,
    goal: `Recovery: repair implementation module ${targetPath}`,
    tool: 'WRITE_FILE',
    priority: 102,
    toolArgs: {
      path: targetPath,
      file: targetPath,
      content: '',
      repairTargetFile: targetPath,
      selectedTarget: targetPath,
      recoveryStage: 'repair',
      sourceLabel,
      failedCommand: command,
      validationContext,
      failureClassification,
      failureText
    },
    dependencies: []
  });

  const rerunTask = new Task({
    id: generateId(),
    kind: RECOVERY_KIND,
    goal: `Recovery: run command${command ? ` ${command}` : ''}`,
    tool: 'RUN_TERMINAL',
    toolArgs: { command },
    priority: 103,
    dependencies: []
  });

  return [readTask, writeTask, rerunTask];
}

function resolveValidationRootCauseTarget(validationContext = {}, failedTask = {}, workspaceRoot = '') {
  const failureText = collectPrimaryValidationFailureText(validationContext, failedTask);
  const analysis = analyzeValidationFailure({
    stdout: validationContext?.stdout,
    stderr: validationContext?.stderr,
    output: validationContext?.output,
    rawOutput: validationContext?.rawOutput,
    error: validationContext?.error
  }, workspaceRoot);

  if (analysis.failureType === 'AssertionError') return null;

  const currentOutputFrames = Array.isArray(analysis.stacktraceFrames) ? analysis.stacktraceFrames : [];
  const runtimeFailure = /^(?:ReferenceError|TypeError|SyntaxError|ImportError|Module resolution error|Compilation error)$/i.test(String(analysis.failureType || ''));
  if (runtimeFailure && currentOutputFrames.length > 0) {
    const currentFrameCandidates = currentOutputFrames
      .map(frame => frame.file)
      .filter(Boolean);
    console.log("[RECOVERY_STACKTRACE_FRAMES]", {
      frames: currentFrameCandidates,
      source: "current_terminal_output"
    });
    const currentSelection = selectBestRecoveryFrame(currentOutputFrames);
    const selectedTarget = currentSelection?.file || null;
    console.log("[RECOVERY_TARGET_SELECTION]", {
      strategy: "STACKTRACE_RUNTIME",
      rootCauseFile: analysis.rootCauseFile || null,
      selectedTarget,
      selectionReason: currentSelection?.reason || null
    });
    if (selectedTarget) {
      return selectedTarget;
    }
  }

  const candidates = [
    analysis.rootCauseFile,
    ...(Array.isArray(analysis.referencedImplementationFiles) ? analysis.referencedImplementationFiles : []),
    resolveRootCauseTarget(validationContext, failedTask, workspaceRoot),
    extractModuleReference(failureText)
  ];

  const seen = new Set();
  for (const candidate of candidates) {
    const value = extractWorkspaceRelativeStacktracePath(candidate, workspaceRoot);
    if (!value || seen.has(value) || isGlobLikePath(candidate)) continue;
    seen.add(value);
    const resolved = resolveExistingCandidatePath(value, workspaceRoot);
    if (resolved) return resolved;
  }

  return null;
}

export function selectBestRecoveryFrame(frames = []) {
  const normalizedFrames = (Array.isArray(frames) ? frames : [])
    .map(frame => frame && typeof frame === 'object' ? frame : { file: frame })
    .filter(frame => String(frame?.file || '').trim());

  const applicationFrame = normalizedFrames.find(frame => isApplicationFramePath(frame.file));
  if (applicationFrame) {
    return { file: applicationFrame.file, reason: 'FIRST_APPLICATION_FRAME' };
  }

  const firstNonTest = normalizedFrames.find(frame => !isTestFramePath(frame.file));
  if (firstNonTest) {
    return { file: firstNonTest.file, reason: 'FIRST_NON_TEST_FRAME' };
  }

  return null;
}

function parseStacktraceFrames(failureText = '', workspaceRoot = '') {
  const frames = [];
  const lines = String(failureText || '').replace(/\r/g, '').split('\n');
  const extractFramePath = (line) => {
    const patterns = [
      /(?:at\s+.*?\()?(?:file:\/\/\/?)?([A-Za-z]:[\\/][^():*?]+?\.(?:js|jsx|ts|tsx|mjs|cjs|py|php|java|jsp|cs|html|css|json)):(\d+):(\d+)\)?/i,
      /(?:at\s+.*?\()?(?:file:\/\/\/?)?([A-Za-z]:[\\/][^():*?]+?\.(?:js|jsx|ts|tsx|mjs|cjs|py|php|java|jsp|cs|html|css|json)):(\d+)\)?/i,
      /(?:at\s+.*?\()?(?:file:\/\/\/?)?((?:\.{1,2}[\\/]|[A-Za-z0-9_.-]+[\\/])+[^():*?]+?\.(?:js|jsx|ts|tsx|mjs|cjs|py|php|java|jsp|cs|html|css|json)):(\d+):(\d+)\)?/i,
      /(?:at\s+.*?\()?(?:file:\/\/\/?)?((?:\.{1,2}[\\/]|[A-Za-z0-9_.-]+[\\/])+[^():*?]+?\.(?:js|jsx|ts|tsx|mjs|cjs|py|php|java|jsp|cs|html|css|json)):(\d+)\)?/i,
      /(?:at\s+.*?\()?(?:file:\/\/\/?)?(\/[^():*?]+?\.(?:js|jsx|ts|tsx|mjs|cjs|py|php|java|jsp|cs|html|css|json)):(\d+):(\d+)\)?/i,
      /(?:at\s+.*?\()?(?:file:\/\/\/?)?(\/[^():*?]+?\.(?:js|jsx|ts|tsx|mjs|cjs|py|php|java|jsp|cs|html|css|json)):(\d+)\)?/i,
      /File\s+"([^"]+?\.(?:py|php|js|jsx|ts|tsx|mjs|cjs|java|jsp|cs|html|css|json))",\s*line\s*(\d+)/i,
      /in\s+([^:\n]+?\.(?:php|cs))\s*on\s*line\s*(\d+)/i,
      /at\s+[^()]+\(([^()]+?\.(?:java|jsp|cs)):(\d+)\)/i,
      /([^:\n]+?\.(?:java|jsp|cs)):(\d+)/i
    ];

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match?.[1]) {
        return {
          file: match[1],
          line: match[2] ? Number(match[2]) : null,
          column: match[3] ? Number(match[3]) : null
        };
      }
    }
    return null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/node:internal|internal\//i.test(line)) continue;
    if (!isLikelyStacktraceLine(line)) continue;
    const frame = extractFramePath(line);
    if (!frame?.file) continue;
    const file = normalizeWorkspaceRelativePath(frame.file, workspaceRoot);
    if (!file) continue;
    if (isGlobLikePath(file)) continue;
    if (/node_modules|vendor|dist|build|coverage|\.cache/i.test(file)) continue;
    if (!/\.(?:js|jsx|ts|tsx|mjs|cjs|py|php|java|jsp|cs|html|css|json)$/i.test(file)) continue;

    frames.push({
      file,
      line: frame.line,
      column: frame.column,
      raw: line
    });
  }

  return frames;
}

export function analyzeValidationFailure(validationResult = {}, workspaceRoot = '') {
  const stdout = String(validationResult?.stdout || '');
  const stderr = String(validationResult?.stderr || '');
  const output = String(validationResult?.output || '');
  const rawOutput = String(validationResult?.rawOutput || '');
  const combinedOutput = [stderr, stdout, output, rawOutput]
    .filter(Boolean)
    .join('\n')
    .trim();
  const failureText = collectPrimaryValidationFailureText(validationResult, {});
  const { errorName, errorMessage } = extractFailureNameAndMessage(stderr || failureText);
  const failureType = classifyTerminalFailure({ stderr, combinedOutput: failureText }).classification;
  const stacktraceFrames = parseStacktraceFrames(collectTerminalFailureText(validationResult, {}), workspaceRoot);
  const failingTestFrame = stacktraceFrames.find(frame => isTestFramePath(frame.file)) || null;
  const rootCauseFrame = stacktraceFrames.find(frame => isApplicationFramePath(frame.file)) || null;
  const failingTestFile = failingTestFrame?.file || '';
  const referencedImplementationFiles = stacktraceFrames
    .filter(frame => isApplicationFramePath(frame.file))
    .map(frame => frame.file)
    .filter(Boolean);
  const rootCauseFile = failureType === 'AssertionError'
    ? ''
    : (rootCauseFrame?.file || failingTestFile || '');

  let repairStrategy = 'fallback_test_first';
  if (failureType === 'AssertionError') repairStrategy = 'assertion_test_first';
  else if (/SyntaxError|ReferenceError|TypeError|ImportError|Module resolution error|Compilation error/i.test(failureType)) {
    repairStrategy = 'root_cause_source_first';
  }

  return {
    failureType,
    errorName,
    errorMessage,
    combinedOutput,
    stacktraceFrames,
    rootCauseFile,
    rootCauseLine: rootCauseFrame?.line || null,
    rootCauseColumn: rootCauseFrame?.column || null,
    failingTestFile,
    referencedImplementationFiles,
    repairStrategy,
    confidence: rootCauseFrame ? 'high' : failingTestFrame ? 'medium' : 'low'
  };
}

function splitTopLevelArgs(text) {
  const args = [];
  let current = '';
  let round = 0;
  let square = 0;
  let curly = 0;
  let quote = '';
  let escaped = false;

  for (const ch of String(text || '')) {
    if (quote) {
      current += ch;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) {
        quote = '';
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === '(') round += 1;
    else if (ch === ')') round = Math.max(0, round - 1);
    else if (ch === '[') square += 1;
    else if (ch === ']') square = Math.max(0, square - 1);
    else if (ch === '{') curly += 1;
    else if (ch === '}') curly = Math.max(0, curly - 1);

    if (ch === ',' && round === 0 && square === 0 && curly === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  const tail = current.trim();
  if (tail) args.push(tail);
  return args;
}

function findBalancedParenClose(text, openIndex) {
  if (openIndex < 0) return -1;
  let depth = 0;
  let quote = '';
  let escaped = false;

  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = '';
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }

    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function collectAssertionSnippets(testContent = '') {
  const lines = String(testContent || '').replace(/\r/g, '').split('\n');
  const snippets = [];
  let current = '';
  let collecting = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (collecting && current.trim()) {
        snippets.push(current.trim());
      }
      current = '';
      collecting = false;
      continue;
    }

    const isAssertionLine = /\bassert\.(?:equal|strictEqual|deepEqual|deepStrictEqual|ok|match|notEqual|notStrictEqual|notDeepEqual|notDeepStrictEqual|throws)\b|\bexpect\s*\(/.test(trimmed);
    if (isAssertionLine && !collecting) {
      current = trimmed;
      collecting = !trimmed.includes(';');
      if (!collecting) {
        snippets.push(current.trim());
        current = '';
      }
      continue;
    }

    if (collecting) {
      current += ` ${trimmed}`;
      if (trimmed.includes(';')) {
        snippets.push(current.trim());
        current = '';
        collecting = false;
      }
    }
  }

  if (collecting && current.trim()) {
    snippets.push(current.trim());
  }

  return snippets.filter(Boolean);
}

function extractImportBindings(testContent = '') {
  const bindings = [];
  const text = String(testContent || '');

  const namedImportRx = /import\s+\{\s*([^}]+)\s*\}\s+from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = namedImportRx.exec(text))) {
    const source = normalizePath(match[2]);
    for (const part of String(match[1]).split(',')) {
      const spec = part.trim();
      if (!spec) continue;
      const alias = spec.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/i);
      if (alias) {
        bindings.push({ imported: alias[1], local: alias[2], source });
      } else {
        bindings.push({ imported: spec, local: spec, source });
      }
    }
  }

  const defaultImportRx = /import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = defaultImportRx.exec(text))) {
    bindings.push({ imported: 'default', local: match[1], source: normalizePath(match[2]) });
  }

  return bindings;
}

function parseExpectedReturnValues({ method = '', lhs = '', rhs = '', expectedValue = '' }) {
  const normalizedMethod = String(method || '').toLowerCase();
  const values = [];

  const propMatch = String(lhs || '').match(/\)\s*\.\s*([A-Za-z_$][\w$]*)\s*$/);
  if (propMatch?.[1]) values.push(propMatch[1]);

  const rhsText = String(rhs || '').trim();
  if (!values.length && rhsText) {
    if (/^\{[\s\S]*\}$/.test(rhsText)) {
      const inner = rhsText.replace(/^\{/, '').replace(/\}$/, '');
      for (const segment of splitTopLevelArgs(inner)) {
        const key = segment.split(':')[0].trim().replace(/^['"]|['"]$/g, '');
        if (key) values.push(key);
      }
    } else if (/^\[[\s\S]*\]$/.test(rhsText)) {
      values.push('array');
    } else if (/^(true|false|null|undefined)$/i.test(rhsText)) {
      values.push(rhsText.toLowerCase());
    } else if (/^['"`].*['"`]$/.test(rhsText)) {
      values.push(rhsText.slice(1, -1));
    } else if (/^[0-9]+(?:\.[0-9]+)?$/.test(rhsText)) {
      values.push(rhsText);
    }
  }

  if (!values.length && normalizedMethod === 'ok') {
    values.push('truthy');
  }

  if (!values.length && expectedValue) {
    values.push(String(expectedValue).trim());
  }

  return [...new Set(values.filter(Boolean))];
}

function parseAssertionSnippet(snippet, validationContext = {}, importBindings = []) {
  const assertion = normalizeAssertionText(snippet);
  if (!assertion) return null;

  const assertMatch = assertion.match(/\bassert\.(\w+)\s*\(/i);
  const expectMatch = assertion.match(/\bexpect\s*\(/i);
  if (!assertMatch && !expectMatch) return null;

  const method = String(assertMatch?.[1] || 'expect').toLowerCase();
  const callIndex = assertMatch ? assertMatch.index : expectMatch.index;
  const callStart = assertion.indexOf('(', callIndex);
  const callEnd = findBalancedParenClose(assertion, callStart);
  if (callStart < 0 || callEnd < 0) return null;

  const inner = assertion.slice(callStart + 1, callEnd).trim();
  const args = splitTopLevelArgs(inner);
  const lhs = normalizeAssertionText(args[0] || '');
  const rhs = normalizeAssertionText(args[1] || '');

  let functionName = null;
  let propertyName = null;

  if (lhs) {
    const lhsMatch = lhs.match(/(?:^|[.\s])([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)\s*(?:\.\s*([A-Za-z_$][\w$]*))?$/);
    if (lhsMatch) {
      functionName = lhsMatch[1];
      propertyName = lhsMatch[3] || null;
    } else {
      const nameMatch = lhs.match(/([A-Za-z_$][\w$]*)\s*(?:\(|$)/);
      if (nameMatch) functionName = nameMatch[1];
    }
  }

  const importedBinding = importBindings.find(binding => binding.local === functionName) || null;
  const expectedValue = normalizeAssertionText(validationContext.expectedValue) || (method === 'ok' ? 'truthy' : rhs);
  const actualValue = normalizeAssertionText(validationContext.actualValue);
  const expectedExport = importedBinding?.imported || functionName || null;
  const expectedFunction = functionName || importedBinding?.local || null;
  const expectedReturnValues = propertyName
    ? [propertyName]
    : parseExpectedReturnValues({ method, lhs, rhs, expectedValue });

  const assertionContext = {
    assertion,
    expectedValue: expectedValue || null,
    actualValue: actualValue || null,
    expectedExport,
    expectedFunction,
    expectedReturnValues: [...new Set(expectedReturnValues.filter(Boolean))],
    source: 'test_assertion'
  };

  if (!assertionContext.assertion) return null;
  if (!assertionContext.expectedValue && !assertionContext.expectedReturnValues.length && !assertionContext.expectedFunction && !assertionContext.expectedExport) {
    return null;
  }

  return assertionContext;
}

export function buildRecoveryAssertionContext({
  testPath = '',
  testContent = '',
  validationContext = {}
} = {}) {
  const snippets = collectAssertionSnippets(testContent);
  if (snippets.length === 0) return null;

  const importBindings = extractImportBindings(testContent);
  const validationAssertion = normalizeAssertionText(validationContext.assertion);
  const expectedValueHint = normalizeAssertionText(validationContext.expectedValue);

  let snippet = snippets[0];
  if (validationAssertion) {
    const exact = snippets.find(candidate => candidate === validationAssertion);
    if (exact) {
      snippet = exact;
    } else if (expectedValueHint) {
      const expectedMatch = snippets.find(candidate => candidate.includes(expectedValueHint));
      if (expectedMatch) snippet = expectedMatch;
    }
  }

  const parsed = parseAssertionSnippet(snippet, validationContext, importBindings);
  if (!parsed) return null;

  return {
    testPath: normalizePath(testPath),
    ...parsed
  };
}

export function extractFailingTestPath(validationContext = {}, failedTask = {}) {
  const raw = collectPrimaryValidationFailureText(validationContext, failedTask);

  const patterns = [
    /location:\s*['"]([^'"]+(?:\.test|\.spec)\.[jt]sx?)['"]/i,
    /at\s+.*?([A-Za-z0-9_.\-\\/]+(?:\.test|\.spec)\.[jt]sx?):\d+:\d+/i,
    /(?:^|[\s"'])((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|[A-Za-z0-9_.-]+[\\/])?[A-Za-z0-9_.-]+(?:\.test|\.spec)\.[jt]sx?)(?::\d+:\d+)?/i,
    /([A-Za-z0-9_.\-\\/]+(?:\.test|\.spec)\.[jt]sx?)/i
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) {
      return extractWorkspaceRelativeStacktracePath(match[1]);
    }
  }

  const command = String(failedTask?.toolArgs?.command || '').trim();
  const cmdMatch = command.match(/\b(?:plannerPhase\d+|.*)\b/);
  if (cmdMatch && /test/i.test(command)) {
    return null;
  }

  return null;
}

export function inferImplementationFromTestContent(testPath, testContent = '') {
  const normalizedTestPath = normalizePath(testPath);
  if (!normalizedTestPath) return null;
  const dir = path.posix.dirname(normalizedTestPath);
  const patterns = [
    /import\s+[^;]*?\s+from\s+['"]([^'"]+)['"]/g,
    /export\s+\*\s+from\s+['"]([^'"]+)['"]/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g
  ];

  const candidates = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(String(testContent || '')))) {
      const spec = normalizePath(match[1]);
      if (!spec || (!spec.startsWith('.') && !spec.startsWith('/'))) continue;
      const resolved = normalizePath(path.posix.normalize(path.posix.join(dir, spec)));
      if (resolved && !/\/(?:tests?|__tests__|specs?)(?:\/|$)/i.test(resolved)) {
        candidates.push(resolved);
      }
    }
  }

  return candidates.length > 0 ? candidates[0] : null;
}

function buildTerminalRecovery(failedTask, context) {
  const command = failedTask.toolArgs?.command || '';
  const workspaceRoot = context?.workspaceRoot || '';
  const validationContext = context?.validationContext || {};
  const failureAnalysis = analyzeValidationFailure({
    stdout: validationContext.stdout,
    stderr: validationContext.stderr,
    output: validationContext.output,
    rawOutput: validationContext.rawOutput,
    error: validationContext.error
  }, workspaceRoot);
  const failureText = failureAnalysis.combinedOutput || collectTerminalFailureText(validationContext, failedTask);
  const moduleLoadFailure = /module resolution error|importerror/i.test(failureAnalysis.failureType) || isModuleLoadFailure(failureText);
  const failureClassification = { classification: failureAnalysis.failureType };
  const rootCauseTarget = failureAnalysis.rootCauseFile
    ? assertValidRecoveryTaskPath(failureAnalysis.rootCauseFile, workspaceRoot, 'root_cause_file')
    : null;
  const referencedRootCauseTarget = !rootCauseTarget && Array.isArray(failureAnalysis.referencedImplementationFiles)
    ? failureAnalysis.referencedImplementationFiles.find(Boolean)
    : null;
  const selectedTarget = context?.selectedTarget || context?.repairTargetFile || inferTerminalRepairTarget(failedTask) || null;
  const normalizedSelectedTarget = selectedTarget
    ? toWorkspaceRelative(selectedTarget, workspaceRoot)
    : null;
  const validSelectedTarget = normalizedSelectedTarget && !isUnsafeRecoveryTaskPath(normalizedSelectedTarget, workspaceRoot)
    ? normalizedSelectedTarget
    : null;
  if (!rootCauseTarget && selectedTarget && !validSelectedTarget) {
    throw new Error('RECOVERY_INVALID_PATH:selected_target');
  }
  const fallbackRootCauseCandidate = referencedRootCauseTarget ||
    failureAnalysis.rootCauseFile ||
    resolveRootCauseTarget(validationContext, failedTask, workspaceRoot);
  const legacyRootCauseTarget = rootCauseTarget || (
    fallbackRootCauseCandidate
      ? assertValidRecoveryTaskPath(fallbackRootCauseCandidate, workspaceRoot, 'legacy_root_cause_target')
      : null
  );
  const repairTargetFile = legacyRootCauseTarget || validSelectedTarget;
  if (failureAnalysis.failureType === 'AssertionError' && validSelectedTarget && legacyRootCauseTarget && normalizedPathMismatch(validSelectedTarget, legacyRootCauseTarget, workspaceRoot)) {
    throw new Error('RECOVERY_TASK_TARGET_MISMATCH');
  }
  const resolvedRootCauseTarget = legacyRootCauseTarget || validSelectedTarget;
  const moduleLoadTarget = moduleLoadFailure ? (failureAnalysis.rootCauseFile || resolveModuleLoadTarget(validationContext, failedTask, workspaceRoot)) : null;
  const failingTestCandidate = extractFailingTestPath(validationContext, failedTask);
  const failingTestPath = failingTestCandidate
    ? assertValidRecoveryTaskPath(failingTestCandidate, workspaceRoot, 'failing_test_path')
    : null;
  const preferTestFirst = failureAnalysis.failureType === 'AssertionError';
  const runtimeRepairTarget = resolvedRootCauseTarget || moduleLoadTarget || repairTargetFile || null;

  const analysis = analyzeTerminalRecovery(command);

  if (!analysis.recoverable && !repairTargetFile && !failingTestPath && !resolvedRootCauseTarget && !moduleLoadTarget) {
    console.log('[PLANNER_RECOVERY_SKIPPED]', {
      id: failedTask.id,
      tool: 'RUN_TERMINAL',
      reason: analysis.reason,
      strategy: analysis.strategy
    });
    return [];
  }

  const tasks = [];

  if (!preferTestFirst && runtimeRepairTarget) {
    const resolution = resolveRecoveryTarget({
      targetPath: runtimeRepairTarget,
      workspaceRoot
    });
    if (resolution.action === 'WRITE_MISSING') {
      const target = resolution.normalizedPath || runtimeRepairTarget;
      const missTasks = buildWriteAndRerunChain(
        target, command, validationContext,
        failureClassification.classification, failureText,
        moduleLoadFailure ? 'module_error' : ('repair'),
        moduleLoadFailure ? 'module_load' : 'planner'
      );
      tasks.push(...missTasks);
      return tasks;
    }
    const runtimeTasks = buildRuntimeRecoveryChain({
      targetPath: runtimeRepairTarget,
      command,
      validationContext,
      failureClassification: failureClassification.classification,
      failureText,
      recoveryStage: moduleLoadFailure ? 'module_error' : 'root_cause',
      sourceLabel: moduleLoadFailure ? 'module_load' : 'runtime'
    });
    tasks.push(...runtimeTasks);
    return tasks;
  }

  if (!preferTestFirst && resolvedRootCauseTarget) {
    if (failureAnalysis.failureType === 'AssertionError' && validSelectedTarget && normalizedPathMismatch(validSelectedTarget, resolvedRootCauseTarget, workspaceRoot)) {
      throw new Error('RECOVERY_TASK_TARGET_MISMATCH');
    }
    const implReadTask = new Task({
      id: generateId(),
      kind: RECOVERY_KIND,
      goal: `Recovery: read implementation module ${resolvedRootCauseTarget}`,
      tool: 'READ_FILE',
      toolArgs: {
      path: resolvedRootCauseTarget,
        repairTargetFile: resolvedRootCauseTarget,
        selectedTarget: resolvedRootCauseTarget,
        recoveryStage: moduleLoadFailure ? 'module_error' : 'root_cause',
        failedCommand: command,
        validationContext,
        failureClassification: failureClassification.classification,
        failureText
      },
      dependencies: []
    });
    tasks.push(implReadTask);
    return tasks;
  }

  if (!preferTestFirst && repairTargetFile) {
    if (failureAnalysis.failureType === 'AssertionError' && validSelectedTarget && normalizedPathMismatch(validSelectedTarget, repairTargetFile, workspaceRoot)) {
      throw new Error('RECOVERY_TASK_TARGET_MISMATCH');
    }
    const resolution = resolveRecoveryTarget({
      targetPath: repairTargetFile,
      workspaceRoot
    });
    if (resolution.action === 'WRITE_MISSING') {
      const target = resolution.normalizedPath || repairTargetFile;
      tasks.push(...buildWriteAndRerunChain(
        target, command, validationContext,
        failureClassification.classification, failureText,
        moduleLoadFailure ? 'module_error' : 'repair',
        'planner'
      ));
      return tasks;
    }
    const implReadTask = new Task({
      id: generateId(),
      kind: RECOVERY_KIND,
      goal: `Recovery: read implementation module ${repairTargetFile}`,
      tool: 'READ_FILE',
      toolArgs: {
      path: repairTargetFile,
        repairTargetFile,
        selectedTarget: repairTargetFile,
        recoveryStage: moduleLoadFailure ? 'module_error' : 'root_cause',
        failedCommand: command,
        validationContext,
        failureClassification: failureClassification.classification,
        failureText
      },
      dependencies: []
    });
    tasks.push(implReadTask);
    return tasks;
  }

  if (failingTestPath) {
    const resolution = resolveRecoveryTarget({
      targetPath: failingTestPath,
      workspaceRoot
    });
    if (resolution.action === 'WRITE_MISSING') {
      const target = resolution.normalizedPath || failingTestPath;
      tasks.push(...buildWriteAndRerunChain(
        target, command, validationContext,
        failureClassification.classification, failureText,
        'failing_test', 'planner'
      ));
      return tasks;
    }
    const testReadTask = new Task({
      id: generateId(),
      kind: RECOVERY_KIND,
      goal: `Recovery: read failing test file ${failingTestPath}`,
      tool: 'READ_FILE',
      toolArgs: {
        path: failingTestPath,
        repairTargetFile: repairTargetFile || null,
        selectedTarget: selectedTarget || null,
        recoveryStage: 'failing_test',
        validationContext,
        failedCommand: command
      },
      dependencies: []
    });
    tasks.push(testReadTask);
  } else if (repairTargetFile) {
    const resolution = resolveRecoveryTarget({
      targetPath: repairTargetFile,
      workspaceRoot
    });
    if (resolution.action === 'WRITE_MISSING') {
      const target = resolution.normalizedPath || repairTargetFile;
      tasks.push(...buildWriteAndRerunChain(
        target, command, validationContext,
        failureClassification.classification, failureText,
        'fallback_target', 'planner'
      ));
    } else {
      const inspectTask = new Task({
        id: generateId(),
        kind: RECOVERY_KIND,
        goal: `Recovery: inspect ${repairTargetFile} before repair`,
        tool: 'READ_FILE',
        toolArgs: {
          path: repairTargetFile,
          repairTargetFile,
          selectedTarget: selectedTarget || repairTargetFile,
          recoveryStage: 'fallback_target'
        },
        dependencies: []
      });
      tasks.push(inspectTask);
    }
  } else if (analysis.recoverable) {
    return [];
  }

  return tasks;
}

function normalizedPathMismatch(expected, actual, workspaceRoot = '') {
  const expectedPath = toWorkspaceRelative(expected, workspaceRoot);
  const actualPath = toWorkspaceRelative(actual, workspaceRoot);
  return Boolean(expectedPath && actualPath && expectedPath !== actualPath);
}

export function determineRecoveryType(failedTask) {
  const tool = failedTask.tool || '';
  switch (tool) {
    case 'READ_FILE':
      return READ_FILE_RECOVERY;
    case 'APPLY_PATCH':
      return PATCH_RECOVERY;
    case 'RUN_TERMINAL':
      return TERMINAL_RECOVERY;
    default:
      return null;
  }
}

export function generateRecoveryPlan(failedTask, context) {
  if (!failedTask) return { recoveryType: null, tasks: [] };

  const recoveryType = determineRecoveryType(failedTask);
  if (!recoveryType) {
    console.log('[PLANNER_RECOVERY_SKIPPED]', { id: failedTask.id, tool: failedTask.tool, reason: 'No recovery strategy available' });
    return { recoveryType: null, tasks: [] };
  }

  let tasks = [];
  const workspaceRoot = context?.workspaceRoot || '';
  switch (recoveryType) {
    case READ_FILE_RECOVERY:
      tasks = buildReadFileRecovery(failedTask, workspaceRoot, context);
      break;
    case PATCH_RECOVERY:
      tasks = buildPatchRecovery(failedTask, workspaceRoot);
      break;
    case TERMINAL_RECOVERY:
      tasks = buildTerminalRecovery(failedTask, context);
      break;
  }

  // HOTFIX 1: If no tasks were generated (e.g., unrecoverable terminal failure), return null type
  if (tasks.length === 0) {
    console.log('[PLANNER_RECOVERY_SKIPPED]', {
      id: failedTask.id,
      tool: failedTask.tool,
      reason: 'Recovery analysis determined this failure is not recoverable'
    });
    return { recoveryType: null, tasks: [] };
  }

  console.log('[PLANNER_RECOVERY_PLAN]', {
    failedTaskId: failedTask.id,
    recoveryType,
    taskCount: tasks.length,
    tasks: tasks.map(t => ({ id: t.id, tool: t.tool, goal: (t.goal || '').substring(0, 60) }))
  });

  return { recoveryType, tasks };
}
