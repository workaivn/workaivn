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

export function classifyReadWriteFiles(objective, files) {
  const readFiles = [];
  const writeFiles = [];
  const text = String(objective || '');

  for (const file of files) {
    const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const readPattern = new RegExp(
      `\\b(?:read|open|inspect|check|review|show|display|print|dump)\\b[\\s\\S]{0,120}?${escaped}`, 'i'
    );
    const writePattern = new RegExp(
      `\\b(?:create|write|add|implement|generate|build|construct|modify|update|change|edit|patch|replace|refactor|fix|delete|remove)\\b[\\s\\S]{0,120}?${escaped}`, 'i'
    );

    const isRead = readPattern.test(text);
    const isWrite = writePattern.test(text);

    if (isWrite && !isRead) {
      writeFiles.push(file);
    } else if (isRead && !isWrite) {
      readFiles.push(file);
    } else {
      writeFiles.push(file);
    }
  }

  return { readFiles, writeFiles };
}

function hasWriteIntent(objective) {
  return /\b(?:create|write|add|implement|generate|build|construct|modify|update|change|edit|patch|replace|refactor|fix|delete|remove)\b/i.test(String(objective || ''));
}

export function buildPlan(objective, criteria) {
  if (!objective) return { tasks: [] };
  const tasks = [];
  const kind = criteria?.taskType || 'CODING';
  const reqFiles = criteria?.requestedFiles || [];
  const requiredCommands = criteria?.requiredCommands || [];
  const isReadKind = kind === 'ANALYSIS' || kind === 'SEARCH';

  if (isReadKind && reqFiles.length > 0) {
    const readTaskIds = [];
    for (const file of reqFiles) {
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
        const taskId = crypto.randomUUID();
        writeTaskIds.push(taskId);
        tasks.push(new Task({
          id: taskId,
          kind,
          goal: `Write file: ${file} — ${objective}`,
          tool: null,
          toolArgs: {},
          dependencies: readTaskIds.length > 0 ? [...readTaskIds] : [],
          failureNext: 'recovery:' + taskId
        }));
        console.log('[PLANNER_WRITE_TARGET]', { file, taskId, goal: (tasks[tasks.length - 1].goal || '').substring(0, 80) });
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
