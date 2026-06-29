function tokenizeCommand(command = '') {
  const text = String(command || '').trim();
  if (!text) return [];
  const tokens = [];
  const rx = /"([^"]*)"|'([^']*)'|`([^`]*)`|(\S+)/g;
  let match;
  while ((match = rx.exec(text))) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? match[4] ?? '');
  }
  return tokens.filter(Boolean);
}

function normalizeToken(token = '') {
  return String(token || '').trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1').replace(/^`(.*)`$/, '$1');
}

export function normalizeCommand(command = '') {
  return tokenizeCommand(command)
    .map(normalizeToken)
    .filter(Boolean)
    .join(' ');
}

export function isSameCommand(a = '', b = '') {
  return normalizeCommand(a) === normalizeCommand(b);
}

const VALIDATION_HEURISTICS = [
  { rule: 'npm-test', rx: /^npm\s+(?:--silent|-s\s+)?test\b/i },
  { rule: 'npm-run', rx: /^npm\s+(?:--silent|-s\s+)?run\s+[A-Za-z0-9:_\-]+\b/i },
  { rule: 'npm-build', rx: /^npm\s+(?:--silent|-s\s+)?run\s+build\b/i },
  { rule: 'pnpm-test', rx: /^pnpm\s+(?:--silent|-s\s+)?test\b/i },
  { rule: 'pnpm-run', rx: /^pnpm\s+(?:--silent|-s\s+)?run\s+[A-Za-z0-9:_\-]+\b/i },
  { rule: 'pnpm-build', rx: /^pnpm\s+(?:--silent|-s\s+)?build\b/i },
  { rule: 'yarn-test', rx: /^yarn\s+(?:--silent|-s\s+)?test\b/i },
  { rule: 'yarn-run', rx: /^yarn\s+(?:--silent|-s\s+)?run\s+[A-Za-z0-9:_\-]+\b/i },
  { rule: 'yarn-build', rx: /^yarn\s+(?:--silent|-s\s+)?build\b/i },
  { rule: 'node-test', rx: /^node\s+--test\b/i },
  { rule: 'node-check', rx: /^node\s+--check\b/i },
  { rule: 'node-file', rx: /^node\s+[^\s]+\.m?js\b/i },
  { rule: 'python-script', rx: /^python\s+[^-\s][^\n]*\.py\b/i },
  { rule: 'python3-script', rx: /^python3\s+[^-\s][^\n]*\.py\b/i },
  { rule: 'python-m-pytest', rx: /^python\s+-m\s+pytest\b/i },
  { rule: 'pytest', rx: /\bpytest\b/i },
  { rule: 'cargo-test', rx: /\bcargo\s+test\b/i },
  { rule: 'cargo-check', rx: /\bcargo\s+check\b/i },
  { rule: 'go-test', rx: /\bgo\s+test\b/i },
  { rule: 'dotnet-test', rx: /\bdotnet\s+test\b/i },
  { rule: 'dotnet-build', rx: /\bdotnet\s+build\b/i },
  { rule: 'mvn-test', rx: /\bmvn\s+test\b/i },
  { rule: 'gradle-test', rx: /\bgradle\w*\s+test\b/i },
  { rule: 'gradle-build', rx: /\bgradle\w*\s+build\b/i },
  { rule: 'flutter-test', rx: /^flutter\s+test\b/i },
  { rule: 'flutter-analyze', rx: /^flutter\s+analy[sz]e\b/i },
  { rule: 'dart-test', rx: /^dart\s+test\b/i }
];

function classifyHeuristicCommand(command = '') {
  const cmd = String(command || '').trim();
  for (const { rule, rx } of VALIDATION_HEURISTICS) {
    if (rx.test(cmd)) return { matched: true, rule };
  }
  return { matched: false, rule: '' };
}

function toTerminalRecord(item, index = 0) {
  if (typeof item === 'string') {
    return {
      index,
      command: item,
      normalizedCommand: normalizeCommand(item),
      success: true,
      exitCode: 0,
      raw: item
    };
  }
  if (!item || typeof item !== 'object') return null;
  const command = String(item.args?.command || item.result?.command || item.command || '').trim();
  return {
    index,
    command,
    normalizedCommand: normalizeCommand(command),
    success: item.success === true,
    exitCode: item.result?.exitCode ?? item.exitCode ?? item.result?.statusCode ?? item.result?.code ?? null,
    raw: item
  };
}

function uniqueByNormalized(entries = []) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    if (!entry) continue;
    const key = entry.normalizedCommand || normalizeCommand(entry.command);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

export function isValidationCommand(command = '') {
  return classifyHeuristicCommand(command).matched;
}

export function matchValidationCommand({
  requiredCommands = [],
  terminalCommands = [],
  projectContext = '',
  packageManager = ''
} = {}) {
  const requiredEntries = uniqueByNormalized(
    (Array.isArray(requiredCommands) ? requiredCommands : []).map((command, index) => ({
      index,
      command: String(command || '').trim(),
      normalizedCommand: normalizeCommand(command)
    }))
  );
  const terminalEntries = (Array.isArray(terminalCommands) ? terminalCommands : [])
    .map((item, index) => toTerminalRecord(item, index))
    .filter(Boolean);

  const successfulTerminals = terminalEntries.filter(entry =>
    entry.success === true &&
    (entry.exitCode === 0 || entry.exitCode === null || entry.exitCode === undefined)
  );

  if (requiredEntries.length > 0) {
    const matchedCommands = [];
    const failedCommands = [];
    const unmatchedRequiredCommands = [];
    const executedValidationCommands = [];

    for (const required of requiredEntries) {
      const matchingExecutions = terminalEntries.filter(entry =>
        entry.normalizedCommand && entry.normalizedCommand === required.normalizedCommand
      );
      const executed = matchingExecutions.length > 0;
      const successfulMatch = matchingExecutions.find(entry =>
        entry.success === true &&
        (entry.exitCode === 0 || entry.exitCode === null || entry.exitCode === undefined)
      ) || null;
      const failedMatch = matchingExecutions.find(entry =>
        entry.success === false ||
        (entry.exitCode !== null && entry.exitCode !== undefined && entry.exitCode !== 0)
      ) || null;

      if (executed) {
        executedValidationCommands.push({
          requiredCommand: required.command,
          executedCommand: matchingExecutions[0]?.command || required.command,
          exitCode: matchingExecutions[0]?.exitCode ?? null,
          success: Boolean(successfulMatch),
          matchType: successfulMatch
            ? (isSameCommand(required.command, successfulMatch.command) ? 'exact' : 'normalized')
            : 'required'
        });
      } else {
        unmatchedRequiredCommands.push(required.command);
      }

      if (successfulMatch) {
        matchedCommands.push({
          requiredCommand: required.command,
          executedCommand: successfulMatch.command,
          exitCode: successfulMatch.exitCode ?? 0,
          success: true,
          matchType: isSameCommand(required.command, successfulMatch.command) ? 'exact' : 'normalized'
        });
      } else if (failedMatch) {
        failedCommands.push({
          requiredCommand: required.command,
          executedCommand: failedMatch.command,
          exitCode: failedMatch.exitCode ?? 1,
          success: false,
          matchType: isSameCommand(required.command, failedMatch.command) ? 'exact' : 'normalized'
        });
      }
    }

    return {
      hasRequiredCommands: true,
      validationRan: executedValidationCommands.length > 0,
      validationPassed: requiredEntries.every(required =>
        matchedCommands.some(match => normalizeCommand(match.requiredCommand) === required.normalizedCommand)
      ),
      matchedCommands,
      failedCommands,
      unmatchedRequiredCommands,
      executedValidationCommands,
      requiredCommands: requiredEntries.map(entry => entry.command),
      terminalCommands: terminalEntries.map(entry => entry.command),
      projectContext: String(projectContext || ''),
      packageManager: String(packageManager || '')
    };
  }

  const executedValidationCommands = terminalEntries
    .map(entry => {
      const heuristic = classifyHeuristicCommand(entry.command);
      return heuristic.matched ? { ...entry, heuristic } : null;
    })
    .filter(Boolean);
  const matchedCommands = executedValidationCommands
    .filter(entry => entry.success === true && (entry.exitCode === 0 || entry.exitCode === null || entry.exitCode === undefined))
    .map(entry => ({
      requiredCommand: entry.command,
      executedCommand: entry.command,
      exitCode: entry.exitCode ?? 0,
      success: true,
      matchType: entry.heuristic.rule
    }));
  const failedCommands = executedValidationCommands
    .filter(entry => entry.success === false || (entry.exitCode !== null && entry.exitCode !== undefined && entry.exitCode !== 0))
    .map(entry => ({
      requiredCommand: entry.command,
      executedCommand: entry.command,
      exitCode: entry.exitCode ?? 1,
      success: false,
      matchType: entry.heuristic.rule
    }));

  return {
    hasRequiredCommands: false,
    validationRan: executedValidationCommands.length > 0,
    validationPassed: matchedCommands.length > 0,
    matchedCommands,
    failedCommands,
    unmatchedRequiredCommands: [],
    executedValidationCommands: executedValidationCommands.map(entry => ({
      command: entry.command,
      exitCode: entry.exitCode,
      success: entry.success,
      matchType: entry.heuristic.rule
    })),
    requiredCommands: [],
    terminalCommands: terminalEntries.map(entry => entry.command),
    projectContext: String(projectContext || ''),
    packageManager: String(packageManager || '')
  };
}

export function getValidationMatchSummary(options = {}) {
  return matchValidationCommand(options);
}
