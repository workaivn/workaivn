function log(event, data) {
  console.log(`[${event}]`, data);
}

const TRIVIAL_ASSERTION_PATTERNS = [
  /assert\.(ok|equal|strictEqual)\s*\(\s*true\s*\)/,
  /assert\.(ok|equal|strictEqual)\s*\(\s*false\s*\)/,
  /expect\s*\(\s*true\s*\)\.toBe\s*\(\s*true\s*\)/,
  /expect\s*\(\s*1\s*\)\.toBe\s*\(\s*1\s*\)/,
  /expect\.resolve\s*\(\s*true\s*\)/
];

const SKIP_PATTERNS = [
  /test\.skip\s*\(/,
  /describe\.skip\s*\(/,
  /it\.skip\s*\(/,
  /xdescribe\s*\(/,
  /xit\s*\(/,
  /xtest\s*\(/
];

const TRIVIAL_ONLY_PATTERNS = [
  /\bthrow\s+new\s+Error\s*\(\s*['"]not implemented['"]\s*\)/i,
  /\b(?:placeholder|todo|fixme)\s*:/i,
  /\/\/\s*TODO/i,
  /pending\s*\(\)/,
  /it\.todo\(/,
  /test\.todo\(/
];

export function validateTests({
  testResults = null,
  changedFiles = [],
  codeGenResults = [],
  knowledgeGraph = null,
  workspaceState = {},
  executionPlan = null
} = {}) {
  log('VALIDATOR_TEST_CHECK', {});

  const passed = [];
  const failed = [];
  const warnings = [];
  const requiredFixes = [];

  const plannedTests = extractPlannedTests(executionPlan, codeGenResults, workspaceState);
  const changedTestFiles = extractChangedTestFiles(changedFiles, codeGenResults);

  if (plannedTests.length === 0 && changedTestFiles.length === 0) {
    passed.push({ message: 'No tests planned or changed; test validation skipped' });
    return { passed, failed, warnings, requiredFixes };
  }

  for (const testFile of plannedTests) {
    const normalizedPath = normalize(testFile);
    const fileExists = changedTestFiles.some(f => normalize(f) === normalizedPath) ||
      (workspaceState?.existingFiles || []).some(f => normalize(f) === normalizedPath);

    if (fileExists) {
      passed.push({ file: testFile, message: `Required test file '${testFile}' exists` });
    } else {
      failed.push({ file: testFile, message: `Required test file '${testFile}' not found in changed files or workspace` });
      requiredFixes.push(`Test file '${testFile}' is missing`);
    }
  }

  for (const testFile of changedTestFiles) {
    const content = testFile.content || '';
    if (!content) continue;

    const hasTrivialAssertions = TRIVIAL_ASSERTION_PATTERNS.some(p => p.test(content));
    if (hasTrivialAssertions) {
      warnings.push({ file: testFile.path, message: `Test file '${testFile.path}' contains trivial assertions that always pass` });
    }

    const hasSkipAll = isFullySkipped(content);
    if (hasSkipAll) {
      warnings.push({ file: testFile.path, message: `Test file '${testFile.path}' has all tests skipped or marked as todo` });
    }

    const hasMeaninglessContent = TRIVIAL_ONLY_PATTERNS.some(p => p.test(content));
    if (hasMeaninglessContent && !hasTrivialAssertions) {
      warnings.push({ file: testFile.path, message: `Test file '${testFile.path}' contains placeholder/todo content without real assertions` });
    }
  }

  if (testResults) {
    const exitCode = testResults.exitCode != null ? testResults.exitCode : testResults.code;
    const command = testResults.command || '';

    if (exitCode === 0) {
      passed.push({ command, message: `Test command '${command}' passed` });
    } else if (exitCode != null) {
      const stderr = String(testResults.stderr || testResults.error || '').substring(0, 200);
      failed.push({ command, message: `Test command '${command}' failed with exit code ${exitCode}`, detail: stderr });
      requiredFixes.push(`Test command '${command}' failed: ${stderr}`);
    } else {
      warnings.push({ command, message: `Test command '${command}' has no exit code evidence` });
    }
  } else {
    const hasTerminalTestEvidence = workspaceState?.terminalResults?.some(r => {
      const cmd = r.command || '';
      return /\b(test|spec|vitest|jest|mocha|pytest|go\s+test)\b/i.test(cmd);
    });

    if (!hasTerminalTestEvidence && plannedTests.length > 0) {
      warnings.push({ message: 'Tests planned but no test result evidence provided' });
    }
  }

  return { passed, failed, warnings, requiredFixes };
}

function normalize(filePath) {
  if (!filePath) return '';
  const str = typeof filePath === 'string' ? filePath : (filePath.path || filePath.file || filePath.filePath || '');
  if (!str) return '';
  return str.replace(/\\/g, '/').toLowerCase();
}

function extractPlannedTests(executionPlan, codeGenResults, workspaceState) {
  const tests = new Set();

  if (executionPlan?.tasks) {
    for (const task of executionPlan.tasks) {
      const goal = task.goal || '';
      if (/\btest\b/i.test(goal)) {
        const filePath = task.toolArgs?.path || task.toolArgs?.file || '';
        if (filePath) tests.add(filePath);
      }
    }
  }

  for (const r of codeGenResults) {
    const filePath = r.filePath || r.path || r.file || r.target || '';
    if (filePath && /\.(test|spec)\./i.test(filePath)) {
      tests.add(filePath);
    }
  }

  return [...tests];
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
    if (filePath && /\.(test|spec)\./i.test(filePath) && !testFiles.some(t => normalize(t.path) === normalize(filePath))) {
      testFiles.push({ path: filePath, content: String(content) });
    }
  }

  return testFiles;
}

function isFullySkipped(content) {
  const testCount = (content.match(/\b(test|it|specify)\s*\(/g) || []).length;
  if (testCount === 0) return false;

  const skipCount = (content.match(/(test|it|specify)\.skip\s*\(/g) || []).length;
  const todoCount = (content.match(/(test|it|specify)\.todo\s*\(/g) || []).length;
  const xCount = (content.match(/\bxit\s*\(|\bxtest\s*\(/g) || []).length;

  return (skipCount + todoCount + xCount) >= testCount;
}
