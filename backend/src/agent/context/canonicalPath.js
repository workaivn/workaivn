export function normalizeCanonicalPath(value = '') {
  if (!value || typeof value !== 'string') return '';
  return String(value)
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .trim()
    .toLowerCase();
}

export function createCanonicalSet(paths = []) {
  const set = new Set();
  for (const p of Array.isArray(paths) ? paths : []) {
    const n = normalizeCanonicalPath(p);
    if (n) set.add(n);
  }
  return set;
}

export function canonicalFileAccepted(filePath, canonicalSet, plannedSet = new Set(), verifiedSet = new Set()) {
  const normalized = normalizeCanonicalPath(filePath);
  if (!normalized) return false;
  if (canonicalSet.has(normalized)) return true;
  if (plannedSet.has(normalized)) return true;
  if (verifiedSet.has(normalized)) return true;
  return false;
}
