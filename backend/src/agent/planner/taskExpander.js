import crypto from 'node:crypto';
import fs from 'node:fs';
import { Task } from './task.js';
import { TaskKind } from './plannerTypes.js';
import { extractCommands, expandRepeatedCommands } from './planBuilder.js';

function normalizePath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/\/\.\//g, '/').replace(/^\.\//, '');
}

const BACKEND_MARKERS = [
  'import express', 'from "express"', "from 'express'",
  'app.use(', 'app.get(', 'app.post(', 'app.put(', 'app.delete(',
  'express()',
  'server.listen', 'connectDB', 'connectDB(',
  'mongoose.connect', 'sequelize',
  'middleware',
  'export default app'
];

const FRONTEND_PATH_PREFIXES = ['frontend/', 'client/', 'web/'];

const FRONTEND_CONTENT_MARKERS = [
  'import React', "from 'react'", 'from "react"',
  "from 'react-dom/client'", 'from "react-dom/client"',
  'createRoot',
  'export default function App', 'export default class App',
  'export default function', 'export default class',
  'export const App', 'export function App'
];

function hasBackendContent(filePath, fileContents) {
  if (!filePath) return false;
  const norm = normalizePath(filePath);
  const content = fileContents?.get?.(norm) || fileContents?.get?.(filePath) || null;
  if (content) {
    const text = String(content);
    return BACKEND_MARKERS.some(m => text.includes(m));
  }
  try {
    if (fs.existsSync(filePath)) {
      const text = String(fs.readFileSync(filePath, 'utf-8') || '');
      return BACKEND_MARKERS.some(m => text.includes(m));
    }
  } catch {}
  return false;
}

function hasFrontendContent(filePath, fileContents) {
  if (!filePath) return false;
  const norm = normalizePath(filePath);
  const content = fileContents?.get?.(norm) || fileContents?.get?.(filePath) || null;
  if (content) {
    const text = String(content);
    if (FRONTEND_CONTENT_MARKERS.some(m => text.includes(m))) return true;
    if (/<[A-Z][\w]*(\s|>)/.test(text)) return true;
    return false;
  }
  try {
    if (fs.existsSync(filePath)) {
      const text = String(fs.readFileSync(filePath, 'utf-8') || '');
      if (FRONTEND_CONTENT_MARKERS.some(m => text.includes(m))) return true;
      if (/<[A-Z][\w]*(\s|>)/.test(text)) return true;
    }
  } catch {}
  return false;
}

function isFrontendPath(filePath) {
  if (!filePath) return false;
  const norm = normalizePath(filePath);
  if (FRONTEND_PATH_PREFIXES.some(p => norm.startsWith(p))) return true;
  if (/^app\/page\.(tsx|js)$/.test(norm) || /^pages\/index\.(tsx|js)$/.test(norm)) return true;
  return false;
}

function isValidReactLandingTarget(filePath, fileContents) {
  if (!filePath) return false;
  if (isFrontendPath(filePath)) return true;
  if (hasFrontendContent(filePath, fileContents)) return true;
  return false;
}

const ENTRY_PRIORITY = [
  'src/App.js', 'src/App.jsx', 'src/App.tsx',
  'src/index.js', 'src/index.jsx', 'src/index.tsx',
  'src/main.js', 'src/main.jsx',
  'app/layout.tsx', 'app/layout.js', 'app/page.tsx', 'app/page.js',
  'pages/index.tsx', 'pages/index.js',
  'lib/main.dart',
  'main.py', 'app.py',
  'index.php',
  'Program.cs', 'Startup.cs',
  'index.js', 'server.js', 'app.js', 'src/server.js', 'src/app.js'
];

function entryPriority(file) {
  const idx = ENTRY_PRIORITY.indexOf(normalizePath(file));
  return idx === -1 ? 999 : idx;
}

function inferTargetFiles(projectType, entryFiles, goal) {
  const lower = String(goal || '').toLowerCase();
  const hasFixIntent = /\b(fix|update|change|modify|patch|refactor|correct|repair)\b/i.test(lower);
  const candidates = [];
  const entrySet = new Set((entryFiles || []).map(f => normalizePath(f)));

  const typeFiles = [];
  switch (projectType) {
    case 'next':
      typeFiles.push('app/layout.tsx', 'app/layout.js', 'app/page.tsx', 'app/page.js', 'pages/index.tsx', 'pages/index.js');
      break;
    case 'vite':
      typeFiles.push('src/main.jsx', 'src/main.tsx', 'src/App.jsx', 'src/App.tsx');
      break;
    case 'node_react':
    case 'react':
      typeFiles.push('src/App.js', 'src/App.jsx', 'src/App.tsx', 'src/index.js', 'src/index.jsx', 'src/index.tsx', 'src/main.js', 'src/main.jsx');
      break;
    case 'flutter':
      typeFiles.push('lib/main.dart');
      break;
    case 'python':
      typeFiles.push('main.py', 'app.py');
      break;
    case 'php':
      typeFiles.push('index.php');
      break;
    case 'aspnet':
      typeFiles.push('Program.cs', 'Startup.cs');
      break;
    case 'node':
    case 'express':
    case 'generic':
    default:
      typeFiles.push('index.js', 'server.js', 'app.js', 'src/index.js', 'src/server.js', 'src/app.js');
      break;
  }

  for (const f of typeFiles) {
    if (entrySet.has(f) && !candidates.includes(f)) candidates.push(f);
  }
  for (const f of typeFiles) {
    if (!candidates.includes(f)) candidates.push(f);
  }

  if (entryFiles.length > 0) {
    const mainEntry = normalizePath(entryFiles[0]);
    if (!candidates.includes(mainEntry)) {
      candidates.unshift(mainEntry);
    }
  }

  return {
    files: candidates.slice(0, 2),
    isFix: hasFixIntent
  };
}

function isBackendFileExcluded(filePath, fileContents) {
  if (!filePath) return true;
  const norm = normalizePath(filePath);
  const isBackendLike = /server|api|backend|routes|middleware|models|controllers/i.test(norm);
  const hasBackend = hasBackendContent(filePath, fileContents);
  if (isBackendLike || hasBackend) {
    console.log('[PLANNER_REASONING_EXCLUDE_BACKEND]', {
      file: norm,
      reason: isBackendLike && hasBackend ? 'path+content indicate backend' : hasBackend ? 'content indicates backend' : 'path indicates backend'
    });
    return true;
  }
  return false;
}

function pickSingleTarget(candidates, existingFiles, alreadyTargeted, fileContents) {
  const normalExisting = new Set(existingFiles.map(normalizePath));
  const normalTargeted = new Set(alreadyTargeted.map(normalizePath));

  // Build excluded set — files identified as backend must never be selected
  const excludedTargets = new Set();

  // Filter to files that actually exist on disk
  let existent = candidates.filter(f => normalExisting.has(normalizePath(f)));

  // Among existent files, filter out backend files (add to excluded set)
  for (const f of existent) {
    if (isBackendFileExcluded(f, fileContents)) {
      excludedTargets.add(normalizePath(f));
    }
  }
  existent = existent.filter(f => !excludedTargets.has(normalizePath(f)));

  // Among remaining existent files, pick the highest priority valid frontend target
  if (existent.length > 0) {
    existent.sort((a, b) => entryPriority(a) - entryPriority(b));
    // Find first that is a valid React landing target
    for (const f of existent) {
      const norm = normalizePath(f);
      if (normalTargeted.has(norm)) {
        console.log('[PLANNER_REASONING_SKIP_DUPLICATE]', {
          file: norm,
          reason: 'already has a WRITE_FILE or REASONING task for this file'
        });
        continue;
      }
      if (isValidReactLandingTarget(norm, fileContents)) {
        console.log('[PLANNER_REASONING_TARGET]', {
          selectedFile: norm,
          reason: 'existing valid React landing target'
        });
        return norm;
      }
      console.log('[PLANNER_REASONING_SKIP_NOT_REACT]', {
        file: norm,
        reason: 'file does not appear to be a React component'
      });
    }
  }

  // No existing valid frontend found — try to create a new file.
  // But never create a file that was excluded as backend.
  for (const f of candidates) {
    const norm = normalizePath(f);
    if (excludedTargets.has(norm)) {
      console.log('[PLANNER_REASONING_SKIP_EXCLUDED]', {
        file: norm,
        reason: 'file is in excludedTargets (backend) — refusing to use as landing page target'
      });
      continue;
    }
    if (!normalTargeted.has(norm)) {
      console.log('[PLANNER_REASONING_TARGET]', {
        selectedFile: norm,
        reason: 'new file creation — no existing entry component found'
      });
      return norm;
    }
  }

  return null;
}

function inferCommands(goal, scan) {
  const extracted = extractCommands(goal);
  const expanded = expandRepeatedCommands(goal, extracted);
  if (expanded.length > 0) return expanded;

  const buildCmd = scan.buildCommands?.[0];
  const testCmd = scan.testCommands?.[0];
  const runCmd = scan.runCommands?.[0];

  if (buildCmd) return [buildCmd];
  if (testCmd) return [testCmd];
  if (runCmd) return [runCmd];

  return [];
}

export function expandPlannerTasks(planner, { goal, projectType, entryFiles, scan, contextFiles = [], fileContents = null } = {}) {
  if (!planner) return [];
  if (!goal || goal.length < 5) {
    console.log('[PLANNER_EXPAND_SKIP]', { reason: 'goal too short', length: (goal || '').length });
    return [];
  }

  const allNodes = planner.graph.allNodes();
  const genericTasks = allNodes.filter(n =>
    !n.tool &&
    (n.status === 'PENDING' || n.status === 'READY') &&
    (n.goal === goal || n.goal?.substring(0, 40) === goal.substring(0, 40))
  );

  if (genericTasks.length === 0) {
    const allGeneric = allNodes.filter(n => !n.tool);
    console.log('[PLANNER_EXPAND_SKIP]', {
      reason: 'no generic task matching goal',
      totalNodes: allNodes.length,
      genericCount: allGeneric.length,
      genericStatuses: allGeneric.map(n => n.status),
      goalPreview: goal?.substring(0, 40),
      genericGoals: allGeneric.map(n => n.goal?.substring(0, 50))
    });
    return [];
  }

  console.log('[PLANNER_EXPAND_MATCH]', { matchingTasks: genericTasks.length, goalPreview: goal.substring(0, 40) });

  const expanded = [];
  let { files: targetFiles, isFix } = inferTargetFiles(projectType, entryFiles, goal);

  // Use classifier-requested files if available
  const knownWrites = allNodes.filter(n => n.tool === 'WRITE_FILE' || n.tool === 'APPLY_PATCH');
  if (knownWrites.length > 0) {
    targetFiles = knownWrites.map(n => n.toolArgs?.path || n.toolArgs?.file).filter(Boolean);
  }

  if (targetFiles.length === 0) return [];

  // Phase 4.15 hotfix: Only generate content for one target file.
  // Collect existing file paths from entryFiles and contextFiles
  const knownExistingFiles = [...(entryFiles || []), ...(contextFiles || [])].filter(Boolean);

  // Collect files already targeted by existing WRITE_FILE or REASONING tasks
  const alreadyTargeted = allNodes
    .filter(n => (n.tool === 'WRITE_FILE' || n.tool === 'APPLY_PATCH' || n.kind === TaskKind.REASONING || n.kind === TaskKind.GENERATE_CONTENT))
    .map(n => n.toolArgs?.path || n.toolArgs?.file || '')
    .filter(Boolean);

  const singleTarget = pickSingleTarget(targetFiles, knownExistingFiles, alreadyTargeted, fileContents);
  if (!singleTarget) {
    // Check if all candidates are backend files — fail safely
    const allBackend = targetFiles.every(f => isBackendFileExcluded(f, fileContents));
    if (allBackend) {
      console.log('[PLANNER_TARGET_SELECTION_FAILED]', {
        reason: 'No valid React frontend entry found. Refusing to overwrite backend app file.',
        candidates: targetFiles
      });
    } else {
      console.log('[PLANNER_EXPAND_SKIP]', {
        reason: 'no valid single target after dedup — all candidates already targeted or non-existent',
        candidates: targetFiles
      });
    }
    return [];
  }
  targetFiles = [singleTarget];

  const commands = inferCommands(goal, scan);

  for (const generic of genericTasks) {
    // Regression 2: Mark high-level task as REPLACED
    generic.status = 'SUCCESS';
    generic.touch();
    console.log('[PLANNER_TASK_REPLACED]', {
      taskId: generic.id,
      reason: 'expanded into concrete content-generation tasks',
      originalGoal: (generic.goal || '').substring(0, 60)
    });

    const generateTaskIds = [];

    // Regression 1: Never create WRITE_FILE without content.
    // Instead, create GENERATE_CONTENT placeholder tasks (tool: null) that
    // signal the model to produce content for the target file.
    for (const file of targetFiles) {
      const taskId = crypto.randomUUID();
      generateTaskIds.push(taskId);
      const taskGoal = isFix
        ? `Generate patch for file: ${file}`
        : `Generate content for file: ${file}`;
      const task = new Task({
        id: taskId,
        kind: TaskKind.REASONING,
        goal: taskGoal,
        tool: null,
        toolArgs: {},
        dependencies: [],
        priority: 50
      });
      planner.addTask(task);
      expanded.push(task);
      console.log('[PLANNER_TASK_INJECTED]', {
        taskId: task.id,
        tool: 'GENERATE_CONTENT',
        file,
        dependencyChain: 'independent'
      });
    }

    // Connect GENERATE_CONTENT tasks as dependencies of existing RUN_TERMINAL children
    for (const childId of [...generic.children]) {
      const child = planner.graph.getNode(childId);
      if (child && child.tool === 'RUN_TERMINAL') {
        if (child.status !== 'PENDING') {
          child.status = 'PENDING';
          child.touch();
        }
        for (const genId of generateTaskIds) {
          try {
            planner.graph.connect(genId, childId);
          } catch {
            // already connected or invalid
          }
        }
      }
    }

    // Create RUN_TERMINAL tasks — skip if a task for the same command already exists
    const existingCommands = new Set(
      planner.graph.allNodes()
        .filter(n => n.tool === 'RUN_TERMINAL')
        .map(n => String(n.toolArgs?.command || '').trim().toLowerCase())
    );
    for (const cmd of commands) {
      const cmdKey = String(cmd || '').trim().toLowerCase();
      if (existingCommands.has(cmdKey)) {
        console.log('[PLANNER_TASK_SKIP_DUPLICATE]', {
          tool: 'RUN_TERMINAL',
          command: cmd,
          reason: 'already exists in planner graph'
        });
        continue;
      }
      const taskId = crypto.randomUUID();
      const deps = generateTaskIds.length > 0 ? [...generateTaskIds] : [];
      const task = new Task({
        id: taskId,
        kind: 'CODING',
        goal: `Run command: ${cmd}`,
        tool: 'RUN_TERMINAL',
        toolArgs: { command: cmd },
        dependencies: deps,
        priority: 40
      });
      planner.addTask(task);
      expanded.push(task);
      existingCommands.add(cmdKey);
      console.log('[PLANNER_TASK_INJECTED]', {
        taskId: task.id,
        tool: 'RUN_TERMINAL',
        command: cmd,
        dependencyChain: deps.length > 0 ? `${deps.join(', ')} → ${taskId}` : 'independent'
      });
    }
  }

  planner._updateReadyStates();

  if (expanded.length > 0) {
    console.log('[PLANNER_TASK_EXPANSION]', {
      totalInjected: expanded.length,
      tools: [...new Set(expanded.map(t => t.tool || 'GENERATE_CONTENT'))],
      targetFiles,
      commands
    });
  }

  return expanded;
}
