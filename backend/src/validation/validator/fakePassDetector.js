function log(event, data) {
  console.log(`[${event}]`, data);
}

const NO_OP_COMMAND_PATTERNS = [
  /^echo\s+/,
  /^exit\s+0/,
  /^:\s*$/,
  /^true\s*$/,
  /^rem\s+/i,
  /^@echo\s+off/i
];

const TRIVIAL_ASSERTION_PATTERNS = [
  /assert\.(ok|equal)\s*\(\s*true\s*\)/,
  /expect\s*\(\s*true\s*\)/,
  /expect\s*\(\s*1\s*\)\.toBe\s*\(\s*1\s*\)/
];

const FAKE_TEST_PATTERNS = [
  /it\(['"]should pass['"]\s*,\s*\(\s*\)\s*=>\s*\{\s*\}/,
  /test\(['"]placeholder['"]/i,
  /\bconsole\.log\(['"]pass['"]\)/
];

export function detectFakePass({
  terminalResults = [],
  changedFiles = [],
  codeGenResults = [],
  workspaceState = {},
  finalStatus = null,
  qualityGateResult = null,
  executionPlan = null,
  testResults = null
} = {}) {
  log('VALIDATOR_FAKE_PASS_DETECTED', {});

  const warnings = [];
  const failed = [];
  const requiredFixes = [];

  const terminalResultsList = Array.isArray(terminalResults) ? terminalResults : [];
  const changedTestFiles = extractChangedTestFiles(changedFiles, codeGenResults);

  for (const result of terminalResultsList) {
    const cmd = result.command || '';
    const exitCode = result.exitCode != null ? result.exitCode : result.code;

    if (NO_OP_COMMAND_PATTERNS.some(p => p.test(cmd.trim()))) {
      if (exitCode === 0) {
        warnings.push({ command: cmd, message: `Validation command '${cmd}' is a no-op (echo/exit/true)` });
      }
    }
  }

  for (const testFile of changedTestFiles) {
    const content = testFile.content || '';

    if (FAKE_TEST_PATTERNS.some(p => p.test(content))) {
      warnings.push({ file: testFile.path, message: `Test file '${testFile.path}' contains fake test patterns` });
    }

    const hasRealAssertions = /\bassert\.(strictEqual|deepEqual|notStrictEqual|ok|rejects|throws|ifError)\s*\(/.test(content) ||
      /\bexpect\s*\(/.test(content) ||
      /\bvitest\s*\.\s*(expect|assert)/.test(content);

    if (!hasRealAssertions && content.length > 0) {
      warnings.push({ file: testFile.path, message: `Test file '${testFile.path}' has no real assertions` });
    }
  }

  if (testResults) {
    const testExitCode = testResults.exitCode != null ? testResults.exitCode : testResults.code;
    const testCommand = testResults.command || '';
    const testStdout = String(testResults.stdout || testResults.output || '').toLowerCase();
    const testStderr = String(testResults.stderr || testResults.error || '').toLowerCase();

    if (testExitCode === 0) {
      const hasTestOutput = /(pass|ok|\d+ tests?\s*$)/i.test(testStdout);
      const hasError = /(fail|error|exception)/i.test(testStderr);

      if (!hasTestOutput && !hasError && testStdout.trim().length < 20) {
        warnings.push({ command: testCommand, message: `Test command '${testCommand}' passed with suspiciously minimal output` });
      }
    }
  }

  const finalPassed = finalStatus === 'PASS' || finalStatus === 'success' || finalStatus === true;
  const terminalFailures = terminalResultsList.filter(r => {
    const exitCode = r.exitCode != null ? r.exitCode : r.code;
    return exitCode != null && exitCode !== 0;
  });

  if (finalPassed && terminalFailures.length > 0) {
    for (const failure of terminalFailures) {
      const cmd = failure.command || '';
      failed.push({
        command: cmd,
        message: `Final status says PASS but terminal command '${cmd}' failed with exit code ${failure.exitCode}`
      });
      requiredFixes.push(`Contradiction: final status PASS but terminal command '${cmd}' failed`);
    }
  }

  if (qualityGateResult) {
    const qgPassed = qualityGateResult.passed === true || qualityGateResult.score >= 80;
    const terminalHasFailures = terminalFailures.length > 0;

    if (qgPassed && terminalHasFailures && !qualityGateResult.validationFailureAttribution) {
      for (const failure of terminalFailures) {
        warnings.push({
          command: failure.command || '',
          message: `QualityGate passed despite terminal command failure: '${failure.command || ''}' exit code ${failure.exitCode}`
        });
      }
    }
  }

  if (executionPlan?.tasks) {
    const requiredCommands = executionPlan.tasks
      .filter(t => t.tool === 'RUN_TERMINAL')
      .map(t => t.toolArgs?.command || '');

    for (const cmd of requiredCommands) {
      if (!cmd) continue;
      const hasResult = terminalResultsList.some(r => {
        const resultCmd = r.command || '';
        return normalizeCommand(resultCmd) === normalizeCommand(cmd);
      });
      if (!hasResult && finalPassed) {
        warnings.push({
          command: cmd,
          message: `Required command '${cmd}' was never executed but final status is PASS`
        });
      }
    }
  }

  return { passed: [], failed, warnings, requiredFixes };
}

function normalizeCommand(cmd) {
  return String(cmd || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function extractChangedTestFiles(changedFiles, codeGenResults) {
  const testFiles = [];

  for (const f of changedFiles) {
    const filePath = f.path || f.file || f;
    const content = f.content || f.result || '';
    if (filePath && /\.(test|spec)\./i.test(filePath)) {
      testFiles.push({ path: filePath, content: String(content) });
    }
  }

  for (const r of codeGenResults) {
    const filePath = r.filePath || r.path || r.file || r.target || '';
    const content = r.content || r.code || r.result || '';
    if (filePath && /\.(test|spec)\./i.test(filePath) && !testFiles.some(t => t.path === filePath)) {
      testFiles.push({ path: filePath, content: String(content) });
    }
  }

  return testFiles;
}
