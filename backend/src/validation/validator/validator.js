import { validatePlanCompletion } from './planValidator.js';
import { validateFileChanges } from './fileValidator.js';
import { validateSyntax } from './syntaxValidator.js';
import { validateImportsExports } from './importExportValidator.js';
import { validateEntityChains } from './entityChainValidator.js';
import { validateTests } from './testValidator.js';
import { validateBuild } from './buildValidator.js';
import { validateScope } from './scopeValidator.js';
import { detectFakePass } from './fakePassDetector.js';
import { validateFinalization } from './finalizationValidator.js';
import { buildValidationReport } from './reportBuilder.js';
import { serializeValidationReport } from './serializer.js';
import { VALIDATOR_LOG_EVENTS } from './types.js';

function log(event, data) {
  console.log(`[${event}]`, data);
}

export function validateExecutionResult(input = {}) {
  log('VALIDATOR_START', {
    hasPlan: !!input.executionPlan,
    hasTaskStates: Array.isArray(input.taskStates),
    hasChangedFiles: Array.isArray(input.changedFiles),
    hasTerminalResults: Array.isArray(input.terminalResults)
  });

  const planValidation = validatePlanCompletion({
    executionPlan: input.executionPlan,
    taskStates: input.taskStates,
    terminalResults: input.terminalResults,
    changedFiles: input.changedFiles,
    codeGenResults: input.codeGenResults,
    workspaceState: input.workspaceState
  });

  const fileValidation = validateFileChanges({
    executionPlan: input.executionPlan,
    changedFiles: input.changedFiles,
    workspaceState: input.workspaceState,
    codeGenResults: input.codeGenResults,
    taskStates: input.taskStates,
    knowledgeGraph: input.knowledgeGraph
  });

  const syntaxValidation = validateSyntax({
    changedFiles: input.changedFiles,
    terminalResults: input.terminalResults,
    buildResults: input.buildResults,
    testResults: input.testResults,
    knowledgeGraph: input.knowledgeGraph,
    workspaceState: input.workspaceState
  });

  const importExportValidation = validateImportsExports({
    changedFiles: input.changedFiles,
    codeGenResults: input.codeGenResults,
    dependencyGraph: input.dependencyGraph,
    knowledgeGraph: input.knowledgeGraph,
    workspaceState: input.workspaceState,
    executionPlan: input.executionPlan
  });

  const entityChainValidation = validateEntityChains({
    executionPlan: input.executionPlan,
    knowledgeGraph: input.knowledgeGraph,
    dependencyGraph: input.dependencyGraph,
    componentTree: input.componentTree,
    uiPlan: input.uiPlan,
    workspaceState: input.workspaceState
  });

  const testValidation = validateTests({
    testResults: input.testResults,
    changedFiles: input.changedFiles,
    codeGenResults: input.codeGenResults,
    knowledgeGraph: input.knowledgeGraph,
    workspaceState: input.workspaceState,
    executionPlan: input.executionPlan
  });

  const buildValidationResult = validateBuild({
    buildResults: input.buildResults,
    terminalResults: input.terminalResults,
    changedFiles: input.changedFiles,
    knowledgeGraph: input.knowledgeGraph,
    workspaceState: input.workspaceState,
    executionPlan: input.executionPlan
  });

  const scopeValidation = validateScope({
    changedFiles: input.changedFiles,
    executionPlan: input.executionPlan,
    knowledgeGraph: input.knowledgeGraph,
    dependencyGraph: input.dependencyGraph,
    workspaceState: input.workspaceState,
    userPrompt: input.userPrompt
  });

  const fakePassResults = detectFakePass({
    terminalResults: input.terminalResults,
    changedFiles: input.changedFiles,
    codeGenResults: input.codeGenResults,
    workspaceState: input.workspaceState,
    finalStatus: input.finalStatus,
    qualityGateResult: input.qualityGateResult,
    executionPlan: input.executionPlan,
    testResults: input.testResults
  });

  const finalizationResult = validateFinalization({
    planValidation,
    fileValidation,
    syntaxValidation,
    testValidation,
    buildValidation: buildValidationResult,
    scopeValidation,
    fakePassResults,
    terminalResults: input.terminalResults,
    workspaceState: input.workspaceState
  });

  const report = buildValidationReport({
    planValidation,
    fileValidation,
    syntaxValidation,
    importExportValidation,
    entityChainValidation,
    testValidation,
    buildValidation: buildValidationResult,
    scopeValidation,
    fakePassResults,
    finalizationResult
  });

  log('VALIDATOR_COMPLETE', {
    status: report.status,
    score: report.score,
    canFinalize: report.canFinalize,
    passed: report.passed.length,
    failed: report.failed.length,
    warnings: report.warnings.length
  });

  return report;
}

export function getValidatorLogEvents() {
  return [...VALIDATOR_LOG_EVENTS];
}
