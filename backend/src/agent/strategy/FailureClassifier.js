import { analyzeValidationFailure } from '../planner/recoveryPlanner.js';
import { logStrategy } from './StrategyLogger.js';

const PLANNER_CLASSIFICATIONS = Object.freeze({
  PLANNING_ERROR: 'PLANNING_ERROR',
  INVALID_PREREQUISITE: 'INVALID_PREREQUISITE',
  PATH_RESOLUTION_ERROR: 'PATH_RESOLUTION_ERROR',
  WORKSPACE_DISCOVERY_ERROR: 'WORKSPACE_DISCOVERY_ERROR',
  INVALID_BOOTSTRAP_ASSUMPTION: 'INVALID_BOOTSTRAP_ASSUMPTION',
  USER_REQUESTED_MISSING_FILE: 'USER_REQUESTED_MISSING_FILE',
  MISSING_OPTIONAL_PREREQUISITE: 'MISSING_OPTIONAL_PREREQUISITE'
});

function normalizeText(value = '') {
  return String(value || '').replace(/\r/g, '\n').trim();
}

function hasENOENT(text = '') {
  return /enoent|no such file or directory|enotdir|eexist|does not exist|cannot find .*file|not found/i.test(String(text || ''));
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

function classifyFailureOrigin({
  failedTask = null,
  combinedText = '',
  workspaceState = null,
  plannerMetadata = null
} = {}) {
  const tool = String(failedTask?.tool || '').toUpperCase();
  const toolPath = failedTask?.toolArgs?.path || '';
  const taskSource = failedTask?.source || plannerMetadata?.taskSource || null;

  const baseResult = {
    classification: null,
    owner: 'PLANNER',
    recoverable: false,
    replanRecommended: false,
    failedTask: failedTask?.id || null,
    failedPath: toolPath,
    assumptionSource: taskSource,
    evidence: null
  };

  if (tool !== 'READ_FILE' || !hasENOENT(combinedText) || !toolPath) {
    return null;
  }

  const existingFiles = new Set(
    (workspaceState?.existingFiles || []).map(f => f.replace(/\\/g, '/').toLowerCase())
  );
  const normalizedPath = toolPath.replace(/\\/g, '/').toLowerCase();
  const fileExists = existingFiles.has(normalizedPath);

  if (fileExists) {
    return {
      ...baseResult,
      classification: PLANNER_CLASSIFICATIONS.PATH_RESOLUTION_ERROR,
      owner: 'PLANNER',
      recoverable: true,
      replanRecommended: true,
      evidence: 'File exists in workspace but READ_FILE failed — path resolution issue'
    };
  }

  if (taskSource === 'classifier') {
    const classifierRequested = (plannerMetadata?.classifierRequestedFiles || []).some(
      f => f.replace(/\\/g, '/').toLowerCase() === normalizedPath
    );
    if (classifierRequested) {
      return {
        ...baseResult,
        classification: PLANNER_CLASSIFICATIONS.USER_REQUESTED_MISSING_FILE,
        owner: 'USER',
        recoverable: false,
        replanRecommended: false,
        evidence: 'User explicitly requested file not found in workspace'
      };
    }
    return {
      ...baseResult,
      classification: PLANNER_CLASSIFICATIONS.INVALID_PREREQUISITE,
      owner: 'PLANNER',
      recoverable: true,
      replanRecommended: true,
      assumptionSource: taskSource,
      evidence: 'Classifier assumption file not found in workspace'
    };
  }

  if (taskSource === null) {
    const classifierRequested = (plannerMetadata?.classifierRequestedFiles || []).some(
      f => f.replace(/\\/g, '/').toLowerCase() === normalizedPath
    );
    if (classifierRequested) {
      return {
        ...baseResult,
        classification: PLANNER_CLASSIFICATIONS.USER_REQUESTED_MISSING_FILE,
        owner: 'USER',
        recoverable: false,
        replanRecommended: false,
        evidence: 'User explicitly requested file not found in workspace'
      };
    }
  }

  if (taskSource && taskSource.startsWith('bootstrap:')) {
    return {
      ...baseResult,
      classification: PLANNER_CLASSIFICATIONS.INVALID_BOOTSTRAP_ASSUMPTION,
      owner: 'PLANNER',
      recoverable: true,
      replanRecommended: true,
      assumptionSource: taskSource,
      evidence: 'Bootstrap profile assumption file not found in workspace'
    };
  }

  if (taskSource && taskSource.startsWith('project_type:')) {
    return {
      ...baseResult,
      classification: PLANNER_CLASSIFICATIONS.INVALID_PREREQUISITE,
      owner: 'PLANNER',
      recoverable: true,
      replanRecommended: true,
      assumptionSource: taskSource,
      evidence: 'Project type assumption file not found in workspace'
    };
  }

  if (taskSource) {
    return {
      ...baseResult,
      classification: PLANNER_CLASSIFICATIONS.INVALID_PREREQUISITE,
      owner: 'PLANNER',
      recoverable: true,
      replanRecommended: true,
      assumptionSource: taskSource,
      evidence: 'Planner-generated prerequisite file not found in workspace'
    };
  }

  return {
    ...baseResult,
    classification: PLANNER_CLASSIFICATIONS.PLANNING_ERROR,
    owner: 'PLANNER',
    recoverable: true,
    replanRecommended: true,
    evidence: 'Planning error — file not found in workspace'
  };
}

function classifyModelResponseFailure(text = '') {
  const lower = normalizeText(text).toLowerCase();
  if (!lower) return null;
  if (lower.includes('model_format_error')) return 'MODEL_FORMAT_ERROR';
  if (lower.includes('model_schema_error')) return 'MODEL_SCHEMA_ERROR';
  if (lower.includes('model_partial_output')) return 'MODEL_PARTIAL_OUTPUT';
  if (lower.includes('model_protocol_error')) return 'MODEL_PROTOCOL_ERROR';
  if (/partial output|truncated output|incomplete output/.test(lower)) return 'MODEL_PARTIAL_OUTPUT';
  if (/schema.*error|schema mismatch|unexpected schema/.test(lower)) return 'MODEL_SCHEMA_ERROR';
  if (/protocol.*error|protocol mismatch|invalid response shape/.test(lower)) return 'MODEL_PROTOCOL_ERROR';
  if (/json parse|invalid json|parse error|markdown json/.test(lower)) return 'MODEL_FORMAT_ERROR';
  return null;
}

export function classifyExecutionFailure({
  failedTask = null,
  validationResult = null,
  plannerMetadata = null,
  workspaceMetadata = null,
  projectScan = null,
  workspaceState = null,
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

  let classification = classifyModelResponseFailure(combinedText) || classifyValidationCommandFailure(combinedText) || analysis.failureType || 'UNKNOWN';
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

  if (hasENOENT(combinedText) && failedTask?.tool?.toUpperCase() === 'READ_FILE') {
    const origin = classifyFailureOrigin({ failedTask, combinedText, workspaceState, plannerMetadata });
    if (origin) {
      logStrategy('FAILURE_ASSUMPTION_SOURCE', origin);
      classification = origin.classification;
      const result = {
        classification,
        failureType: analysis.failureType || null,
        confidence: 'high',
        analysis,
        failedTool: failedTask?.tool || null,
        taskKind: failedTask?.kind || null,
        projectType: String(projectScan?.projectType || workspaceMetadata?.projectType || '').toLowerCase(),
        text: combinedText,
        origin,
        recoverable: origin.recoverable,
        replanRecommended: origin.replanRecommended,
        failedPath: origin.failedPath,
        assumptionSource: origin.assumptionSource
      };
      logStrategy('FAILURE_CLASSIFIED', {
        classification: result.classification,
        failureType: result.failureType,
        confidence: result.confidence,
        failedTool: result.failedTool,
        taskKind: result.taskKind,
        origin: result.origin?.classification
      });
      return result;
    }
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
    text: combinedText,
    origin: null,
    recoverable: false,
    replanRecommended: false,
    failedPath: failedTask?.toolArgs?.path || null,
    assumptionSource: null
  };

  logStrategy('FAILURE_CLASSIFIED', {
    classification: result.classification,
    failureType: result.failureType,
    confidence: result.confidence,
    failedTool: result.failedTool,
    taskKind: result.taskKind
  });

  if (hasENOENT(combinedText)) {
    logStrategy('FAILURE_ASSUMPTION_SOURCE', { classification: result.classification, failedTool: result.failedTool, note: 'ENOENT detected but could not determine origin' });
  }

  return result;
}
