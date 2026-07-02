function log(event, data) {
  console.log(`[${event}]`, data);
}

export function validateBuild({
  buildResults = null,
  terminalResults = [],
  changedFiles = [],
  knowledgeGraph = null,
  workspaceState = {},
  executionPlan = null
} = {}) {
  log('VALIDATOR_BUILD_CHECK', { changedFilesCount: changedFiles.length });

  const passed = [];
  const failed = [];
  const warnings = [];
  const requiredFixes = [];

  const buildCommands = discoverBuildCommands(executionPlan, workspaceState, knowledgeGraph);

  if (buildCommands.length === 0) {
    passed.push({ message: 'No build commands required by execution plan or workspace evidence' });
    return { passed, failed, warnings, requiredFixes };
  }

  const terminalResultsList = Array.isArray(terminalResults) ? terminalResults : [];

  for (const cmd of buildCommands) {
    const normalizedCmd = normalizeCommand(cmd);

    const terminalResult = terminalResultsList.find(r => {
      const resultCmd = r.command || r.args?.command || '';
      return normalizeCommand(resultCmd) === normalizedCmd;
    });

    if (terminalResult) {
      const exitCode = terminalResult.exitCode != null ? terminalResult.exitCode : terminalResult.code;
      if (exitCode === 0) {
        passed.push({ command: cmd, message: `Build command '${cmd}' passed` });
      } else if (exitCode != null) {
        const stderr = String(terminalResult.stderr || terminalResult.error || '').substring(0, 200);
        failed.push({ command: cmd, message: `Build command '${cmd}' failed with exit code ${exitCode}`, detail: stderr });
        requiredFixes.push(`Build command '${cmd}' failed: ${stderr}`);
      }
    } else if (buildResults) {
      const buildCmd = buildResults.command || '';
      if (normalizeCommand(buildCmd) === normalizedCmd) {
        const exitCode = buildResults.exitCode != null ? buildResults.exitCode : buildResults.code;
        if (exitCode === 0) {
          passed.push({ command: cmd, message: `Build command '${cmd}' passed (from aggregate results)` });
        } else {
          const stderr = String(buildResults.stderr || buildResults.error || '').substring(0, 200);
          failed.push({ command: cmd, message: `Build command '${cmd}' failed with exit code ${exitCode}`, detail: stderr });
          requiredFixes.push(`Build command '${cmd}' failed: ${stderr}`);
        }
      } else {
        warnings.push({ command: cmd, message: `Build command '${cmd}' has no terminal or aggregate result evidence` });
      }
    } else {
      warnings.push({ command: cmd, message: `Build command '${cmd}' has no terminal or aggregate result evidence` });
    }
  }

  for (const r of terminalResultsList) {
    const cmd = r.command || '';
    const exitCode = r.exitCode != null ? r.exitCode : r.code;
    const lowerCmd = cmd.toLowerCase();

    if (exitCode != null && exitCode !== 0 && /\b(build|compile|bundle|transpile)\b/.test(lowerCmd)) {
      const isAlreadyReported = failed.some(f => normalizeCommand(f.command) === normalizeCommand(cmd));
      if (!isAlreadyReported) {
        const stderr = String(r.stderr || r.error || '').substring(0, 200);
        failed.push({ command: cmd, message: `Build/compile command '${cmd}' failed with exit code ${exitCode}`, detail: stderr });
        requiredFixes.push(`Build command '${cmd}' failed: ${stderr}`);
      }
    }
  }

  return { passed, failed, warnings, requiredFixes };
}

function normalizeCommand(cmd) {
  return String(cmd || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function discoverBuildCommands(executionPlan, workspaceState, knowledgeGraph) {
  const commands = [];

  if (executionPlan?.tasks) {
    for (const task of executionPlan.tasks) {
      if (task.tool === 'RUN_TERMINAL') {
        const cmd = task.toolArgs?.command || '';
        if (cmd && /\b(build|compile|bundle|transpile|lint|format|check)\b/i.test(cmd)) {
          commands.push(cmd);
        }
      }
    }
  }

  if (workspaceState?.buildCommands) {
    for (const cmd of workspaceState.buildCommands) {
      if (cmd && !commands.includes(cmd)) commands.push(cmd);
    }
  }

  if (workspaceState?.requiredCommands) {
    for (const cmd of workspaceState.requiredCommands) {
      if (cmd && /\b(build|compile|bundle|transpile)\b/i.test(cmd) && !commands.includes(cmd)) {
        commands.push(cmd);
      }
    }
  }

  if (knowledgeGraph?.edges) {
    for (const edge of knowledgeGraph.edges) {
      if ((edge.type === 'validates' || edge.type === 'configures') && edge.target) {
        if (/\b(build|compile|bundle|transpile|lint)\b/i.test(edge.target) && !commands.includes(edge.target)) {
          commands.push(edge.target);
        }
      }
    }
  }

  return commands;
}
