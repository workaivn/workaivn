import { normalizeCanonicalPath } from '../../agent/context/canonicalPath.js';
import { collectEvidence, normalizeCapabilityKey, stringifyCapabilityEvidence } from './capabilityEvidence.js';

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => normalizeCanonicalPath(value)).filter(Boolean))];
}

function lower(value = '') {
  return String(value || '').toLowerCase();
}

function pushMatch(matches, capability, file, detail, confidence = 0.8) {
  const key = normalizeCapabilityKey(capability);
  if (!key || !file) return;
  if (!matches.has(key)) {
    matches.set(key, {
      id: `workspace-capability:${key}`,
      capability: key,
      confidence: 0,
      evidence: [],
      existingArtifacts: [],
      requestedArtifacts: [],
      candidateArtifacts: [],
      plannerDecision: 'DISCOVERED'
    });
  }
  const record = matches.get(key);
  const normalizedFile = normalizeCanonicalPath(file);
  if (!record.existingArtifacts.some(entry => lower(entry.file) === lower(normalizedFile))) {
    record.existingArtifacts.push({
      file: normalizedFile,
      kind: detail || key,
      confidence,
      evidence: collectEvidence({
        capability: key,
        source: 'workspace_scan',
        path: normalizedFile,
        detail
      })
    });
  }
  record.confidence = Math.max(record.confidence, confidence);
  record.evidence.push(...collectEvidence({
    capability: key,
    source: 'workspace_scan',
    path: normalizedFile,
    detail
  }));
}

function pushRequestedMatch(matches, capability, file, detail, confidence = 0.8) {
  const key = normalizeCapabilityKey(capability);
  if (!key || !file) return;
  if (!matches.has(key)) {
    matches.set(key, {
      id: `workspace-capability:${key}`,
      capability: key,
      confidence: 0,
      evidence: [],
      existingArtifacts: [],
      requestedArtifacts: [],
      candidateArtifacts: [],
      plannerDecision: 'DISCOVERED'
    });
  }
  const record = matches.get(key);
  const normalizedFile = normalizeCanonicalPath(file);
  if (!record.requestedArtifacts.some(entry => lower(entry.file) === lower(normalizedFile))) {
    record.requestedArtifacts.push({
      file: normalizedFile,
      kind: detail || key,
      confidence,
      evidence: collectEvidence({
        capability: key,
        source: 'requestedFileDetails',
        path: normalizedFile,
        detail: 'Requested artifact, not existing workspace artifact'
      })
    });
    console.log('[CAPABILITY_REQUESTED_ARTIFACT]', {
      capability: key,
      path: normalizedFile,
      source: 'requestedFileDetails',
      note: 'Requested artifact, not existing workspace artifact'
    });
  }
  record.confidence = Math.max(record.confidence, confidence);
  record.evidence.push(...collectEvidence({
    capability: key,
    source: 'requestedFileDetails',
    path: normalizedFile,
    detail: 'Requested artifact, not existing workspace artifact'
  }));
}

function inferCapabilitiesForFile(file = '', projectType = '') {
  const normalized = lower(file);
  const matches = [];
  if (/^(app\/page|src\/app|src\/main|pages\/index|index)\.(tsx|jsx|ts|js|html|php)$/i.test(normalized)) {
    matches.push(['APPLICATION_ENTRY', 0.98, 'entrypoint']);
  }
  if (/^(app\/page|src\/app|src\/main|pages\/index|views\/home\/index|index)\.(tsx|jsx|ts|js|html|php)$/i.test(normalized)) {
    matches.push(['ROOT_COMPONENT', 0.96, 'root component']);
  }
  if (/layout\.(tsx|jsx|ts|js|cshtml|blade\.php)$/i.test(normalized)) {
    matches.push(['LAYOUT', 0.95, 'layout']);
    matches.push(['COMPONENT_STRUCTURE', 0.82, 'component structure']);
  }
  if (/router\.(tsx|jsx|ts|js)$/i.test(normalized) || /(^|\/)(routes|router)\//i.test(normalized) || /(^|\/)routes\//i.test(normalized)) {
    matches.push(['ROUTING', 0.95, 'routing']);
  }
  if (/(style|styles|globals|theme)\.(css|scss|sass|less|ts|tsx|js|jsx)$/i.test(normalized) || /(^|\/)assets\/css\//i.test(normalized)) {
    matches.push(['GLOBAL_STYLE', 0.95, 'style']);
    matches.push(['STYLING', 0.9, 'styling']);
  }
  if (/navigation|navbar|nav/i.test(normalized)) {
    matches.push(['NAVIGATION', 0.9, 'navigation']);
  }
  if (/hero/i.test(normalized)) {
    matches.push(['HERO', 0.86, 'hero section']);
  }
  if (/feature/i.test(normalized)) {
    matches.push(['FEATURES', 0.86, 'features']);
  }
  if (/pricing/i.test(normalized)) {
    matches.push(['PRICING', 0.86, 'pricing']);
  }
  if (/cta/i.test(normalized)) {
    matches.push(['CTA', 0.86, 'call to action']);
  }
  if (/footer/i.test(normalized)) {
    matches.push(['FOOTER', 0.86, 'footer']);
  }
  if (/accessibility|aria|keyboard/i.test(normalized)) {
    matches.push(['SEMANTIC_STRUCTURE', 0.82, 'semantic structure']);
    matches.push(['ARIA_SUPPORT', 0.86, 'aria support']);
    matches.push(['KEYBOARD_SUPPORT', 0.86, 'keyboard support']);
  }
  if (/performance|lazy|split|chunk/i.test(normalized)) {
    matches.push(['CODE_SPLITTING', 0.84, 'code splitting']);
    matches.push(['LAZY_LOADING', 0.84, 'lazy loading']);
    matches.push(['PERFORMANCE_OPTIMIZATION', 0.82, 'performance']);
  }
  if (/animation|motion/i.test(normalized)) {
    matches.push(['ANIMATION_LAYER', 0.86, 'animation']);
    matches.push(['MOTION_CAPABILITY', 0.82, 'motion']);
  }
  if (/index\.html$/i.test(normalized)) {
    matches.push(['SEMANTIC_HTML', 0.88, 'semantic html']);
    matches.push(['METADATA', 0.8, 'metadata']);
    matches.push(['STRUCTURED_CONTENT', 0.8, 'structured content']);
  }
  if (/package\.json$/i.test(normalized)) {
    matches.push(['PROJECT_MANIFEST', 0.96, 'project manifest']);
    matches.push(['DEPENDENCY_MANIFEST', 0.96, 'dependency manifest']);
  }
  if (/\.(test|spec)\.(tsx|jsx|ts|js|php|dart|cshtml)$/i.test(normalized)) {
    matches.push(['TEST', 0.95, 'test']);
  }
  if (/vite\.config\.(ts|js)$/i.test(normalized) || /next\.config\.(js|mjs|ts)$/i.test(normalized) || /tailwind\.config\.(js|ts)$/i.test(normalized)) {
    matches.push(['BUILD', 0.9, 'build']);
  }
  if (/components\//i.test(normalized) || /(^|\/)components\//i.test(normalized)) {
    matches.push(['COMPONENT_STRUCTURE', 0.88, 'component structure']);
  }
  if (projectType === 'next' && /app\/page\.(tsx|jsx|ts|js)$/i.test(normalized)) {
    matches.push(['APPLICATION_ENTRY', 0.99, 'next entry']);
  }
  return matches;
}

export function scanWorkspaceCapabilities({
  projectScanSnapshot = {},
  planningContext = {},
  objective = ''
} = {}) {
  const files = unique([
    ...(Array.isArray(projectScanSnapshot?.discoveredFiles) ? projectScanSnapshot.discoveredFiles : []),
    ...(Array.isArray(projectScanSnapshot?.files) ? projectScanSnapshot.files : []),
    ...(Array.isArray(projectScanSnapshot?.entryFiles) ? projectScanSnapshot.entryFiles : []),
    ...(Array.isArray(projectScanSnapshot?.styleFiles) ? projectScanSnapshot.styleFiles : []),
    ...(Array.isArray(planningContext?.verifiedFiles) ? planningContext.verifiedFiles : []),
    ...(Array.isArray(planningContext?.facts?.discoveredFiles) ? planningContext.facts.discoveredFiles : []),
    ...(Array.isArray(planningContext?.facts?.verifiedFiles) ? planningContext.facts.verifiedFiles : [])
  ]);
  const requestedFiles = unique([
    ...(Array.isArray(projectScanSnapshot?.explicitRequestedFiles) ? projectScanSnapshot.explicitRequestedFiles : []),
    ...(Array.isArray(projectScanSnapshot?.plannerApprovedFiles) ? projectScanSnapshot.plannerApprovedFiles : []),
    ...(Array.isArray(planningContext?.plannedFiles) ? planningContext.plannedFiles : []),
    ...(Array.isArray(planningContext?.facts?.explicitRequestedFiles) ? planningContext.facts.explicitRequestedFiles : []),
    ...(Array.isArray(planningContext?.facts?.plannerApprovedFiles) ? planningContext.facts.plannerApprovedFiles : []),
    ...(Array.isArray(planningContext?.facts?.plannedFiles) ? planningContext.facts.plannedFiles : []),
    ...(Array.isArray(planningContext?.facts?.requestedFileDetails) ? planningContext.facts.requestedFileDetails.map(entry => entry?.path).filter(Boolean) : [])
  ]);

  console.log('[WORKSPACE_CAPABILITY_SCAN]', {
    fileCount: files.length,
    requestedFileCount: requestedFiles.length,
    projectType: projectScanSnapshot?.projectType || planningContext?.facts?.projectType || 'generic',
    packageJsonFound: projectScanSnapshot?.packageJsonFound === true
  });

  const matches = new Map();
  const projectType = String(projectScanSnapshot?.projectType || planningContext?.facts?.projectType || planningContext?.projectType || 'generic').toLowerCase();
  for (const file of files) {
    for (const [capability, confidence, detail] of inferCapabilitiesForFile(file, projectType)) {
      pushMatch(matches, capability, file, detail, confidence);
    }
  }

  for (const file of requestedFiles) {
    for (const [capability, confidence, detail] of inferCapabilitiesForFile(file, projectType)) {
      pushRequestedMatch(matches, capability, file, detail, confidence);
    }
  }

  if (projectScanSnapshot?.packageJsonFound === true) {
    pushMatch(matches, 'PROJECT_MANIFEST', projectScanSnapshot.packageJsonPath || 'package.json', 'package manifest', 0.97);
    pushMatch(matches, 'DEPENDENCY_MANIFEST', projectScanSnapshot.packageJsonPath || 'package.json', 'dependency manifest', 0.97);
  }

  const workspaceCapabilities = [...matches.values()].map(record => ({
    ...record,
    evidence: stringifyCapabilityEvidence(record.evidence),
    existingArtifacts: record.existingArtifacts.map(artifact => ({
      ...artifact,
      evidence: stringifyCapabilityEvidence(artifact.evidence)
    })),
    requestedArtifacts: record.requestedArtifacts.map(artifact => ({
      ...artifact,
      evidence: stringifyCapabilityEvidence(artifact.evidence)
    }))
  }));

  for (const capability of workspaceCapabilities) {
    console.log('[CAPABILITY_DISCOVERED]', {
      id: capability.id,
      capability: capability.capability,
      confidence: capability.confidence,
      existingArtifacts: capability.existingArtifacts.map(artifact => artifact.file),
      requestedArtifacts: capability.requestedArtifacts.map(artifact => artifact.file)
    });
    console.log('[CAPABILITY_EVIDENCE]', {
      id: capability.id,
      capability: capability.capability,
      evidence: capability.evidence
    });
  }

  return {
    workspaceCapabilities,
    capabilityEvidence: workspaceCapabilities.flatMap(capability => capability.evidence.map(entry => ({
      capability: capability.capability,
      evidence: entry
    }))),
    discoveredFiles: files,
    objective
  };
}
