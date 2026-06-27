import crypto from 'node:crypto';
import { Task } from './task.js';

export function extractCommands(text) {
  const commands = [];
  const seen = new Set();
  const source = String(text || '').replace(/\r\n/g, '\n');
  const commandStart = String.raw`(?:npm(?:\s+run)?\s+[A-Za-z0-9:_-]+|npm\s+test\b|pnpm(?:\s+run)?\s+[A-Za-z0-9:_-]+|pnpm\s+test\b|yarn(?:\s+run)?\s+[A-Za-z0-9:_-]+|yarn\s+test\b|node\s+[^\n.]+\.(?:m?js|cjs)|python3?\s+[^\n.]+\.py|pytest\b[^\n]*|go\s+test\b[^\n]*|cargo\s+(?:test|check)\b[^\n]*|dotnet\s+(?:test|build)\b[^\n]*|mvn\s+test\b[^\n]*|gradle\w*\s+(?:test|build)\b[^\n]*|flutter\s+(?:test|analy[sz]e)\b[^\n]*|dart\s+test\b[^\n]*)`;
  const marker = String.raw`(?:then\s+run|run|execute|finally\s+run)`;
  const patterns = [
    new RegExp(String.raw`\b${marker}\s*:\s*(${commandStart})`, 'gi'),
    new RegExp(String.raw`\b${marker}\s*\n+\s*(${commandStart})`, 'gi'),
    new RegExp(String.raw`\b${marker}\s+(${commandStart})`, 'gi')
  ];

  function add(cmd) {
    const cleaned = String(cmd || '')
      .split('\n')[0]
      .replace(/\s+(?:do not|planner must|expected|acceptance|requirements?)\b[\s\S]*$/i, '')
      .replace(/[.;,]\s*$/, '')
      .trim();
    if (!cleaned) return;
    if (/^(npm|npm\s+run|npm\s+script|pnpm|yarn|node|python|python3)$/i.test(cleaned)) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    commands.push(cleaned);
  }

  for (const rx of patterns) {
    let match;
    while ((match = rx.exec(source)) !== null) {
      add(match[1]);
    }
  }

  return commands;
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

const READ_WORDS = ['read','open','inspect','check','review','show','display','print','dump','view','examine','find','look','tell','list'];
const WRITE_WORDS = ['create','write','add','implement','generate','build','construct','modify','update','change','edit','patch','replace','refactor','fix','delete','remove'];

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
  return /\b(?:create|write|add|implement|generate|build|construct|modify|update|change|edit|patch|replace|refactor|fix|delete|remove)\b/i.test(String(objective || ''));
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

function extractWriteContent(objective, file) {
  if (!objective || !file) return null;
  const text = String(objective || '');
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Any subsequent instruction word terminates content extraction
  const INSTRUCTION_WORDS = 'Run|Then|Next|And|Finally|Read|Open|Inspect|Check|Review|Create|Write|Add|Modify|Update|Delete|Remove|Implement|Generate|Build|Construct|Edit|Patch|Replace|Refactor|Fix|Show|Display|Print|Dump|List|Find|Look|Tell|View|Examine|Search|Execute|Compile|Test';

  // Pattern 1: "Create|write|add <file> with:\n<content>" or "with content:\n<content>"
  const p1 = new RegExp(
    `(?:create|write|add|implement|generate)\\b[\\s\\S]{0,80}?${escaped}\\s+with\\s*(?:content\\s*)?:\\s*([\\s\\S]*?)(?=\\n\\s*(?:${INSTRUCTION_WORDS})\\b|$)`, 'i'
  );
  const m1 = p1.exec(text);
  if (m1) {
    let content = m1[1];
    content = content.replace(new RegExp(`\n\\s*(?:Then|and)\\s+(?:run|execute)\\s*:.*$`, 'i'), '')
      .replace(new RegExp(`[.;]?\\s+(?:${INSTRUCTION_WORDS})\\b.*$`, 'i'), '')
      .replace(/\n+\s*$/, '');
    if (content.trim()) return content.replace(/\n+$/, '');
  }

  // Pattern 2: "Create|write|add <file> with <content>" followed by transition or end-of-line
  const p2 = new RegExp(
    `(?:create|write|add|implement|generate)\\b[\\s\\S]{0,80}?${escaped}\\s+with\\s+([^\\n]+?)(?=[.;]?\\s+(?:${INSTRUCTION_WORDS})\\b|[.;]\\s*$|$)`, 'i'
  );
  const m2 = p2.exec(text);
  if (m2) {
    let content = m2[1].trim();
    if (/^content\s*:?\s*/i.test(content)) content = content.replace(/^content\s*:?\s*/i, '');
    if (content) return content;
  }

  // Pattern 3: "<file> with content <content>"
  const p3 = new RegExp(
    `${escaped}\\s+with\\s+content\\s+([^\\n]+?)(?=[.;]?\\s+(?:${INSTRUCTION_WORDS})\\b|[.;]\\s*$|$)`, 'i'
  );
  const m3 = p3.exec(text);
  if (m3) {
    let content = m3[1].trim();
    if (content) return content;
  }

  return null;
}

export function buildPlan(objective, criteria) {
  if (!objective) return { tasks: [] };
  const tasks = [];
  const kind = criteria?.taskType || 'CODING';
  const reqFiles = criteria?.requestedFiles || [];
  const requiredCommands = expandRepeatedCommands(objective, criteria?.requiredCommands || []);
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

      for (const file of writeFiles) {
        // Validate: reject WRITE_FILE without explicit write intent
        const fileWritePattern = new RegExp(
          `\\b(?:create|write|add|implement|generate|build|construct|modify|update|change|edit|patch|replace|refactor|fix|delete|remove)\\b[\\s\\S]{0,120}?${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'
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

        // Reject tool=null tasks: if no content extracted, mark as generic for LLM reasoning
        if (!hasContent) {
          console.log('[PLANNER_INVALID_TASK_REJECTED]', { file, reason: 'no_write_content', action: 'creating generic REASONING task' });
          tasks.push(new Task({
            id: taskId,
            kind,
            goal: `Write file: ${file}`,
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
