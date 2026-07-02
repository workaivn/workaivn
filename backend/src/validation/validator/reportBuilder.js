import { VALIDATOR_STATUS, createEmptyReport } from './types.js';

function log(event, data) {
  console.log(`[${event}]`, data);
}

export function buildValidationReport({
  planValidation = null,
  fileValidation = null,
  syntaxValidation = null,
  importExportValidation = null,
  entityChainValidation = null,
  testValidation = null,
  buildValidation = null,
  scopeValidation = null,
  fakePassResults = null,
  finalizationResult = null
} = {}) {
  const report = createEmptyReport();

  const allPassed = [];
  const allFailed = [];
  const allWarnings = [];
  const allMissingTasks = [];
  const allUnexpectedChanges = [];
  const allRequiredFixes = [];
  const allRequiredCommands = [];
  const allEvidence = [];

  const validations = [
    { name: 'plan', result: planValidation },
    { name: 'file', result: fileValidation },
    { name: 'syntax', result: syntaxValidation },
    { name: 'importExport', result: importExportValidation },
    { name: 'entityChain', result: entityChainValidation },
    { name: 'test', result: testValidation },
    { name: 'build', result: buildValidation },
    { name: 'scope', result: scopeValidation },
    { name: 'fakePass', result: fakePassResults }
  ];

  let hasFailure = false;
  let hasIncomplete = false;
  let hasFakePass = false;

  for (const v of validations) {
    if (!v.result) continue;

    for (const item of (v.result.passed || [])) {
      allPassed.push({ validator: v.name, ...item });
    }
    for (const item of (v.result.failed || [])) {
      allFailed.push({ validator: v.name, ...item });
      hasFailure = true;
    }
    for (const item of (v.result.warnings || [])) {
      allWarnings.push({ validator: v.name, ...item });
    }
    for (const item of (v.result.missingTasks || [])) {
      allMissingTasks.push(item);
      hasIncomplete = true;
    }
    for (const item of (v.result.unexpectedChanges || [])) {
      allUnexpectedChanges.push(item);
    }
    for (const item of (v.result.requiredFixes || [])) {
      const message = typeof item === 'string' ? item : (item.message || item.detail || '');
      if (message && !allRequiredFixes.includes(message)) {
        allRequiredFixes.push(message);
      }
    }
  }

  if (fakePassResults && fakePassResults.failed?.length > 0) {
    hasFakePass = true;
  }

  const terminalFailures = allFailed.filter(f => f.command);
  for (const f of terminalFailures) {
    if (f.command && !allRequiredCommands.includes(f.command)) {
      allRequiredCommands.push(f.command);
    }
  }

  report.passed = allPassed;
  report.failed = allFailed;
  report.warnings = allWarnings;
  report.missingTasks = allMissingTasks;
  report.unexpectedChanges = allUnexpectedChanges;
  report.requiredFixes = [...new Set(allRequiredFixes)];
  report.requiredCommands = [...new Set(allRequiredCommands)];

  const totalItems = allPassed.length + allFailed.length + allWarnings.length;
  report.confidence = totalItems > 0 ? Math.round((allPassed.length / totalItems) * 100) : 0;

  if (finalizationResult) {
    report.canFinalize = finalizationResult.canFinalize === true;

    if (report.canFinalize && hasFailure) {
      report.canFinalize = false;
    }
  } else {
    report.canFinalize = allFailed.length === 0 && allMissingTasks.length === 0 && !hasFakePass;
  }

  if (hasFakePass) {
    report.status = VALIDATOR_STATUS.FAIL;
    report.score = 0;
  } else if (allFailed.length > 0 && hasIncomplete) {
    report.status = VALIDATOR_STATUS.INCOMPLETE;
    report.score = computeScore(allPassed.length, allFailed.length, allMissingTasks.length, hasFakePass);
  } else if (allFailed.length > 0) {
    report.status = VALIDATOR_STATUS.FAIL;
    report.score = computeScore(allPassed.length, allFailed.length, allMissingTasks.length, hasFakePass);
  } else if (hasIncomplete) {
    report.status = VALIDATOR_STATUS.INCOMPLETE;
    report.score = computeScore(allPassed.length, allFailed.length, allMissingTasks.length, hasFakePass);
  } else if (!report.canFinalize) {
    report.status = VALIDATOR_STATUS.BLOCKED;
    report.score = 50;
  } else {
    report.status = VALIDATOR_STATUS.PASS;
    report.score = computeScore(allPassed.length, 0, 0, false);
  }

  for (const item of allPassed) {
    allEvidence.push({ type: 'passed', validator: item.validator, detail: item.message || '' });
  }
  for (const item of allFailed) {
    allEvidence.push({ type: 'failed', validator: item.validator, detail: item.message || '', command: item.command });
  }

  report.evidence = allEvidence;

  const statusLog = {
    [VALIDATOR_STATUS.PASS]: 'VALIDATOR_PASS',
    [VALIDATOR_STATUS.FAIL]: 'VALIDATOR_FAIL',
    [VALIDATOR_STATUS.INCOMPLETE]: 'VALIDATOR_INCOMPLETE',
    [VALIDATOR_STATUS.BLOCKED]: 'VALIDATOR_FAIL'
  };

  log(statusLog[report.status] || 'VALIDATOR_COMPLETE', {
    status: report.status,
    score: report.score,
    passed: allPassed.length,
    failed: allFailed.length,
    warnings: allWarnings.length,
    canFinalize: report.canFinalize,
    missingTasks: allMissingTasks.length,
    unexpectedChanges: allUnexpectedChanges.length
  });

  return report;
}

function computeScore(passedCount, failedCount, missingCount, hasFakePass) {
  if (hasFakePass) return 0;
  if (failedCount > 0 && passedCount === 0) return 0;
  if (failedCount > 0) {
    const total = passedCount + failedCount + missingCount;
    if (total === 0) return 50;
    return Math.round((passedCount / total) * 49);
  }
  if (missingCount > 0) {
    const total = passedCount + missingCount;
    if (total === 0) return 50;
    return Math.round(50 + (passedCount / total) * 29);
  }
  if (passedCount === 0) return 100;
  return Math.min(100, 80 + Math.round((passedCount / (passedCount + 1)) * 20));
}
