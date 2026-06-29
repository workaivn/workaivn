import crypto from 'node:crypto';
import { Task } from './task.js';

const MAX_CONTEXT_FILES = 10;

// Project-type-specific candidate file rules
function getCandidateFilesForProject(projectType, entryFiles) {
  const entrySet = new Set((entryFiles || []).map(f => f.replace(/\\/g, '/')));
  const candidates = new Set();

  switch (projectType) {
    case 'next': {
      for (const f of ['package.json', 'app/layout.tsx', 'app/layout.js', 'app/page.tsx', 'app/page.js', 'pages/index.tsx', 'pages/index.js']) {
        candidates.add(f);
      }
      break;
    }
    case 'vite': {
      for (const f of ['package.json', 'src/main.jsx', 'src/main.js', 'src/main.tsx', 'src/main.ts', 'src/App.jsx', 'src/App.js', 'src/App.tsx', 'src/index.js']) {
        candidates.add(f);
      }
      break;
    }
    case 'node_react':
    case 'react': {
      for (const f of ['package.json', 'src/App.js', 'src/App.jsx', 'src/App.tsx', 'src/index.js', 'src/index.jsx', 'src/index.tsx', 'src/main.js', 'src/main.jsx']) {
        candidates.add(f);
      }
      break;
    }
    case 'flutter': {
      for (const f of ['pubspec.yaml', 'lib/main.dart']) {
        candidates.add(f);
      }
      break;
    }
    case 'python': {
      for (const f of ['requirements.txt', 'pyproject.toml', 'main.py', 'app.py']) {
        candidates.add(f);
      }
      break;
    }
    case 'php': {
      for (const f of ['composer.json', 'index.php']) {
        candidates.add(f);
      }
      break;
    }
    case 'aspnet': {
      candidates.add('Program.cs');
      candidates.add('Startup.cs');
      break;
    }
    case 'static_html': {
      candidates.add('index.html');
      break;
    }
    case 'node':
    case 'express':
    case 'generic':
    default: {
      for (const f of ['package.json', 'index.js', 'server.js', 'app.js', 'src/index.js', 'src/server.js', 'src/app.js']) {
        candidates.add(f);
      }
      break;
    }
  }

  // Add any entry files from project scan that aren't already in candidates
  for (const f of entrySet) {
    candidates.add(f);
  }

  return [...candidates];
}

function getProjectContext(projectType, packageManager) {
  const pm = packageManager || 'npm';
  const parts = [projectType.charAt(0).toUpperCase() + projectType.slice(1)];
  if (pm) parts.push(`(${pm})`);
  return parts.join(' ');
}

function getFileReason(file, projectType) {
  const entryHints = {
    'package.json': 'project metadata and dependencies',
    'pubspec.yaml': 'Flutter project metadata',
    'composer.json': 'PHP project metadata',
    'requirements.txt': 'Python dependencies',
    'pyproject.toml': 'Python project configuration',
    'index.js': 'Node entry point',
    'server.js': 'Express/server entry point',
    'app.js': 'Application entry point',
    'src/index.js': 'Source entry point',
    'src/server.js': 'Source server entry point',
    'src/app.js': 'Source application entry point',
    'src/App.js': 'React root component',
    'src/App.jsx': 'React root component',
    'src/App.tsx': 'React root component (TypeScript)',
    'src/main.jsx': 'Vite entry point',
    'src/main.js': 'Entry point',
    'src/main.tsx': 'TypeScript entry point',
    'src/main.ts': 'TypeScript entry point',
    'src/index.jsx': 'CRA entry point',
    'src/index.tsx': 'TypeScript entry point',
    'app/layout.tsx': 'Next.js layout (TypeScript)',
    'app/layout.js': 'Next.js layout',
    'app/page.tsx': 'Next.js page (TypeScript)',
    'app/page.js': 'Next.js page',
    'pages/index.tsx': 'Next.js pages router (TypeScript)',
    'pages/index.js': 'Next.js pages router',
    'lib/main.dart': 'Flutter entry point',
    'main.py': 'Python entry point',
    'app.py': 'Python/Flask entry point',
    'index.php': 'PHP entry point',
    'Program.cs': '.NET entry point',
    'Startup.cs': '.NET startup configuration',
    'index.html': 'HTML entry point'
  };
  return entryHints[file] || 'project file';
}

function isRedundantFile(file) {
  const ignored = /(?:^|\/)(?:node_modules|dist|build|coverage|\.git|__pycache__|\.next|out|target|\.gradle)(?:\/|$)/;
  const isGeneric = /(?:^|\/)(?:README\.md|LICENSE|\.gitignore|\.env|\.editorconfig|\.prettierrc)(?:$|\.)/;
  return ignored.test(file) || isGeneric.test(file);
}

function isFileAlreadyKnown(file, plannerTasks, historySet) {
  if (historySet.has(file)) return true;
  for (const task of plannerTasks) {
    if (task.tool === 'READ_FILE') {
      const taskFile = task.toolArgs?.path || task.toolArgs?.file || '';
      if (taskFile.replace(/\\/g, '/') === file) return true;
    }
    if (task.tool === 'WRITE_FILE' || task.tool === 'APPLY_PATCH') {
      const taskFile = task.toolArgs?.path || task.toolArgs?.file || '';
      if (taskFile.replace(/\\/g, '/') === file) return true;
    }
  }
  return false;
}

export function buildPlannerContext({
  workspaceRoot,
  projectScan = {},
  plannerTasks = [],
  classifierResult = {},
  executionHistory = null
} = {}) {
  const projectType = projectScan.projectType || 'generic';
  const packageManager = projectScan.packageManager || null;
  const entryFiles = projectScan.entryFiles || [];
  const projectContext = getProjectContext(projectType, packageManager);

  // Build set of already-read files from execution history
  const historySet = new Set();
  if (executionHistory) {
    const records = executionHistory.getAllRecords ? executionHistory.getAllRecords() : [];
    for (const rec of records) {
      if (rec.tool === 'READ_FILE' && rec.args?.path) {
        historySet.add(String(rec.args.path).replace(/\\/g, '/'));
      }
    }
  }

  // Gather all candidate files for this project type
  const allCandidates = getCandidateFilesForProject(projectType, entryFiles);

  // Filter: remove redundant files (README, node_modules, etc.)
  const filtered = allCandidates.filter(f => !isRedundantFile(f));

  // Filter: remove files already known to planner or history
  const unknown = filtered.filter(f => !isFileAlreadyKnown(f, plannerTasks, historySet));

  // Limit to MAX_CONTEXT_FILES
  const requiredReads = unknown.slice(0, MAX_CONTEXT_FILES);

  // Build reason map
  const reasons = {};
  for (const file of requiredReads) {
    reasons[file] = getFileReason(file, projectType);
  }

  // Phase 4.15 HOTFIX: Classify files as backend/frontend for landing page safety
  const backendPatterns = [
    /\/routes\//, /\/middleware\//, /\/models\//, /\/controllers\//,
    /\/config\//, /\/helpers\//, /\/utils\//,
    /server\.(js|ts|mjs)$/, /app\.(js|ts|mjs)$/,
    /database/, /schema/, /migration/, /seeds/
  ];
  const frontendPathPrefixes = ['frontend/', 'client/', 'web/'];
  const backendAppFiles = filtered.filter(f => backendPatterns.some(p => p.test(f)));
  const frontendEntryFiles = filtered.filter(f => {
    const norm = f.replace(/\\/g, '/');
    if (frontendPathPrefixes.some(p => norm.startsWith(p))) return true;
    if (/^app\/page\.(tsx|js)$/.test(norm) || /^pages\/index\.(tsx|js)$/.test(norm)) return true;
    if (/src\/App\.(jsx?|tsx?)$/.test(norm)) return true;
    return false;
  });
  const candidateLandingTargets = frontendEntryFiles.length > 0 ? frontendEntryFiles : [];

  const result = {
    workspaceRoot,
    projectContext,
    candidateFiles: filtered,
    requiredReads,
    reasons,
    backendAppFiles,
    frontendEntryFiles,
    candidateLandingTargets,
    appRoots: projectScan.appRoots || [],
    sourceRoots: projectScan.sourceRoots || [],
    moduleRoots: projectScan.moduleRoots || [],
    testRoots: projectScan.testRoots || [],
    existingTopLevelDirs: projectScan.existingTopLevelDirs || []
  };

  console.log('[PLANNER_CONTEXT_BUILD]', {
    projectType,
    projectContext,
    candidateFiles: filtered.length,
    requiredReads: requiredReads.length,
    backendAppFiles: backendAppFiles.length,
    frontendEntryFiles: frontendEntryFiles.length,
    candidateLandingTargets: candidateLandingTargets.length,
    reason: `Selected ${requiredReads.length} files for ${projectType} project`
  });

  if (requiredReads.length > 0) {
    console.log('[PLANNER_CONTEXT_SELECTED]', {
      files: requiredReads,
      reasons
    });
  }

  if (backendAppFiles.length > 0) {
    console.log('[PLANNER_CONTEXT_BACKEND_FILES]', {
      files: backendAppFiles
    });
  }

  if (frontendEntryFiles.length > 0) {
    console.log('[PLANNER_CONTEXT_FRONTEND_FILES]', {
      files: frontendEntryFiles
    });
  }

  return result;
}
