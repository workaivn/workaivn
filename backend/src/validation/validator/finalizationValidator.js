function log(event, data) {
  console.log(`[${event}]`, data);
}

export function validateFinalization({
  planValidation = null,
  fileValidation = null,
  syntaxValidation = null,
  testValidation = null,
  buildValidation = null,
  scopeValidation = null,
  fakePassResults = null,
  terminalResults = [],
  workspaceState = {}
} = {}) {
  const passed = [];
  const failed = [];
  const warnings = [];
  const requiredFixes = [];

  let canFinalize = true;
  const blockers = [];

  if (!planValidation || planValidation.failed.length > 0 || planValidation.missingTasks.length > 0) {
    canFinalize = false;
    const reason = planValidation?.failed?.length > 0
      ? `${planValidation.failed.length} critical task(s) failed`
      : `${planValidation?.missingTasks?.length || 0} critical task(s) incomplete`;
    blockers.push(reason);
    failed.push({ message: `Plan validation blocks finalization: ${reason}` });
  }

  if (fileValidation && fileValidation.failed.length > 0) {
    canFinalize = false;
    const reason = `${fileValidation.failed.length} file validation error(s)`;
    blockers.push(reason);
    failed.push({ message: `File validation blocks finalization: ${reason}` });
  }

  if (syntaxValidation && syntaxValidation.failed.length > 0) {
    canFinalize = false;
    const reason = `${syntaxValidation.failed.length} syntax/validation error(s)`;
    blockers.push(reason);
    failed.push({ message: `Syntax validation blocks finalization: ${reason}` });

    for (const f of syntaxValidation.failed) {
      requiredFixes.push(f.message || f.detail || 'Syntax/validation failure');
    }
  }

  if (buildValidation && buildValidation.failed.length > 0) {
    canFinalize = false;
    const reason = `${buildValidation.failed.length} build error(s)`;
    blockers.push(reason);
    failed.push({ message: `Build validation blocks finalization: ${reason}` });

    for (const f of buildValidation.failed) {
      requiredFixes.push(f.message || f.detail || 'Build failure');
    }
  }

  if (testValidation && testValidation.failed.length > 0) {
    canFinalize = false;
    const reason = `${testValidation.failed.length} test error(s)`;
    blockers.push(reason);
    failed.push({ message: `Test validation blocks finalization: ${reason}` });

    for (const f of testValidation.failed) {
      requiredFixes.push(f.message || f.detail || 'Test failure');
    }
  }

  if (fakePassResults && fakePassResults.failed.length > 0) {
    canFinalize = false;
    const reason = `${fakePassResults.failed.length} fake pass indicator(s) detected`;
    blockers.push(reason);
    failed.push({ message: `Fake pass detection blocks finalization: ${reason}` });
    for (const f of fakePassResults.failed) {
      requiredFixes.push(f.message || 'Fake pass detected');
    }
  }

  if (scopeValidation && scopeValidation.failed.length > 0) {
    const highSeverityFails = scopeValidation.failed.filter(f => {
      return f.severity === 'high' || !f.severity;
    });
    if (highSeverityFails.length > 0) {
      canFinalize = false;
      const reason = `${highSeverityFails.length} high-severity out-of-scope change(s)`;
      blockers.push(reason);
      failed.push({ message: `Scope validation blocks finalization: ${reason}` });
    } else {
      warnings.push({ message: 'Out-of-scope warnings exist but none at high severity' });
    }
  }

  const terminalResultsList = Array.isArray(terminalResults) ? terminalResults : [];
  const terminalFailures = terminalResultsList.filter(r => {
    const exitCode = r.exitCode != null ? r.exitCode : r.code;
    return exitCode != null && exitCode !== 0;
  });

  if (terminalFailures.length > 0) {
    const unresolvedFailures = terminalFailures.filter(f => {
      if (syntaxValidation && syntaxValidation.failed.some(sf => {
        const cmd = f.command || '';
        return sf.command && normalizeCommand(sf.command) === normalizeCommand(cmd);
      })) return false;
      if (buildValidation && buildValidation.failed.some(bf => {
        const cmd = f.command || '';
        return bf.command && normalizeCommand(bf.command) === normalizeCommand(cmd);
      })) return false;
      if (testValidation && testValidation.failed.some(tf => {
        const cmd = f.command || '';
        return tf.command && normalizeCommand(tf.command) === normalizeCommand(cmd);
      })) return false;
      return true;
    });

    if (unresolvedFailures.length > 0 && blockers.length === 0) {
      canFinalize = false;
      blockers.push(`${unresolvedFailures.length} unresolved terminal failure(s)`);
      failed.push({ message: `Unresolved terminal failures block finalization` });
    }
  }

  if (canFinalize) {
    passed.push({ message: 'All validation checks pass; finalization is safe' });
  } else {
    log('VALIDATOR_FINALIZATION_BLOCKED', { blockers });
  }

  return { passed, failed, warnings, requiredFixes, canFinalize, blockers };
}

function normalizeCommand(cmd) {
  return String(cmd || '').replace(/\s+/g, ' ').trim().toLowerCase();
}
