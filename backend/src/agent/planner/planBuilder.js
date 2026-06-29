import crypto from 'node:crypto';
import { Task } from './task.js';
import { parsePromptFileLiterals } from './promptLiteralParser.js';

function prioritizeValidationCommands(commands = []) {
  const specific = [];
  const others = [];
  const generic = [];

  for (const cmd of (commands || []).map(cmd => String(cmd || '').trim()).filter(Boolean)) {
    if (/^npm\s+test\s+--\s+.+/i.test(cmd)) {
      specific.push(cmd);
    } else if (/^npm\s+test\b/i.test(cmd)) {
      generic.push(cmd);
    } else {
      others.push(cmd);
    }
  }

  return [...specific, ...others, ...generic];
}

export function extractCommands(text) {
  const commands = [];
  const seen = new Set();
  const source = String(text || '').replace(/\r\n/g, '\n');
  const lines = source.split('\n');
  const marker = /^(?:[-*]\s*)?(?:after\s+implementation\s+run|then\s+run\s+exactly|then\s+run|run\s+exactly\s+this\s+command|run\s+exactly|only\s+execute(?:\s+the\s+command)?|finally\s+run|run|execute|validation|test)\s*:\s*(.*)$/i;
  const inlineMarker = /(?:^|[.!?]\s+)(?:after\s+implementation\s+run|then\s+run\s+exactly|then\s+run|run\s+exactly\s+this\s+command|run\s+exactly|only\s+execute(?:\s+the\s+command)?|finally\s+run)\s*:\s*(.+)$/i;
  const embeddedMarker = /(?:^|[\s.!?])(?:after\s+implementation\s+run|then\s+run\s+exactly|then\s+run|run\s+exactly\s+this\s+command|run\s+exactly|only\s+execute(?:\s+the\s+command)?|finally\s+run)\s*:?\s*(.+)$/i;
  const direct = /^(?:[-*]\s*)?(?:npm(?:\s+run)?\s+[A-Za-z0-9:_-]+(?:\s+--\s*.*)?|npm\s+test(?:\s+--\s*.*)?|pnpm(?:\s+run)?\s+[A-Za-z0-9:_-]+(?:\s+--\s*.*)?|pnpm\s+test(?:\s+--\s*.*)?|yarn(?:\s+run)?\s+[A-Za-z0-9:_-]+(?:\s+--\s*.*)?|yarn\s+test(?:\s+--\s*.*)?|node\s+--test\s+.+|node\s+(?:-e|--eval)\s+.+|node\s+[^\n.]+\.(?:m?js|cjs)|python3?\s+[^\n.]+\.py|pytest\b[^\n]*|go\s+test\b[^\n]*|cargo\s+(?:test|check)\b[^\n]*|dotnet\s+(?:test|build)\b[^\n]*|mvn\s+test\b[^\n]*|gradle\w*\s+(?:test|build)\b[^\n]*|flutter\s+(?:test|analy[sz]e)\b[^\n]*|dart\s+test\b[^\n]*)$/i;

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
    const cleaned = String(candidate || '').replace(/[.;,]\s*$/, '').trim();
    if (!cleaned) return false;
    if (!direct.test(cleaned)) return false;
    add(cleaned);
    return true;
  }

  let expectCommand = false;
  let suppressDirectCommands = false;
  for (const line of lines) {
    const trimmed = String(line || '').trim();
    if (!trimmed) {
      if (!expectCommand) suppressDirectCommands = false;
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
      if (remainder) {
        addIfCommand(remainder);
      } else {
        expectCommand = true;
      }
      continue;
    }

    const inlineMatch = inlineMarker.exec(trimmed);
    if (inlineMatch) {
      const remainder = String(inlineMatch[1] || '').trim();
      if (remainder) addIfCommand(remainder);
      continue;
    }

    if (/\bwith\s+(?:value|content)\s*:\s*$/i.test(trimmed)) {
      suppressDirectCommands = true;
      continue;
    }

    if (expectCommand) {
      if (direct.test(trimmed)) {
        add(trimmed);
        expectCommand = false;
        continue;
      }
      // Keep waiting until we reach an actual command line.
      continue;
    }

    if (!suppressDirectCommands && direct.test(trimmed)) {
      add(trimmed);
      continue;
    }

    const embeddedMatch = embeddedMarker.exec(trimmed);
    if (embeddedMatch) {
      const remainder = String(embeddedMatch[1] || '').trim();
      if (remainder) addIfCommand(remainder);
    }
  }

  return prioritizeValidationCommands(commands);
}

export function expandRepeatedCommands(objective, commands = []) {
  const text = String(objective || '').replace(/\r\n/g, '\n');
  const expanded = [];
  for (const cmd of commands) {
    const escaped = cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(String.raw`(?:^|\n)\s*(?:then\s+run|run|execute|finally\s+run)\s*:\s*${escaped}`, 'gi'),
      new RegExp(String.raw`(?:^|\n)\s*(?:then\s+run|run|execute|finally\s+run)\s+${escaped}`, 'gi'),
      new RegExp(String.raw`(?:^|\n)\s*${escaped}\s*(?:\n|$)`, 'gi')
    ];
    let count = 0;
    for (const rx of patterns) {
      count = Math.max(count, [...text.matchAll(rx)].length);
    }
    const repetitions = Math.max(1, count);
    for (let i = 0; i < repetitions; i += 1) expanded.push(cmd);
  }
  return expanded;
}

function findClosestKeyword(text, file, keywords) {
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fileIdx = text.toLowerCase().indexOf(file.toLowerCase());
  if (fileIdx === -1) return Infinity;

  let minDist = Infinity;
  for (const kw of keywords) {
    const kwIdx = text.toLowerCase().lastIndexOf(kw.toLowerCase(), fileIdx);
    if (kwIdx !== -1 && fileIdx - kwIdx <= 120 && fileIdx - kwIdx < minDist) {
      minDist = fileIdx - kwIdx;
    }
  }
  return minDist;
}

const READ_WORDS = ['read','open','inspect','check','review','show','display','print','dump','view','examine','find','look','tell','list','READ_FILE'];
const WRITE_WORDS = ['create','write','add','implement','generate','build','construct','modify','update','change','edit','patch','replace','refactor','fix','delete','remove','append','prepend','insert','rename','WRITE_FILE','CREATE_FILE','APPLY_PATCH'];

export function classifyReadWriteFiles(objective, files) {
  const readFiles = [];
  const writeFiles = [];
  const text = String(objective || '');

  for (const file of files) {
    const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const readPattern = new RegExp(
      `\\b(?:${READ_WORDS.join('|')})\\b[\\s\\S]{0,120}?${escaped}`, 'i'
    );
    const writePattern = new RegExp(
      `\\b(?:${WRITE_WORDS.join('|')})\\b[\\s\\S]{0,120}?${escaped}`, 'i'
    );

    const isRead = readPattern.test(text);
    const isWrite = writePattern.test(text);

    if (isWrite && !isRead) {
      writeFiles.push(file);
    } else if (isRead && !isWrite) {
      readFiles.push(file);
    } else if (isRead && isWrite) {
      // Both match — use proximity: closer keyword determines intent
      const readDist = findClosestKeyword(text, file, READ_WORDS);
      const writeDist = findClosestKeyword(text, file, WRITE_WORDS);
      if (writeDist < readDist) {
        writeFiles.push(file);
      } else {
        readFiles.push(file);
      }
    } else {
      console.log('[PLANNER_SKIPPED_FILE_NO_INTENT]', { file, reason: 'no read or write intent detected' });
    }
  }

  return { readFiles, writeFiles };
}

function hasWriteIntent(objective) {
  const text = String(objective || '');
  // Tool-name prefixes like WRITE_FILE, CREATE_FILE, APPLY_PATCH also indicate write intent
  if (/^(?:WRITE_FILE|CREATE_FILE|APPLY_PATCH)\s/m.test(text)) return true;
  return /\b(?:create|write|add|implement|generate|build|construct|modify|update|change|edit|patch|replace|refactor|fix|delete|remove|append|prepend|insert|rename)\b/i.test(text);
}

function expandRepeatedReadFiles(objective, files) {
  const text = String(objective || '');
  const expanded = [];
  for (const file of files) {
    const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(`\\b(?:read|open|inspect|check|review|show|display|view|examine)\\b[\\s\\S]{0,80}?${escaped}`, 'gi');
    const matches = [...text.matchAll(rx)];
    const count = Math.max(1, matches.length);
    for (let i = 0; i < count; i += 1) expanded.push(file);
  }
  return expanded;
}

export function extractWriteContent(objective, file) {
  if (!objective || !file) return null;
  const parsed = parsePromptFileLiterals(objective);
  const record = parsed.files[String(file).replace(/\\/g, '/')];
  const content = String(record?.content ?? '').trim();
  return content || null;
}

export function buildPlan(objective, criteria) {
  if (!objective) return { tasks: [] };
  const tasks = [];
  const kind = criteria?.taskType || 'CODING';
  const reqFiles = criteria?.requestedFiles || [];
  const explicitCommands = extractCommands(objective);
  const requiredCommands = prioritizeValidationCommands(expandRepeatedCommands(
    objective,
    explicitCommands.length > 0 ? explicitCommands : (criteria?.requiredCommands || [])
  ));
  const isReadKind = kind === 'ANALYSIS' || kind === 'SEARCH';

  if (isReadKind && reqFiles.length > 0) {
    const readTaskIds = [];
    for (const file of expandRepeatedReadFiles(objective, reqFiles)) {
      const readTaskId = crypto.randomUUID();
      readTaskIds.push(readTaskId);
      tasks.push(new Task({
        id: readTaskId,
        kind,
        goal: `Read file: ${file}`,
        tool: 'READ_FILE',
        toolArgs: { path: file },
        dependencies: [],
        failureNext: 'recovery:' + readTaskId
      }));
    }
    for (const cmd of requiredCommands) {
      const cmdId = crypto.randomUUID();
      tasks.push(new Task({
        id: cmdId,
        kind,
        goal: `Run command: ${cmd}`,
        tool: 'RUN_TERMINAL',
        toolArgs: { command: cmd },
        dependencies: readTaskIds.length > 0 ? readTaskIds : [],
        failureNext: 'recovery:' + cmdId
      }));
    }
  } else if (!isReadKind) {
    // Phase 4.10+: Detect write targets and decompose into concrete tasks
    const { readFiles, writeFiles } = classifyReadWriteFiles(objective, reqFiles);

    if (writeFiles.length > 0 && hasWriteIntent(objective)) {
      const readTaskIds = [];
      const writeTaskIds = [];

      for (const file of readFiles) {
        const taskId = crypto.randomUUID();
        readTaskIds.push(taskId);
        tasks.push(new Task({
          id: taskId,
          kind,
          goal: `Read file: ${file}`,
          tool: 'READ_FILE',
          toolArgs: { path: file },
          dependencies: [],
          failureNext: 'recovery:' + taskId
        }));
      }

      // For each write target not already in readFiles, add a READ_FILE task
      // so the model can read existing content before editing.
      // Only add when the intent verb is an edit-style verb (not create-style).
      const EDIT_VERBS = 'append|prepend|insert|modify|update|edit|replace|rename|change|patch|refactor|fix|add';
      for (const file of writeFiles) {
        if (readFiles.includes(file)) continue;
        const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const editPattern = new RegExp(`\\b(?:${EDIT_VERBS})\\b[\\s\\S]{0,80}?${escaped}`, 'i');
        if (editPattern.test(String(objective || ''))) {
          const taskId = crypto.randomUUID();
          readTaskIds.push(taskId);
          tasks.push(new Task({
            id: taskId,
            kind,
            goal: `Read file: ${file}`,
            tool: 'READ_FILE',
            toolArgs: { path: file },
            dependencies: [],
            failureNext: 'recovery:' + taskId
          }));
        }
      }

      for (const file of writeFiles) {
        // Validate: reject WRITE_FILE without explicit write intent
        const fileWritePattern = new RegExp(
          `\\b(?:create|write|add|implement|generate|build|construct|modify|update|change|edit|patch|replace|refactor|fix|delete|remove|append|prepend|insert|rename|WRITE_FILE|CREATE_FILE|APPLY_PATCH)\\b[\\s\\S]{0,120}?${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'
        );
        const hasExplicitWriteIntent = fileWritePattern.test(String(objective || ''));
        if (!hasExplicitWriteIntent) {
          console.log('[PLANNER_INVALID_TASK_REJECTED]', { file, reason: 'invalid_write_detection', action: 'promoting to READ_FILE' });
          const taskId = crypto.randomUUID();
          readTaskIds.push(taskId);
          tasks.push(new Task({
            id: taskId,
            kind,
            goal: `Read file: ${file}`,
            tool: 'READ_FILE',
            toolArgs: { path: file },
            dependencies: [],
            failureNext: 'recovery:' + taskId
          }));
          continue;
        }

        const taskId = crypto.randomUUID();
        writeTaskIds.push(taskId);
        const content = extractWriteContent(objective, file);
        const hasContent = content !== null && content.length > 0;

        // Even without inline content, keep the write intent concrete so the
        // planner can constrain the model to produce the content next.
        if (!hasContent) {
          console.log('[PLANNER_INVALID_TASK_REJECTED]', { file, reason: 'no_write_content', action: 'keeping concrete WRITE_FILE task' });
          tasks.push(new Task({
            id: taskId,
            kind,
            goal: `Write file: ${file}`,
            tool: 'WRITE_FILE',
            toolArgs: { path: file, file },
            dependencies: readTaskIds.length > 0 ? [...readTaskIds] : [],
            failureNext: 'recovery:' + taskId
          }));
          writeTaskIds.pop();
          writeTaskIds.push(taskId);
          continue;
        }

        tasks.push(new Task({
          id: taskId,
          kind,
          goal: `Write file: ${file} — ${objective}`,
          tool: 'WRITE_FILE',
          toolArgs: { path: file, content, file },
          dependencies: readTaskIds.length > 0 ? [...readTaskIds] : [],
          failureNext: 'recovery:' + taskId
        }));
        console.log('[PLANNER_WRITE_TARGET]', { file, taskId, goal: (tasks[tasks.length - 1].goal || '').substring(0, 80), hasContent: !!content });
      }

      for (const cmd of requiredCommands) {
        const cmdId = crypto.randomUUID();
        tasks.push(new Task({
          id: cmdId,
          kind,
          goal: `Run command: ${cmd}`,
          tool: 'RUN_TERMINAL',
          toolArgs: { command: cmd },
          dependencies: writeTaskIds.length > 0 ? [...writeTaskIds] : (readTaskIds.length > 0 ? [...readTaskIds] : []),
          failureNext: 'recovery:' + cmdId
        }));
      }

      console.log('[PLANNER_DECOMPOSE_MIXED_TASK]', {
        readFiles: readFiles.length,
        writeFiles: writeFiles.length,
        commands: requiredCommands.length,
        totalTasks: tasks.length
      });
    } else {
      const genericId = crypto.randomUUID();
      tasks.push(new Task({
        id: genericId,
        kind,
        goal: objective,
        dependencies: []
      }));
      for (const cmd of requiredCommands) {
        const cmdId = crypto.randomUUID();
        tasks.push(new Task({
          id: cmdId,
          kind,
          goal: `Run command: ${cmd}`,
          tool: 'RUN_TERMINAL',
          toolArgs: { command: cmd },
          dependencies: [genericId],
          failureNext: 'recovery:' + cmdId
        }));
      }
    }
  }

  if (tasks.length === 0) {
    tasks.push(new Task({
      id: crypto.randomUUID(),
      kind,
      goal: objective,
      dependencies: []
    }));
  }

  console.log('[PLANNER_CREATE]', { taskCount: tasks.length, tasks: tasks.map(t => ({ id: t.id, kind: t.kind, tool: t.tool, goal: t.goal.substring(0, 80) })) });
  return { tasks };
}
