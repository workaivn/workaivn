function normalizePath(value = '') {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/$/, '')
    .trim();
}

function normalizeText(value = '') {
  return String(value || '').trim();
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => normalizeText(value)).filter(Boolean))];
}

export function normalizeCapabilityKey(value = '') {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function createCapabilityEvidence({
  capability = '',
  source = '',
  path = null,
  detail = null,
  confidence = null
} = {}) {
  const entry = {
    capability: normalizeCapabilityKey(capability),
    source: normalizeText(source),
    path: path ? normalizePath(path) : null,
    detail: detail ? normalizeText(detail) : null
  };
  if (confidence !== null && confidence !== undefined && Number.isFinite(Number(confidence))) {
    entry.confidence = Math.max(0, Math.min(1, Number(confidence)));
  }
  return entry;
}

export function mergeCapabilityEvidence(...groups) {
  const merged = [];
  for (const group of groups) {
    for (const item of Array.isArray(group) ? group : []) {
      if (!item || typeof item !== 'object') continue;
      merged.push(createCapabilityEvidence(item));
    }
  }
  return merged;
}

export function stringifyCapabilityEvidence(items = []) {
  return unique(
    (Array.isArray(items) ? items : []).map(item => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      const parts = [
        item.capability ? `capability:${normalizeCapabilityKey(item.capability)}` : null,
        item.source ? `source:${normalizeText(item.source)}` : null,
        item.path ? `path:${normalizePath(item.path)}` : null,
        item.detail ? normalizeText(item.detail) : null
      ].filter(Boolean);
      return parts.join(' | ');
    })
  );
}

export function collectEvidence({
  capability = '',
  source = '',
  path = null,
  detail = null,
  objective = '',
  projectScanSnapshot = {},
  planningContext = {},
  requirement = null
} = {}) {
  const capabilityKey = normalizeCapabilityKey(capability);
  const evidence = [
    createCapabilityEvidence({ capability: capabilityKey, source, path, detail }),
    createCapabilityEvidence({
      capability: capabilityKey,
      source: 'objective',
      detail: objective ? `objective:${String(objective).slice(0, 120)}` : null
    }),
    createCapabilityEvidence({
      capability: capabilityKey,
      source: 'projectScan',
      detail: projectScanSnapshot?.projectType ? `projectType:${projectScanSnapshot.projectType}` : null
    }),
    createCapabilityEvidence({
      capability: capabilityKey,
      source: 'projectScan',
      detail: projectScanSnapshot?.packageJsonFound === true ? 'packageJsonFound:true' : 'packageJsonFound:false'
    }),
    createCapabilityEvidence({
      capability: capabilityKey,
      source: 'planningContext',
      detail: Array.isArray(planningContext?.verifiedFiles) ? `verifiedFiles:${planningContext.verifiedFiles.length}` : null
    }),
    createCapabilityEvidence({
      capability: capabilityKey,
      source: 'requirement',
      detail: requirement?.id ? `requirementId:${requirement.id}` : null
    })
  ];
  return mergeCapabilityEvidence(evidence);
}

