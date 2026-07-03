function normalize(value = '') {
  return String(value || '').trim();
}

function normalizeUpper(value = '') {
  return normalize(value).toUpperCase();
}

export function createTaskIntent(input = {}) {
  const taskMode = normalizeUpper(input.taskMode || input.goalType || 'CODING');
  const goalType = normalizeUpper(input.goalType || taskMode || 'CODING');
  const executionMode = normalizeUpper(input.executionMode || (taskMode === 'READ_ONLY' ? 'READ_ONLY' : 'WRITE'));
  const bootstrapAllowed = input.bootstrapAllowed === true || taskMode !== 'READ_ONLY';
  const projectInitializationAllowed = input.projectInitializationAllowed === true || bootstrapAllowed;
  const intent = {
    taskMode,
    goalType,
    executionMode,
    writeAllowed: input.writeAllowed === true || taskMode !== 'READ_ONLY',
    readAllowed: input.readAllowed !== false,
    runAllowed: input.runAllowed === true || executionMode === 'WRITE_AND_RUN',
    validationAllowed: input.validationAllowed === true || taskMode !== 'READ_ONLY',
    bootstrapAllowed,
    projectInitializationAllowed,
    reasoning: normalize(input.reasoning || ''),
    confidence: Number.isFinite(Number(input.confidence)) ? Number(input.confidence) : 1,
    source: normalize(input.source || 'task_classifier')
  };
  console.log('[TASK_INTENT_CREATED]', {
    taskMode: intent.taskMode,
    goalType: intent.goalType,
    executionMode: intent.executionMode,
    source: intent.source
  });
  return intent;
}

export function freezeTaskIntent(taskIntent = {}) {
  const frozen = Object.freeze({
    ...taskIntent,
    metadata: Object.freeze({
      ...(taskIntent?.metadata && typeof taskIntent.metadata === 'object' ? taskIntent.metadata : {})
    })
  });
  console.log('[TASK_INTENT_FROZEN]', {
    taskMode: frozen.taskMode || null,
    goalType: frozen.goalType || null,
    executionMode: frozen.executionMode || null
  });
  return frozen;
}

export function consumeTaskIntent(stage, taskIntent = {}) {
  console.log('[TASK_INTENT_CONSUMED]', {
    stage: normalize(stage) || 'unknown',
    taskMode: taskIntent?.taskMode || null,
    goalType: taskIntent?.goalType || null,
    executionMode: taskIntent?.executionMode || null
  });
}

export function assertTaskIntentConsistency(taskIntent = {}, views = []) {
  const normalizedViews = (Array.isArray(views) ? views : []).filter(Boolean);
  let mismatch = null;
  for (const view of normalizedViews) {
    const stage = normalize(view.stage) || 'unknown';
    const taskMode = view.taskMode == null ? null : normalizeUpper(view.taskMode);
    const goalType = view.goalType == null ? null : normalizeUpper(view.goalType);
    const executionMode = view.executionMode == null ? null : normalizeUpper(view.executionMode);
    const expectedTaskMode = normalizeUpper(taskIntent?.taskMode);
    const expectedGoalType = normalizeUpper(taskIntent?.goalType);
    const expectedExecutionMode = normalizeUpper(taskIntent?.executionMode);
    const matched =
      (taskMode == null || taskMode === expectedTaskMode) &&
      (goalType == null || goalType === expectedGoalType) &&
      (executionMode == null || executionMode === expectedExecutionMode);
    if (matched) {
      console.log('[TASK_INTENT_MATCH]', {
        stage,
        taskMode: taskMode || expectedTaskMode || null,
        goalType: goalType || expectedGoalType || null,
        executionMode: executionMode || expectedExecutionMode || null
      });
      continue;
    }
    mismatch = {
      stage,
      taskMode,
      goalType,
      executionMode,
      expectedTaskMode,
      expectedGoalType,
      expectedExecutionMode
    };
    console.log('[TASK_INTENT_MISMATCH]', mismatch);
    break;
  }

  if (mismatch) {
    const error = new Error('Intent authority violation');
    error.code = 'INTENT_AUTHORITY_VIOLATION';
    error.details = mismatch;
    console.log('[INTENT_AUTHORITY_VIOLATION]', mismatch);
    throw error;
  }

  return true;
}
