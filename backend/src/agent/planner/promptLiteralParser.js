import {
  buildWriteValidationPolicy,
  classifyWriteTargetRole,
  validateGeneratedContentWithPolicy
} from "../workspace.js";

const FILE_HEADER_OPS = new Set([
  'WRITE_FILE',
  'CREATE_FILE',
  'CREATE',
  'WRITE',
  'ADD',
  'IMPLEMENT',
  'GENERATE',
  'BUILD',
  'CONSTRUCT',
  'MODIFY',
  'UPDATE',
  'EDIT',
  'PATCH',
  'REPLACE',
  'REFACTOR',
  'FIX',
  'APPEND',
  'PREPEND',
  'INSERT'
]);

const CONTENT_INTRO_RX = /\b(?:with(?:\s+exactly)?|with\s+content|with|containing|that contains|as|to contain|so it contains|so it)\s*:\s*$/i;
const FENCE_RX = /^\s*```/;
function normalizePrompt(prompt) {
  return String(prompt || '').replace(/\r\n/g, '\n');
}

function stripPathDecorations(value) {
  return String(value || '')
    .trim()
    .replace(/^[`"'(<[{]+/, '')
    .replace(/[`)>\]}.,;:]+$/, '')
    .replace(/[`"']+$/, '')
    .trim();
}

function normalizePathKey(value) {
  return stripPathDecorations(value).replace(/\\/g, '/');
}

function extractPathToken(text) {
  const source = String(text || '').replace(/[()[\]{}<>]/g, ' ');
  const tokens = source.split(/\s+/).map(stripPathDecorations).filter(Boolean);
  for (const token of tokens) {
    if (/^(?:WRITE_FILE|CREATE_FILE|READ_FILE|RUN_TERMINAL|APPLY_PATCH|CREATE|WRITE|ADD|IMPLEMENT|GENERATE|BUILD|CONSTRUCT|MODIFY|UPDATE|EDIT|PATCH|REPLACE|REFACTOR|FIX|APPEND|PREPEND|INSERT|FILE|WITH|EXACTLY|CONTENT|CONTAINING|THAT|CONTAINS|AS|TO|SO|IT|RUN|THEN|ONLY|EXECUTE|VALIDATION|TEST|RECORD|RULES|EXPECTED|RECOVERY|QUALITY|GATE|PLANNER_COMPLETE_STOP|RUN_COMPLETION)$/i.test(token)) {
      continue;
    }
    if (/^[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)+$/.test(token) || /^[A-Za-z0-9_.-]+\.[A-Za-z0-9._-]+$/.test(token)) {
      return normalizePathKey(token);
    }
  }
  return null;
}

function hasContentIntro(trimmed) {
  return CONTENT_INTRO_RX.test(trimmed) || /\b(?:append|replace)\b/i.test(trimmed);
}

function classifyHeader(trimmed) {
  const text = String(trimmed || '').trim();
  if (!text) return null;
  const opMatch = /^(WRITE_FILE|CREATE_FILE|CREATE|WRITE|ADD|IMPLEMENT|GENERATE|BUILD|CONSTRUCT|MODIFY|UPDATE|EDIT|PATCH|REPLACE|REFACTOR|FIX|APPEND|PREPEND|INSERT)\b/i.exec(text);
  if (!opMatch) return null;

  const rawOp = opMatch[1].toUpperCase();
  const path = extractPathToken(text);
  if (!path) return null;

  let operation = 'write';
  if (rawOp === 'CREATE' || rawOp === 'CREATE_FILE') {
    operation = 'create';
  } else if (rawOp === 'APPEND' || rawOp === 'PREPEND' || rawOp === 'INSERT') {
    operation = 'append';
  } else if (rawOp === 'REPLACE') {
    operation = 'replace';
  } else if (rawOp === 'UPDATE' || rawOp === 'MODIFY' || rawOp === 'EDIT' || rawOp === 'PATCH' || rawOp === 'REFACTOR' || rawOp === 'FIX') {
    operation = 'update';
  }

  const allowPlainContent = rawOp === 'APPEND' || rawOp === 'PREPEND' || rawOp === 'INSERT' || hasContentIntro(text);
  const inlineContent = allowPlainContent && text.includes(':')
    ? stripPathDecorations(text.slice(text.indexOf(':') + 1))
    : '';

  return {
    path,
    operation,
    allowPlainContent,
    inlineContent,
    opener: rawOp,
    header: text
  };
}

function extractCommandsFromText(text = '') {
  const commands = [];
  const seen = new Set();
  const source = normalizePrompt(text);
  const lines = source.split('\n');
  const marker = /^(?:[-*]\s*)?(?:after\s+implementation\s+run|then\s+run\s+exactly|then\s+run|run\s+exactly\s+this\s+command|run\s+exactly|only\s+execute(?:\s+the\s+command)?|finally\s+run|run|execute|validation|test)\s*:?\s*(.*)$/i;
  const direct = /^(?:[-*]\s*)?(?:npm(?:\s+run)?\s+[A-Za-z0-9:_-]+(?:\s+--\s*.*)?|npm\s+test(?:\s+--\s*.*)?|pnpm(?:\s+run)?\s+[A-Za-z0-9:_-]+(?:\s+--\s*.*)?|pnpm\s+test(?:\s+--\s*.*)?|yarn(?:\s+run)?\s+[A-Za-z0-9:_-]+(?:\s+--\s*.*)?|yarn\s+test(?:\s+--\s*.*)?|node\s+--test\s+.+|node\s+(?:-e|--eval)\s+.+|node\s+[^\n.]+\.(?:m?js|cjs)|python3?\s+[^\n.]+\.py|pytest\b[^\n]*|go\s+test\b[^\n]*|cargo\s+(?:test|check)\b[^\n]*|dotnet\s+(?:test|build)\b[^\n]*|mvn\s+test\b[^\n]*|gradle\w*\s+(?:test|build)\b[^\n]*|flutter\s+(?:test|analy[sz]e)\b[^\n]*|dart\s+test\b[^\n]*)$/i;
  const shellFenceRx = /^```(?:bash|sh|shell|zsh|powershell|pwsh|cmd)?\s*$/i;
  const blockedCommandRx = /\b(?:do not|preserve deterministic|return|prompt|planner|validation|quality gate)\b/i;
  const allowedPrefixes = new Set([
    "npm", "yarn", "pnpm", "npx", "node", "bun", "deno",
    "python", "python3", "pytest", "vitest", "jest", "mocha",
    "tsc", "eslint", "git", "go", "cargo", "dotnet", "mvn",
    "gradle", "flutter", "dart"
  ]);

  function isValidShellCommand(candidate) {
    const cleaned = String(candidate || '').replace(/[.;,]\s*$/, '').trim();
    if (!cleaned) return false;
    if (/^\d+[.)]\s+[A-Z]/.test(cleaned)) return false;
    if (/^\d+[.)]\s+/.test(cleaned)) return false;
    if (blockedCommandRx.test(cleaned)) return false;
    if (/^(?:[-*]\s*)/.test(cleaned)) return false;
    if (/^(?:expected observations|planner creates|run_file_metadata|plannerDebugSnapshot)/i.test(cleaned)) return false;
    const firstToken = cleaned.split(/\s+/)[0].toLowerCase();
    return allowedPrefixes.has(firstToken);
  }

  function add(cmd) {
    const cleaned = String(cmd || '')
      .split('\n')[0]
      .replace(/\s+(?:do not|planner must|expected|acceptance|requirements?)\b[\s\S]*$/i, '')
      .replace(/[.;,]\s*$/, '')
      .trim();
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    commands.push(cleaned);
  }

  function addIfCommand(candidate) {
    const cleaned = String(candidate || '')
      .split('\n')[0]
      .replace(/[.;,]\s*$/, '')
      .trim();
    if (!cleaned) return false;
    if (!direct.test(cleaned)) return false;
    if (/^\d+[.)]\s+[A-Z]/.test(cleaned)) return false;
    if (/^\d+[.)]\s+/.test(cleaned)) return false;
    if (blockedCommandRx.test(cleaned)) return false;
    if (/^(?:[-*]\s*)/.test(cleaned)) return false;
    if (/^(?:do not|preserve deterministic|return|expected|planner creates|quality gate|run_file_metadata|plannerDebugSnapshot)/i.test(cleaned)) return false;
    const firstToken = cleaned.split(/\s+/)[0].toLowerCase();
    if (!allowedPrefixes.has(firstToken)) return false;
    add(cleaned);
    return true;
  }

  function isNumberedInstructionLine(trimmed) {
    return /^\d+[.)]\s+/.test(trimmed) || /^[ivxlcdm]+\.\s+/i.test(trimmed);
  }

  let expectCommand = false;
  let inShellFence = false;
  for (const line of lines) {
    const trimmed = String(line || '').trim();
    if (!trimmed) {
      continue;
    }

    if (shellFenceRx.test(trimmed)) {
      inShellFence = !inShellFence;
      continue;
    }

    if (inShellFence) {
      addIfCommand(trimmed);
      continue;
    }

    if (isNumberedInstructionLine(trimmed)) {
      continue;
    }

    const terminalMatch = /^RUN_TERMINAL\s+(.+)$/i.exec(trimmed);
    if (terminalMatch) {
      addIfCommand(terminalMatch[1]);
      continue;
    }

    const markerMatch = marker.exec(trimmed);
    if (markerMatch) {
      const remainder = String(markerMatch[1] || '').trim();
      if (remainder && addIfCommand(remainder)) {
        expectCommand = false;
      } else {
        expectCommand = true;
      }
      continue;
    }

    if (expectCommand) {
      if (direct.test(trimmed)) {
        addIfCommand(trimmed);
        expectCommand = false;
        continue;
      }
      continue;
    }

    if (direct.test(trimmed)) {
      add(trimmed);
    }
  }

  return commands.filter(isValidShellCommand);
}

function isBoundaryLine(trimmed) {
  if (!trimmed) return false;
  if (/^#{1,6}\s+/.test(trimmed)) return true;
  if (/^(?:Then\s+run(?:\s+exactly)?|Run(?:\s+exactly)?|Execute|Command|Validation|Test)\s*:?\s*$/i.test(trimmed)) return true;
  if (/^(?:Rules|Expected|Expected logs|Quality Gate|PLANNER_COMPLETE_STOP|RUN_COMPLETION|exitCode|stdout|stderr|Recovery)\b[:\s-]*$/i.test(trimmed)) return true;
  if (/^(?:If the test fails|If it fails|When it fails)\s*:?\s*$/i.test(trimmed)) return true;
  if (/^(?:â†[A-Za-z0-9]*|[↑↓←→]+)$/.test(trimmed)) return true;
  return false;
}

function trimContentLines(lines = []) {
  const copy = [...lines];
  while (copy.length && !String(copy[0] || '').trim()) copy.shift();
  while (copy.length && !String(copy[copy.length - 1] || '').trim()) copy.pop();
  return copy;
}

function directiveLikeContent(content) {
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
  const meaningful = lines.filter(line => String(line || '').trim());
  if (!meaningful.length) return true;
  const directiveLines = meaningful.filter(line =>
    /^(?:WRITE_FILE|CREATE_FILE|READ_FILE|RUN_TERMINAL|APPLY_PATCH|Recovery\b|QUALITY_GA|PLANNER_COMPLETE_STOP|RUN_COMPLETION|exitCode\b|stdout\b|stderr\b|Rules\b|Expected\b|Then\s+run\b|Run\b|Execute\b|#|â†[A-Za-z0-9]*|[↑↓←→]+)\b/i.test(String(line || '').trim())
  );
  if (directiveLines.length > 0) return true;
  return false;
}

export function validatePromptLiteralContent({
  path = '',
  content = '',
  prompt = '',
  operation = 'write',
  commands = [],
  projectContext = {},
  packageJson = null,
  detectedTestFramework = null
} = {}) {
  const targetPath = normalizePathKey(path);
  const text = String(content || '');
  const trimmed = text.trim();

  if (!targetPath) {
    return { success: false, error: 'Missing target path' };
  }

  if (!trimmed) {
    return { success: false, error: 'Missing literal content' };
  }

  if (directiveLikeContent(trimmed)) {
    return { success: false, error: 'Extracted content looks like planner directives' };
  }

  if (operation === 'append' && !trimmed.length) {
    return { success: false, error: 'Append content is empty' };
  }

  const role = classifyWriteTargetRole(targetPath, projectContext);
  const policy = buildWriteValidationPolicy({
    targetPath,
    role,
    projectContext,
    explicitPromptRequirements: commands,
    packageJson,
    detectedTestFramework: detectedTestFramework || 'generic-js-test',
    prompt
  });
  const validation = validateGeneratedContentWithPolicy(trimmed, policy);
  if (!validation.success) {
    return validation;
  }

  return { success: true, content: trimmed, path: targetPath, policy };
}

export function parsePromptFileLiterals(prompt = '') {
  const source = normalizePrompt(prompt);
  const lines = source.split('\n');
  const files = {};
  const commandSourceLines = [];
  let current = null;
  let inFence = false;

  console.log('[PROMPT_LITERAL_PARSE_START]', {
    promptLength: source.length
  });

  function recordFile(entry, reason = null) {
    if (!entry?.path) return;
    const normalizedPath = normalizePathKey(entry.path);
    const rawContent = trimContentLines(entry.contentLines || []);
    const content = rawContent.join('\n');
    const trimmed = content.trim();
    const existing = files[normalizedPath];

    if (trimmed) {
      const record = {
        content: content.replace(/\n+$/, ''),
        operation: entry.operation,
        source: entry.contentSource || 'plain_block',
        confidence: 'high'
      };
      if (!existing || !String(existing.content ?? '').trim()) {
        files[normalizedPath] = record;
        console.log('[PROMPT_LITERAL_FILE_FOUND]', {
          path: normalizedPath,
          operation: entry.operation,
          source: record.source,
          contentLength: record.content.length
        });
      }
    } else {
      if (!existing || !String(existing.content ?? '').trim()) {
        files[normalizedPath] = {
          content: undefined,
          operation: entry.operation,
          source: undefined,
          confidence: 'low'
        };
        console.log('[PROMPT_LITERAL_SKIPPED]', {
          path: normalizedPath,
          reason: reason || 'no_literal_content'
        });
      }
    }
  }

  function finalizeCurrent(reason = 'eof', boundary = null) {
    if (!current) return;
    if (boundary) {
      console.log('[PROMPT_LITERAL_BOUNDARY_STOP]', {
        path: current.path,
        boundary
      });
    }
    recordFile(current, reason);
    current = null;
    inFence = false;
  }

  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = String(rawLine || '').trim();

    if (current) {
      const header = !inFence ? classifyHeader(trimmed) : null;

      if (inFence) {
        if (FENCE_RX.test(trimmed)) {
          finalizeCurrent('fence');
          i += 1;
          continue;
        }
        current.contentLines.push(rawLine);
        i += 1;
        continue;
      }

      if (header) {
        commandSourceLines.push(rawLine);
        finalizeCurrent('next_directive', trimmed);
        continue;
      }

      if (isBoundaryLine(trimmed)) {
        commandSourceLines.push(rawLine);
        finalizeCurrent('boundary', trimmed);
        continue;
      }

      if (!trimmed) {
        if (current.allowPlainContent || current.contentLines.length > 0 || current.contentSource === 'fenced_block') {
          current.contentLines.push(rawLine);
        }
        i += 1;
        continue;
      }

      if (FENCE_RX.test(trimmed)) {
        current.contentSource = 'fenced_block';
        inFence = true;
        i += 1;
        continue;
      }

      if (current.allowPlainContent) {
        current.contentLines.push(rawLine);
        i += 1;
        continue;
      }

      finalizeCurrent('missing_literal', trimmed);
      continue;
    }

    commandSourceLines.push(rawLine);
    const header = classifyHeader(trimmed);
    if (header) {
      current = {
        path: header.path,
        operation: header.operation,
        allowPlainContent: header.allowPlainContent,
        contentSource: header.allowPlainContent ? 'plain_block' : undefined,
        contentLines: [],
        header: header.header
      };
      if (header.inlineContent) {
        current.contentLines.push(header.inlineContent);
      }
      i += 1;
      continue;
    }
    i += 1;
  }

  if (current) {
    recordFile(current, 'eof');
  }

  const commands = extractCommandsFromText(commandSourceLines.join('\n'));

  console.log('[PROMPT_LITERAL_PARSE_DONE]', {
    fileCount: Object.keys(files).length,
    commandCount: commands.length
  });

  return { files, commands };
}

export function extractPromptFileLiteral(prompt, file) {
  const parsed = parsePromptFileLiterals(prompt);
  const normalizedPath = normalizePathKey(file);
  return parsed.files[normalizedPath] || null;
}
