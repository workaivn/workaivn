import { normalizeCanonicalPath } from '../../context/canonicalPath.js';
import { normalizeImplementationKey } from './implementationEvidence.js';

function normalizeText(value = '') {
  return String(value || '').trim();
}

function lower(value = '') {
  return normalizeText(value).toLowerCase();
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => normalizeCanonicalPath(value)).filter(Boolean))];
}

function collectWorkspaceFiles(projectScanSnapshot = {}, planningContext = {}) {
  return unique([
    ...(Array.isArray(projectScanSnapshot?.discoveredFiles) ? projectScanSnapshot.discoveredFiles : []),
    ...(Array.isArray(projectScanSnapshot?.files) ? projectScanSnapshot.files : []),
    ...(Array.isArray(projectScanSnapshot?.entryFiles) ? projectScanSnapshot.entryFiles : []),
    ...(Array.isArray(projectScanSnapshot?.styleFiles) ? projectScanSnapshot.styleFiles : []),
    ...(Array.isArray(planningContext?.verifiedFiles) ? planningContext.verifiedFiles : []),
    ...(Array.isArray(planningContext?.plannedFiles) ? planningContext.plannedFiles : []),
    ...(Array.isArray(planningContext?.facts?.discoveredFiles) ? planningContext.facts.discoveredFiles : []),
    ...(Array.isArray(planningContext?.facts?.verifiedFiles) ? planningContext.facts.verifiedFiles : []),
    ...(Array.isArray(planningContext?.facts?.plannedFiles) ? planningContext.facts.plannedFiles : [])
  ]);
}

function detectObjectiveVariantKey({
  objective = '',
  objectiveConstraints = [],
  planningStrategies = []
} = {}) {
  const text = [
    normalizeText(objective),
    ...(Array.isArray(objectiveConstraints) ? objectiveConstraints.map(constraint => normalizeText(constraint?.value || constraint?.type || constraint?.category || '')) : []),
    ...(Array.isArray(planningStrategies) ? planningStrategies.map(strategy => normalizeText(strategy?.strategy || strategy?.purpose || '')) : [])
  ].join(' ').toLowerCase();

  const hasReactCustomSignal =
    text.includes('react-custom') ||
    text.includes('react + custom') ||
    text.includes('react custom') ||
    (/frameworkkey\s*[:=]\s*['"]?react-custom/i.test(text)) ||
    (/variant\s*[:=]\s*['"]?react\s*\+\s*custom/i.test(text)) ||
    (/\breact\b/.test(text) && /\bcustom\b/.test(text));

  if (hasReactCustomSignal) {
    return 'react-custom';
  }

  return null;
}

export function detectObjectiveImplementationFamily({
  objective = '',
  objectiveConstraints = [],
  planningStrategies = []
} = {}) {
  const text = [
    normalizeText(objective),
    ...(Array.isArray(objectiveConstraints) ? objectiveConstraints.map(constraint => normalizeText(constraint?.value || constraint?.type || constraint?.category || '')) : []),
    ...(Array.isArray(planningStrategies) ? planningStrategies.map(strategy => normalizeText(strategy?.strategy || strategy?.purpose || '')) : [])
  ].join(' ').toLowerCase();

  if (/\bnext(?:\.js)?\b/.test(text)) {
    return { family: 'next', frameworkKey: 'nextjs-ts', label: 'Next.js', evidence: ['objective:next'] };
  }
  if (/\bastro\b/.test(text)) {
    return { family: 'astro', frameworkKey: 'astro-react', label: 'Astro', evidence: ['objective:astro'] };
  }
  if (/\blaravel\b/.test(text) || /\bphp\b/.test(text)) {
    return { family: 'laravel', frameworkKey: 'laravel-react', label: 'Laravel', evidence: ['objective:laravel'] };
  }
  if (/\bflutter\b/.test(text)) {
    return { family: 'flutter', frameworkKey: 'flutter', label: 'Flutter', evidence: ['objective:flutter'] };
  }
  if (/\bvue\b/.test(text)) {
    return { family: 'vue', frameworkKey: 'vue-vite-ts', label: 'Vue', evidence: ['objective:vue'] };
  }
  if (/\breact\b/.test(text) || /\bvite\b/.test(text)) {
    return { family: 'react', frameworkKey: 'react-vite-ts', label: 'React', evidence: ['objective:react'] };
  }
  return null;
}

export function detectWorkspaceImplementationHost({
  projectScanSnapshot = {},
  planningContext = {}
} = {}) {
  const files = new Set(collectWorkspaceFiles(projectScanSnapshot, planningContext).map(file => lower(file)));
  const projectType = lower(projectScanSnapshot?.projectType || planningContext?.facts?.projectType || planningContext?.projectType || 'generic');
  const packageJsonFound = projectScanSnapshot?.packageJsonFound === true || planningContext?.facts?.packageJsonFound === true;

  if (projectType === 'next' || files.has('app/page.tsx') || files.has('app/page.jsx') || files.has('app/layout.tsx') || files.has('app/layout.jsx') || files.has('next.config.ts') || files.has('next.config.js')) {
    return { hostKey: 'next', frameworkKey: 'nextjs-ts', evidence: ['workspace:next'] };
  }
  if (projectType === 'astro' || files.has('src/pages/index.astro') || files.has('pages/index.astro') || files.has('astro.config.mjs') || files.has('astro.config.ts')) {
    return { hostKey: 'astro', frameworkKey: 'astro-react', evidence: ['workspace:astro'] };
  }
  if (projectType === 'laravel' || files.has('artisan') || files.has('routes/web.php') || files.has('resources/views/welcome.blade.php') || files.has('composer.json')) {
    return { hostKey: 'laravel', frameworkKey: 'laravel-react', evidence: ['workspace:laravel'] };
  }
  if (projectType === 'vite' || projectType === 'node_react' || files.has('src/app.tsx') || files.has('src/app.jsx') || files.has('src/main.tsx') || files.has('src/main.jsx') || files.has('vite.config.ts') || files.has('vite.config.js')) {
    return { hostKey: 'react-vite', frameworkKey: 'react-vite-ts', evidence: ['workspace:react-vite'] };
  }
  if (projectType === 'flutter' || files.has('lib/main.dart') || files.has('pubspec.yaml')) {
    return { hostKey: 'flutter', frameworkKey: 'flutter', evidence: ['workspace:flutter'] };
  }
  if (projectType === 'php' || files.has('index.php')) {
    return { hostKey: 'php', frameworkKey: 'php-plain', evidence: ['workspace:php'] };
  }
  if (packageJsonFound) {
    return { hostKey: 'node', frameworkKey: null, evidence: ['workspace:package-json'] };
  }
  return { hostKey: 'generic', frameworkKey: null, evidence: ['workspace:generic'] };
}

export function resolveImplementationPolicy({
  objective = '',
  objectiveConstraints = [],
  planningStrategies = [],
  initializationStrategies = [],
  projectScanSnapshot = {},
  planningContext = {}
} = {}) {
  const workspaceFiles = collectWorkspaceFiles(projectScanSnapshot, planningContext);
  const workspaceEmpty = workspaceFiles.length === 0;
  const objectiveFamily = detectObjectiveImplementationFamily({
    objective,
    objectiveConstraints,
    planningStrategies
  });
  const objectiveVariantKey = detectObjectiveVariantKey({
    objective,
    objectiveConstraints,
    planningStrategies
  });
  const workspaceHost = detectWorkspaceImplementationHost({
    projectScanSnapshot,
    planningContext
  });
  const plannerPolicies = planningContext?.plannerPolicies || planningContext?.policies || {};
  const initializationAllowed = Boolean(
    planningContext?.objectiveAuthorityEligible === true ||
    planningContext?.initializationMode === 'PROJECT_INITIALIZATION' ||
    plannerPolicies?.ALLOW_PROJECT_INITIALIZATION === true ||
    plannerPolicies?.ALLOW_NEW_PROJECT_INITIALIZATION === true
  );

  return {
    objectiveText: normalizeText(objective),
    objectiveFamily,
    workspaceHost,
    workspaceEmpty,
    initializationAllowed,
    packageJsonFound: projectScanSnapshot?.packageJsonFound === true || planningContext?.facts?.packageJsonFound === true,
    packageManager: projectScanSnapshot?.packageManager || planningContext?.facts?.packageManager || null,
    packageManagerVerified: projectScanSnapshot?.packageManagerVerified === true || planningContext?.facts?.packageManagerVerified === true,
    buildSystem: projectScanSnapshot?.projectType || planningContext?.facts?.projectType || 'generic',
    plannerPolicies: {
      ...plannerPolicies
    },
    objectiveConstraintsCount: Array.isArray(objectiveConstraints) ? objectiveConstraints.length : 0,
    planningStrategiesCount: Array.isArray(planningStrategies) ? planningStrategies.length : 0,
    initializationStrategiesCount: Array.isArray(initializationStrategies) ? initializationStrategies.length : 0,
    workspaceFileCount: workspaceFiles.length,
    workspaceFiles,
    objectiveFamilyKey: normalizeImplementationKey(objectiveFamily?.family || ''),
    objectiveVariantKey
  };
}
