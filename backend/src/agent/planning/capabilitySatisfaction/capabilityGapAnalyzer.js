export function analyzeCapabilityGap({
  statuses = []
} = {}) {
  const total = Array.isArray(statuses) ? statuses.length : 0;
  const satisfied = (Array.isArray(statuses) ? statuses : []).filter(status => status?.status === 'SATISFIED').length;
  const partial = (Array.isArray(statuses) ? statuses : []).filter(status => status?.status === 'PARTIALLY_SATISFIED').length;
  const missing = (Array.isArray(statuses) ? statuses : []).filter(status => status?.status === 'MISSING').length;
  const blocked = (Array.isArray(statuses) ? statuses : []).filter(status => status?.status === 'BLOCKED').length;
  const unknown = (Array.isArray(statuses) ? statuses : []).filter(status => status?.status === 'UNKNOWN').length;
  const coverage = total === 0 ? 0 : Math.round(((satisfied + partial) / total) * 100);

  console.log('[CAPABILITY_GAP_CREATED]', {
    total,
    satisfied,
    partial,
    missing,
    blocked,
    unknown
  });

  return {
    total,
    satisfied,
    partial,
    missing,
    blocked,
    unknown,
    coverage
  };
}
