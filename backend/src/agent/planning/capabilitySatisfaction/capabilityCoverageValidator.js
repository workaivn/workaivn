export function validateCapabilityCoverage({
  statuses = [],
  coverage = null
} = {}) {
  const total = Array.isArray(statuses) ? statuses.length : 0;
  const satisfied = (Array.isArray(statuses) ? statuses : []).filter(status => status?.status === 'SATISFIED').length;
  const partial = (Array.isArray(statuses) ? statuses : []).filter(status => status?.status === 'PARTIALLY_SATISFIED').length;
  const missing = (Array.isArray(statuses) ? statuses : []).filter(status => status?.status === 'MISSING').length;
  const blocked = (Array.isArray(statuses) ? statuses : []).filter(status => status?.status === 'BLOCKED').length;
  const unknown = (Array.isArray(statuses) ? statuses : []).filter(status => status?.status === 'UNKNOWN').length;
  const validCounts = total === satisfied + partial + missing + blocked + unknown;
  const expectedCoverage = total === 0 ? 0 : Math.round(((satisfied + partial) / total) * 100);
  const validCoverage = coverage === null || coverage === undefined || Number(coverage) === expectedCoverage;

  return {
    valid: validCounts && validCoverage,
    errors: [
      !validCounts ? 'Capability counts do not sum to total' : null,
      !validCoverage ? 'Capability coverage mismatch' : null
    ].filter(Boolean)
  };
}
