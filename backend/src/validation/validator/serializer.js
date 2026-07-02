export function serializeValidationReport(report) {
  if (!report) return null;

  const serialized = {
    status: report.status,
    score: report.score,
    canFinalize: report.canFinalize,
    confidence: report.confidence,
    summary: buildSummary(report),
    passed: (report.passed || []).map(item => ({
      validator: item.validator || '',
      message: truncate(item.message || item.detail || '', 200)
    })),
    failed: (report.failed || []).map(item => ({
      validator: item.validator || '',
      message: truncate(item.message || item.detail || '', 200),
      command: item.command || null,
      file: item.file || null,
      entity: item.entity || null
    })),
    warnings: (report.warnings || []).map(item => ({
      validator: item.validator || '',
      message: truncate(item.message || item.detail || '', 200)
    })),
    missingTasks: (report.missingTasks || []).map(item => ({
      id: item.id || '',
      kind: item.kind || '',
      status: item.status || '',
      message: truncate(item.message || '', 200)
    })),
    unexpectedChanges: (report.unexpectedChanges || []).map(item => ({
      path: item.path || '',
      detail: truncate(item.detail || item.message || '', 200),
      severity: item.severity || 'medium'
    })),
    requiredFixes: (report.requiredFixes || []).map(f => truncate(f, 300)),
    requiredCommands: [...(report.requiredCommands || [])],
    evidence: (report.evidence || []).map(item => ({
      type: item.type || '',
      validator: item.validator || '',
      detail: truncate(item.detail || '', 200)
    }))
  };

  return serialized;
}

function buildSummary(report) {
  const parts = [];
  parts.push(`Status: ${report.status}`);
  parts.push(`Score: ${report.score}`);
  parts.push(`Can finalize: ${report.canFinalize}`);

  const passedCount = report.passed?.length || 0;
  const failedCount = report.failed?.length || 0;
  const warningCount = report.warnings?.length || 0;

  parts.push(`Passed: ${passedCount}, Failed: ${failedCount}, Warnings: ${warningCount}`);

  if (report.missingTasks?.length > 0) {
    parts.push(`Missing tasks: ${report.missingTasks.length}`);
  }
  if (report.unexpectedChanges?.length > 0) {
    parts.push(`Unexpected changes: ${report.unexpectedChanges.length}`);
  }
  if (report.requiredFixes?.length > 0) {
    parts.push(`Required fixes: ${report.requiredFixes.length}`);
  }

  return parts.join(' | ');
}

function truncate(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen) + '...';
}
