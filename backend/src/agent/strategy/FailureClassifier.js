import { analyzeValidationFailure } from '../planner/recoveryPlanner.js';
import { logStrategy } from './StrategyLogger.js';

function normalizeText(value = '') {
  return String(value || '').replace(/\r/g, '\n').trim();
}

function classifyValidationCommandFailure(text = '') {
  const lower = String(text || '').toLowerCase();
  if (/framework unavailable|not installed|cannot run|command not found|no such file or directory/i.test(lower)) {
    return 'VALIDATION_COMMAND_MISSING';
  }
  if (/permission denied|eacces|eperm/i.test(lower)) return 'PERMISSION';
  if (/timeout|timed out|elapsed/i.test(lower)) return 'TIMEOUT';
  if (/cannot find module|module not found|err_module_not_found/i.test(lower)) return 'PACKAGE_DEPENDENCY';
  if (/missing script|script .* not found|npm run .* missing/i.test(lower)) return 'PACKAGE_CONFIGURATION';
  if (/framework .* unavailable|test framework unavailable|no runnable test framework/i.test(lower)) return 'FRAMEWORK_UNAVAILABLE';
  if (/planner graph|task graph|execution state|coordinator state/i.test(lower)) return 'PLANNER_STATE';
  return null;
}

export function classifyExecutionFailure({
  failedTask = null,
  validationResult = null,
  plannerMetadata = null,
  workspaceMetadata = null,
  projectScan = null,
  failureText = ''
} = {}) {
  const analysis = analyzeValidationFailure(validationResult || {}, workspaceMetadata?.workspaceRoot || '');
  const combinedText = normalizeText([
    failureText,
    validationResult?.stderr,
    validationResult?.stdout,
    validationResult?.output,
    validationResult?.rawOutput,
    analysis.errorName,
    analysis.errorMessage
  ].filter(Boolean).join('\n'));
  const lower = combinedText.toLowerCase();

  let classification = classifyValidationCommandFailure(combinedText) || analysis.failureType || 'UNKNOWN';
  if (/coordinator corruption|batch state|currentfiles|validation source inconsistent/i.test(lower)) {
    classification = 'COORDINATOR_STATE';
  } else if (/planner corruption|planner graph corruption|missing task ids|unfinished task/i.test(lower)) {
    classification = 'PLANNER_STATE';
  } else if (/framework unavailable|no runnable test framework|vitest unavailable|jest unavailable|dotnet executable missing|php executable not found/i.test(lower)) {
    classification = 'FRAMEWORK_UNAVAILABLE';
  } else if (/missing dependency|cannot find module|module not found|err_module_not_found/i.test(lower)) {
    classification = 'PACKAGE_DEPENDENCY';
  } else if (/missing script|no build script|script .* not found/i.test(lower)) {
    classification = 'PACKAGE_CONFIGURATION';
  } else if (/validation command missing|command missing|no validation command/i.test(lower)) {
    classification = 'VALIDATION_COMMAND_MISSING';
  } else if (/syntaxerror/i.test(lower)) {
    classification = 'MODEL_SYNTAX';
  } else if (/\b(?:does not provide an export named|import\/export mismatch|requested module .* does not provide an export|named export not found)\b/i.test(lower)) {
    classification = 'MODEL_IMPORT_EXPORT';
  } else if (/referenceerror/i.test(lower)) {
    classification = 'MODEL_REFERENCE';
  } else if (/typeerror/i.test(lower)) {
    classification = 'MODEL_GENERATION';
  } else if (/expect\(\)|tobe\(|illegal import|illegal call|framework mismatch/i.test(lower)) {
    classification = 'FRAMEWORK_MISMATCH';
  } else if (/assertionerror/i.test(lower)) {
    classification = 'TEST_FAILURE';
  } else if (/build failed/i.test(lower)) {
    classification = 'BUILD_FAILURE';
  } else if (/npm test|node --test|vitest|jest/i.test(lower) && /failed|exit code|non-zero/i.test(lower)) {
    classification = 'TEST_FAILURE';
  }

  const projectType = String(projectScan?.projectType || workspaceMetadata?.projectType || '').toLowerCase();
  const isWriteTask = String(failedTask?.tool || '').toUpperCase() === 'WRITE_FILE' || String(failedTask?.kind || '').toUpperCase() === 'RECOVERY';
  if (!classification || classification === 'UNKNOWN') {
    classification = isWriteTask ? 'MODEL_GENERATION' : 'UNKNOWN';
  }

  const result = {
    classification,
    failureType: analysis.failureType || null,
    confidence: analysis.confidence || 'low',
    analysis,
    failedTool: failedTask?.tool || null,
    taskKind: failedTask?.kind || null,
    projectType,
    text: combinedText
  };

  logStrategy('FAILURE_CLASSIFIED', {
    classification: result.classification,
    failureType: result.failureType,
    confidence: result.confidence,
    failedTool: result.failedTool,
    taskKind: result.taskKind
  });

  return result;
}
