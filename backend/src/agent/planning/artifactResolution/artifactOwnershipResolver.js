import { normalizeCapabilityKey } from '../../../planner/workspaceCapability/capabilityEvidence.js';

function normalizePath(value = '') {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/$/, '')
    .trim();
}

function ownershipForArtifact(artifact = {}) {
  const capability = normalizeCapabilityKey(artifact?.capability || '');
  const path = normalizePath(artifact?.artifact || '');
  const lowerPath = path.toLowerCase();
  const scope = [];
  let primary = 'UNKNOWN';
  let reason = 'generic workspace ownership';

  if (/\/app\.(tsx|jsx|ts|js)$/i.test(lowerPath) || /\/main\.(tsx|jsx|ts|js)$/i.test(lowerPath) || /\/page\.(tsx|jsx|ts|js)$/i.test(lowerPath)) {
    primary = 'APPLICATION_SHELL';
    scope.push('ENTRY', 'ROOT_COMPONENT', 'LAYOUT', 'ROUTING');
    reason = 'entry shell ownership';
  } else if (/\/layout\./i.test(lowerPath)) {
    primary = 'LAYOUT';
    scope.push('LAYOUT', 'ROUTING', 'SECTION');
    reason = 'layout ownership';
  } else if (/\/components\/sections\//i.test(lowerPath)) {
    primary = 'SECTION';
    scope.push('SECTION', 'COMPONENT');
    reason = 'section component ownership';
  } else if (/\/components\/navigation\//i.test(lowerPath) || /navbar|header/i.test(lowerPath)) {
    primary = 'NAVIGATION';
    scope.push('COMPONENT', 'SECTION');
    reason = 'navigation ownership';
  } else if (/styles?|theme|css/i.test(lowerPath)) {
    primary = 'STYLE_SYSTEM';
    scope.push('STYLE', 'THEME');
    reason = 'styling ownership';
  } else if (/package\.json$/i.test(lowerPath) || /config|vite\.config|next\.config/i.test(lowerPath)) {
    primary = 'PROJECT_CONFIG';
    scope.push('CONFIG', 'BUILD');
    reason = 'project config ownership';
  } else if (/\.test\./i.test(lowerPath)) {
    primary = 'VALIDATION_SUITE';
    scope.push('TEST', 'VALIDATION');
    reason = 'test ownership';
  } else if (/index\.html$/i.test(lowerPath)) {
    primary = 'DOCUMENT_SURFACE';
    scope.push('VIEW', 'DOCUMENTATION', 'ASSET');
    reason = 'document ownership';
  } else if (capability === 'APPLICATION_ENTRY') {
    primary = 'APPLICATION_SHELL';
    scope.push('ENTRY', 'ROOT_COMPONENT', 'ROUTING');
    reason = 'application entry ownership';
  } else if (capability === 'GLOBAL_STYLE' || capability === 'STYLING' || capability === 'THEME') {
    primary = 'STYLE_SYSTEM';
    scope.push('STYLE', 'THEME');
    reason = 'style ownership';
  } else if (capability === 'TEST' || capability === 'TESTING') {
    primary = 'VALIDATION_SUITE';
    scope.push('TEST', 'VALIDATION');
    reason = 'validation ownership';
  }

  return {
    primary,
    scope: [...new Set(scope)],
    reason
  };
}

export function analyzeArtifactOwnership({
  artifactNodes = []
} = {}) {
  const artifactOwnership = {};
  for (const artifact of Array.isArray(artifactNodes) ? artifactNodes : []) {
    const ownership = ownershipForArtifact(artifact);
    artifactOwnership[artifact.id] = ownership;
    artifact.ownership = ownership;
  }

  console.log('[ARTIFACT_OWNERSHIP_ANALYZED]', {
    artifactCount: Array.isArray(artifactNodes) ? artifactNodes.length : 0
  });

  return {
    artifactOwnership
  };
}

