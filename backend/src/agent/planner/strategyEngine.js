const WRITE_TOOLS = new Set(['WRITE_FILE', 'APPLY_PATCH', 'CREATE_FILE', 'DELETE_FILE']);
const READ_TOOLS = new Set(['READ_FILE', 'LIST_FILES', 'SEARCH_CODE', 'SEARCH_SYMBOL']);
const TERMINAL_TOOLS = new Set(['RUN_TERMINAL']);

const READ_ONLY_KEYWORDS = [
  'read', 'open', 'inspect', 'check', 'review', 'show', 'display', 'print', 
  'dump', 'view', 'examine', 'find', 'look', 'tell', 'explain', 'analyze',
  'summarize', 'what is', 'what are', 'describe', 'output the', 'list'
];

const COMMAND_ONLY_KEYWORDS = [
  'only execute commands', 'do not modify source code', 'only run', 'just run',
  'run exactly this command', 'execute the command', 'do not create files',
  'run exactly', 'only execute the command'
];

const TERMINAL_COMMAND_KEYWORDS = [
  'npm', 'node', 'pnpm', 'yarn', 'bun', 'cargo', 'pytest', 'go test', 'dotnet',
  'mvn', 'gradle', 'make', 'python', 'php', 'ruby', 'composer'
];

const WRITE_KEYWORDS = [
  'create', 'write', 'add', 'implement', 'generate', 'build', 'construct', 
  'modify', 'update', 'edit', 'patch', 'replace', 'refactor', 'fix', 
  'delete', 'remove', 'append', 'prepend', 'insert', 'rename',
  'landing page', 'dashboard', 'login', 'crud', 'feature',
  'api', 'component', 'page', 'screen', 'form'
];

const DEBUG_KEYWORDS = [
  'error', 'failing', 'bug', 'ui issue', 'quality gate', 'needs_revision', 
  'stack trace', 'root cause', 'investigate', 'debug', 'why', 'how to fix'
];

const LOOP_KEYWORDS = [
  'loop', 'duplicate', 'retry', 'repeated', 'several times', 'many times',
  'times', 'again and again'
];

function normalizeText(text) {
  return String(text || '').toLowerCase();
}

function hasKeyword(text, keywords) {
  const normalized = normalizeText(text);
  return keywords.some(kw => normalized.includes(kw));
}

function hasExplicitNoWrite(text) {
  const normalized = normalizeText(text);
  const noModifyPattern = /\bdo\s+not\s+(?:modify|change|edit|write|create)(?:\s+(?:any\s+|some\s+)?(?:files?|file|code|source|anything))?\b/;
  const vietnamesePattern = /\b(khong|khong)\s+(sua|sửa|thay\s*doi|thay\s*đổi|viết|viet)\b/;
  return noModifyPattern.test(normalized) || vietnamesePattern.test(normalized);
}

function hasCommandOnlyIntent(text) {
  const normalized = normalizeText(text);
  return COMMAND_ONLY_KEYWORDS.some(kw => normalized.includes(kw));
}

export function selectExecutionStrategy(input = {}) {
  const {
    originalPrompt = '',
    taskMode,
    taskType,
    intentMode,
    requiredFiles = [],
    requiredCommands = [],
    projectType,
    plannerTasks = [],
    forbiddenTools = []
  } = input;

  const text = normalizeText(originalPrompt);
  const reasons = [];
  let strategy = 'INVESTIGATE_THEN_EDIT';
  let confidence = 0.5;

  const isReadOnlyTaskType = ['CHAT', 'SEARCH', 'ANALYSIS'].includes(String(taskType || '').toUpperCase());
  const isReadOnlyMode = taskMode === 'read_only' || intentMode === 'READ_ONLY';
  const hasNoWriteExplicit = hasExplicitNoWrite(originalPrompt);
  const hasTerminalCommand = hasKeyword(text, TERMINAL_COMMAND_KEYWORDS);
  const hasCommandOnly = hasCommandOnlyIntent(originalPrompt);
  const hasLoopIntentResult = hasLoopIntent(originalPrompt);

  // Priority order:
  // 1. READ_ONLY task types/modes are never overridden (except by terminal command intent)
  // 2. LOOP_SAFE_RETRY has higher priority than pure read-only
  // 3. INVESTIGATE_THEN_EDIT for debug intent (ambiguous debug/bugfix request)
  // 4. EDIT_AND_VALIDATE for explicit write intent
  // 5. COMMAND_ONLY for explicit command-only prompts
  // 6. Read-only defaults (hasNoWriteExplicit without terminal commands)
  const hasTerminalCommandRequested = hasTerminalCommand && requiredCommands.length > 0;
  
  if ((isReadOnlyTaskType || isReadOnlyMode) && !hasTerminalCommandRequested) {
    strategy = 'READ_ONLY';
    confidence = hasNoWriteExplicit ? 0.9 : 0.8;
    reasons.push('Task type or mode indicates read-only intent');
    if (hasNoWriteExplicit) reasons.push('Explicit "do not modify" instruction detected');
  } else if (hasLoopIntentResult) {
    strategy = 'LOOP_SAFE_RETRY';
    confidence = hasNoWriteExplicit ? 0.85 : 0.85;
    reasons.push('Prompt involves loop/retry behavior');
    if (hasNoWriteExplicit) reasons.push('Explicit "do not modify" instruction detected');
  } else if (hasDebugIntent(originalPrompt, plannerTasks)) {
    strategy = 'INVESTIGATE_THEN_EDIT';
    confidence = 0.8;
    reasons.push('Ambiguous debug/bugfix request detected');
  } else if (hasWriteIntent(originalPrompt, requiredFiles)) {
    strategy = 'EDIT_AND_VALIDATE';
    confidence = 0.9;
    reasons.push('Explicit write/edit intent detected');
  } else if (hasCommandOnly || hasTerminalCommandRequested) {
    strategy = 'COMMAND_ONLY';
    confidence = 0.95;
    reasons.push(hasTerminalCommand ? 'Terminal command requested with no-write constraint' : 'Explicit command-only instruction detected');
  } else if (requiredCommands.length > 0) {
    strategy = 'COMMAND_ONLY';
    confidence = 0.85;
    reasons.push('Command requested without read-only keywords');
  } else {
    strategy = 'READ_ONLY';
    confidence = 0.6;
    reasons.push('No explicit write or command intent — default to read-only');
  }

  const constraints = buildConstraints(strategy, hasNoWriteExplicit, hasCommandOnly);

  console.log('[STRATEGY_SELECTED]', {
    strategy,
    confidence,
    reasons,
    constraints
  });

  return {
    strategy,
    confidence,
    reasons,
    constraints
  };
}

function hasWriteIntent(text, requiredFiles) {
  const normalized = normalizeText(text);
  // Exclude "do not modify" patterns - they indicate NO write intent
  if (hasExplicitNoWrite(text)) return false;
  if (hasKeyword(normalized, WRITE_KEYWORDS)) return true;
  if (requiredFiles.length > 0 && hasKeyword(normalized, ['create', 'write', 'add', 'implement', 'build'])) return true;
  return false;
}

function hasDebugIntent(text, plannerTasks) {
  const normalized = normalizeText(text);
  // Exclude "do not modify" patterns for debug intent too
  if (hasExplicitNoWrite(text)) return false;
  if (hasKeyword(normalized, DEBUG_KEYWORDS)) return true;
  
  const hasErrorContext = plannerTasks.some(t => {
    const goal = String(t.goal || '').toLowerCase();
    return goal.includes('error') || goal.includes('fail') || goal.includes('bug');
  });

  return hasErrorContext;
}

function hasLoopIntent(text) {
  return hasKeyword(text, LOOP_KEYWORDS);
}

function buildConstraints(strategy, noWrite, commandOnly) {
  const base = {
    allowWrites: true,
    allowTerminal: true,
    requireValidation: true,
    maxRepairAttempts: 3
  };

  switch (strategy) {
    case 'READ_ONLY':
      return {
        ...base,
        allowWrites: false,
        allowTerminal: false,
        requireValidation: false,
        maxRepairAttempts: 0
      };
    case 'COMMAND_ONLY':
      return {
        ...base,
        allowWrites: false,
        allowTerminal: true,
        requireValidation: false,
        maxRepairAttempts: noWrite ? 0 : 1
      };
    case 'EDIT_AND_VALIDATE':
      return {
        ...base,
        allowWrites: true,
        allowTerminal: true,
        requireValidation: true,
        maxRepairAttempts: 3
      };
    case 'INVESTIGATE_THEN_EDIT':
      return {
        ...base,
        allowWrites: true,
        allowTerminal: true,
        requireValidation: true,
        maxRepairAttempts: 2
      };
    case 'LOOP_SAFE_RETRY':
      return {
        ...base,
        allowWrites: noWrite ? false : true,
        allowTerminal: true,
        requireValidation: false,
        maxRepairAttempts: noWrite ? 1 : 2
      };
    default:
      return base;
  }
}

export function isToolAllowedByStrategy(strategy, toolName, constraints = null) {
  const ctx = constraints || buildConstraints(strategy, false, false);
  
  if (WRITE_TOOLS.has(toolName)) {
    return ctx.allowWrites !== false;
  }
  
  if (TERMINAL_TOOLS.has(toolName)) {
    return ctx.allowTerminal !== false;
  }
  
  if (READ_TOOLS.has(toolName)) {
    return true;
  }
  
  return true;
}