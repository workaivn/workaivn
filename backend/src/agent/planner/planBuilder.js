import crypto from 'node:crypto';
import { Task } from './task.js';
import { parsePromptFileLiterals } from './promptLiteralParser.js';
import { createBootstrapTaskGraph } from '../projectIntelligence/index.js';

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

function uniqueCommands(commands = []) {
  return prioritizeValidationCommands([...new Set((Array.isArray(commands) ? commands : []).map(cmd => String(cmd || '').trim()).filter(Boolean))]);
}

function inferValidationPlan(objective, criteria = {}, bootstrapProfile = null) {
  const text = String(objective || '');
  const wantsTests = /\b(?:test|tests|testing|validation)\b/i.test(text);
  const packageJson = criteria?.workspaceState?.packageJson || null;
  const projectScan = criteria?.projectScan || {};
  const packageScripts = packageJson?.scripts || {};
  const doNotModifyPackageJson = /do\s+not\s+modify\s+package\.json/i.test(text);

  const explicitCommands = uniqueCommands([
    ...(Array.isArray(criteria?.requiredCommands) ? criteria.requiredCommands : []),
    ...(Array.isArray(projectScan?.testCommands) ? projectScan.testCommands : []),
    ...(Array.isArray(projectScan?.buildCommands) ? projectScan.buildCommands : [])
  ]);
  if (explicitCommands.length > 0) {
    console.log('[VALIDATION_COMMAND_DERIVED]', { source: 'explicit_or_scan', command: explicitCommands[0], commands: explicitCommands });
    return { commands: explicitCommands, validationBlockedReason: null, packageJsonTestSetupRequired: false, packageJsonTestSetupSkipped: false };
  }

  if (wantsTests) {
    if (packageScripts.test) {
      console.log('[PACKAGE_JSON_TEST_SETUP_SKIPPED]', { reason: 'test_script_already_present', script: packageScripts.test });
      console.log('[VALIDATION_COMMAND_DERIVED]', { source: 'package_json_script', command: 'npm test' });
      return { commands: ['npm test'], validationBlockedReason: null, packageJsonTestSetupRequired: false, packageJsonTestSetupSkipped: true };
    }
    if (packageScripts.build) {
      console.log('[PACKAGE_JSON_TEST_SETUP_REQUIRED]', { reason: 'explicit_tests_requested_without_test_script', canModifyPackageJson: !doNotModifyPackageJson });
      console.log('[VALIDATION_COMMAND_DERIVED]', { source: 'package_json_build', command: 'npm run build' });
      return { commands: ['npm run build'], validationBlockedReason: null, packageJsonTestSetupRequired: !doNotModifyPackageJson, packageJsonTestSetupSkipped: doNotModifyPackageJson };
    }
    if (Array.isArray(projectScan?.buildCommands) && projectScan.buildCommands.length > 0) {
      console.log('[PACKAGE_JSON_TEST_SETUP_REQUIRED]', { reason: 'explicit_tests_requested_without_runnable_test_framework', canModifyPackageJson: !doNotModifyPackageJson });
      console.log('[VALIDATION_COMMAND_DERIVED]', { source: 'project_scan_build_commands', command: projectScan.buildCommands[0] });
      return { commands: [String(projectScan.buildCommands[0]).trim()].filter(Boolean), validationBlockedReason: null, packageJsonTestSetupRequired: !doNotModifyPackageJson, packageJsonTestSetupSkipped: doNotModifyPackageJson };
    }
    if (bootstrapProfile?.validationCommands && bootstrapProfile.validationCommands.length > 0) {
      console.log('[PACKAGE_JSON_TEST_SETUP_SKIPPED]', { reason: 'bootstrap_profile_validation_only', profile: bootstrapProfile.id || null });
      console.log('[VALIDATION_COMMAND_DERIVED]', { source: 'bootstrap_profile', command: bootstrapProfile.validationCommands[0] });
      return { commands: [bootstrapProfile.validationCommands[0]], validationBlockedReason: null, packageJsonTestSetupRequired: false, packageJsonTestSetupSkipped: true };
    }

    console.log('[PACKAGE_JSON_TEST_SETUP_REQUIRED]', { reason: 'explicit_tests_requested_but_no_runnable_framework', canModifyPackageJson: !doNotModifyPackageJson });
    console.log('[PACKAGE_JSON_TEST_SETUP_SKIPPED]', { reason: doNotModifyPackageJson ? 'package_json_modification_forbidden' : 'no_package_json_script_available' });
    console.log('[VALIDATION_COMMAND_BLOCKED]', { reason: 'no_runnable_test_framework', objective: text.slice(0, 200) });
    return { commands: [], validationBlockedReason: 'NO_RUNNABLE_TEST_FRAMEWORK', packageJsonTestSetupRequired: !doNotModifyPackageJson, packageJsonTestSetupSkipped: true };
  }

  const buildCommands = uniqueCommands(projectScan?.buildCommands || bootstrapProfile?.buildCommands || []);
  if (buildCommands.length > 0) {
    console.log('[VALIDATION_COMMAND_DERIVED]', { source: 'build_commands', command: buildCommands[0], commands: buildCommands });
    return { commands: buildCommands, validationBlockedReason: null, packageJsonTestSetupRequired: false, packageJsonTestSetupSkipped: false };
  }

  console.log('[VALIDATION_COMMAND_BLOCKED]', { reason: 'no_validation_command_available', objective: text.slice(0, 200) });
  return { commands: [], validationBlockedReason: null, packageJsonTestSetupRequired: false, packageJsonTestSetupSkipped: false };
}

function isNumberedInstructionLine(trimmed) {
  return /^\d+[.)]\s+/.test(trimmed) || /^[ivxlcdm]+\.\s+/i.test(trimmed);
}

function isShellFenceLine(trimmed) {
  return /^```(?:bash|sh|shell|zsh|powershell|pwsh|cmd)?\s*$/i.test(trimmed);
}

function isValidShellCommand(candidate) {
  const cleaned = String(candidate || '').replace(/[.;,]\s*$/, '').trim();
  if (!cleaned) return false;
  if (/^\d+[.)]\s+[A-Z]/.test(cleaned)) return false;
  if (/^\d+[.)]\s+/.test(cleaned)) return false;
  if (/\b(?:do not|preserve deterministic|return|prompt|planner|validation|quality gate)\b/i.test(cleaned)) return false;
  if (/^(?:[-*]\s*)/.test(cleaned)) return false;
  if (/^(?:expected observations|planner creates|run_file_metadata|plannerDebugSnapshot)/i.test(cleaned)) return false;
  if (/^[#*>-]/.test(cleaned)) return false;
  const token = cleaned.split(/\s+/)[0].toLowerCase();
  return [
    'npm', 'yarn', 'pnpm', 'npx', 'node', 'bun', 'deno',
    'git', 'python', 'python3', 'pytest', 'vitest', 'jest',
    'mocha', 'tsc', 'eslint', 'go', 'cargo', 'dotnet', 'mvn',
    'gradle', 'flutter', 'dart'
  ].includes(token);
}

export { isValidShellCommand };

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
    if (!direct.test(cleaned) || !isValidShellCommand(cleaned)) return false;
    add(cleaned);
    return true;
  }

  let expectCommand = false;
  let inShellFence = false;
  let suppressDirectCommands = false;
  for (const line of lines) {
    const trimmed = String(line || '').trim();
    if (!trimmed) {
      if (!expectCommand) suppressDirectCommands = false;
      continue;
    }

    if (isShellFenceLine(trimmed)) {
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
        addIfCommand(trimmed);
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

  return prioritizeValidationCommands(commands.filter(isValidShellCommand));
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
    const normalizedFile = String(file || '').replace(/\\/g, '/').toLowerCase();
    if (/(^|\/)package\.json$/.test(normalizedFile) && /do\s+not\s+modify\s+package\.json(?:\s+unless\s+absolutely\s+necessary)?/i.test(text)) {
      if (!readFiles.includes(file)) readFiles.push(file);
      console.log('[PLANNER_PROTECTED_PACKAGE_JSON_READ_ONLY]', { file });
      continue;
    }
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

function getDeterministicValidationCommands(criteria = {}) {
  const candidates = [
    ...(Array.isArray(criteria?.requiredCommands) ? criteria.requiredCommands : []),
    ...(Array.isArray(criteria?.testCommands) ? criteria.testCommands : []),
    ...(Array.isArray(criteria?.projectScan?.testCommands) ? criteria.projectScan.testCommands : [])
  ];
  const normalized = candidates
    .map(cmd => String(cmd || '').trim())
    .filter(Boolean)
    .filter(isValidShellCommand);
  if (normalized.length > 0) {
    return prioritizeValidationCommands([...new Set(normalized)]);
  }
  return [];
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
  const bootstrapProfile = criteria?.bootstrapProfile || null;
  const requestedFiles = Array.isArray(criteria?.requestedFiles) ? criteria.requestedFiles.filter(Boolean) : [];
  const validationPlan = inferValidationPlan(objective, criteria, bootstrapProfile);
  const explicitCommands = extractCommands(objective);
  const fallbackCommands = getDeterministicValidationCommands(criteria);
  if (bootstrapProfile?.id && bootstrapProfile.resolvedBy !== 'fallback' && criteria?.bootstrapEnabled !== false && requestedFiles.length === 0) {
    if (bootstrapProfile.canBootstrap === false) {
      console.log('[BOOTSTRAP_PROFILE_UNSUPPORTED]', {
        profile: bootstrapProfile.id,
        label: bootstrapProfile.label || bootstrapProfile.id
      });
      return {
        tasks: [new Task({
          id: crypto.randomUUID(),
          kind: criteria?.taskType || 'CODING',
          goal: `Unsupported framework plan: ${bootstrapProfile.id}`,
          dependencies: []
        })],
        bootstrapProfileId: bootstrapProfile.id,
        unsupported: true,
        validationCommands: validationPlan.commands,
        validationBlockedReason: validationPlan.validationBlockedReason,
        packageJsonTestSetupRequired: validationPlan.packageJsonTestSetupRequired,
        packageJsonTestSetupSkipped: validationPlan.packageJsonTestSetupSkipped
      };
    }
    const bootstrapGraph = createBootstrapTaskGraph(bootstrapProfile, {
      objective,
      projectIntent: criteria?.projectIntent || {},
      workspaceState: criteria?.workspaceState || {},
      criteria
    });
    if (bootstrapGraph?.tasks?.length > 0) {
      console.log('[BOOTSTRAP_TASK_GRAPH_CREATED]', {
        profile: bootstrapGraph.profileId,
        taskCount: bootstrapGraph.tasks.length,
        validationSkipped: bootstrapGraph.validationSkipped || []
      });
      return {
        tasks: bootstrapGraph.tasks,
        validationCommands: validationPlan.commands,
        validationBlockedReason: validationPlan.validationBlockedReason,
        packageJsonTestSetupRequired: validationPlan.packageJsonTestSetupRequired,
        packageJsonTestSetupSkipped: validationPlan.packageJsonTestSetupSkipped
      };
    }
  }
  const tasks = [];
  const kind = criteria?.taskType || 'CODING';
  const reqFiles = criteria?.requestedFiles || [];
  const requiredCommands = prioritizeValidationCommands(expandRepeatedCommands(
    objective,
    explicitCommands.length > 0 ? explicitCommands : (validationPlan.commands.length > 0 ? validationPlan.commands : fallbackCommands)
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

  if (validationPlan.validationBlockedReason) {
    console.log('[PLANNER_VALIDATION_TASK_BLOCKED]', {
      reason: validationPlan.validationBlockedReason,
      taskType: kind,
      objective: String(objective || '').slice(0, 200)
    });
  } else if (requiredCommands.length > 0) {
    console.log('[PLANNER_VALIDATION_TASK_ADDED]', { commands: requiredCommands });
  }

  console.log('[PLANNER_CREATE]', { taskCount: tasks.length, tasks: tasks.map(t => ({ id: t.id, kind: t.kind, tool: t.tool, goal: t.goal.substring(0, 80) })) });
  return {
    tasks,
    validationCommands: requiredCommands,
    validationBlockedReason: validationPlan.validationBlockedReason,
    packageJsonTestSetupRequired: validationPlan.packageJsonTestSetupRequired,
    packageJsonTestSetupSkipped: validationPlan.packageJsonTestSetupSkipped
  };
}
