function log(event, data) {
  console.log(`[${event}]`, data);
}

export function validateSyntax({
  changedFiles = [],
  terminalResults = [],
  buildResults = null,
  testResults = null,
  knowledgeGraph = null,
  workspaceState = {}
} = {}) {
  log('VALIDATOR_SYNTAX_CHECK', { changedFilesCount: changedFiles.length });

  const passed = [];
  const failed = [];
  const warnings = [];
  const requiredFixes = [];

  const validationCommands = discoverValidationCommands(workspaceState, knowledgeGraph);

  if (validationCommands.length === 0) {
    warnings.push({ message: 'No validation commands discovered from workspace evidence; syntax check relies on terminal/build results only' });
  }

  const terminalResultsList = Array.isArray(terminalResults) ? terminalResults : [];

  for (const cmd of validationCommands) {
    const result = terminalResultsList.find(r => {
      const resultCmd = r.command || r.args?.command || '';
      return normalizeCommand(resultCmd) === normalizeCommand(cmd);
    });

    if (result) {
      const exitCode = result.exitCode != null ? result.exitCode : result.code;
      if (exitCode === 0) {
        passed.push({ command: cmd, message: `Validation command '${cmd}' passed` });
      } else {
        const stderr = String(result.stderr || result.error || '').substring(0, 200);
        failed.push({ command: cmd, message: `Validation command '${cmd}' failed with exit code ${exitCode}`, detail: stderr });
        requiredFixes.push(`Validation command '${cmd}' failed: ${stderr}`);
      }
    } else {
      const buildOrTestMatch = matchFromAggregateResults(cmd, buildResults, testResults);
      if (!buildOrTestMatch) {
        warnings.push({ command: cmd, message: `Validation command '${cmd}' has no terminal or aggregate result evidence` });
      }
    }
  }

  const allTerminalCmds = terminalResultsList.filter(r => {
    const exitCode = r.exitCode != null ? r.exitCode : r.code;
    return exitCode != null;
  });

  for (const r of allTerminalCmds) {
    const exitCode = r.exitCode != null ? r.exitCode : r.code;
    if (exitCode !== 0) {
      const cmd = r.command || r.args?.command || '';
      const stderr = String(r.stderr || r.error || '').substring(0, 200);
      const isValidationCmd = validationCommands.some(vc => normalizeCommand(vc) === normalizeCommand(cmd));
      if (isValidationCmd) {
        if (!failed.some(f => f.command === cmd)) {
          failed.push({ command: cmd, message: `Validation command '${cmd}' failed with exit code ${exitCode}`, detail: stderr });
          requiredFixes.push(`Validation command '${cmd}' failed: ${stderr}`);
        }
      } else {
        warnings.push({ command: cmd, message: `Non-validation command '${cmd}' failed with exit code ${exitCode}`, detail: stderr });
      }
    }
  }

  return { passed, failed, warnings, requiredFixes };
}

function normalizeCommand(cmd) {
  return String(cmd || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function discoverValidationCommands(workspaceState, knowledgeGraph) {
  const commands = [];

  if (workspaceState?.requiredCommands) {
    for (const cmd of workspaceState.requiredCommands) {
      if (cmd) commands.push(cmd);
    }
  }

  if (workspaceState?.validationCommands) {
    for (const cmd of workspaceState.validationCommands) {
      if (cmd && !commands.includes(cmd)) commands.push(cmd);
    }
  }

  if (knowledgeGraph?.edges) {
    for (const edge of knowledgeGraph.edges) {
      if (edge.type === 'validates' && edge.target) {
        if (!commands.includes(edge.target)) commands.push(edge.target);
      }
    }
  }

  return commands;
}

function matchFromAggregateResults(cmd, buildResults, testResults) {
  if (!buildResults && !testResults) return false;
  const normalized = normalizeCommand(cmd);

  if (buildResults) {
    const buildCmd = buildResults.command || '';
    if (normalizeCommand(buildCmd) === normalized) return true;
  }

  if (testResults) {
    const testCmd = testResults.command || '';
    if (normalizeCommand(testCmd) === normalized) return true;
  }

  return false;
}
