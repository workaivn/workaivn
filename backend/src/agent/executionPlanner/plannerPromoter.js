import { Task } from '../planner/task.js';
import { TaskKind } from '../planner/plannerTypes.js';
import { EXECUTION_UNIT_TYPES } from './executionUnit.js';
import { approvePlannerAuthority } from './plannerAuthorityFirewall.js';

function toolForUnitType(type = '') {
  switch (String(type || '').toUpperCase()) {
    case EXECUTION_UNIT_TYPES.READ:
      return 'READ_FILE';
    case EXECUTION_UNIT_TYPES.ANALYZE:
      return null;
    case EXECUTION_UNIT_TYPES.WRITE:
      return 'WRITE_FILE';
    case EXECUTION_UNIT_TYPES.PATCH:
      return 'APPLY_PATCH';
    case EXECUTION_UNIT_TYPES.DELETE:
      return 'DELETE_FILE';
    case EXECUTION_UNIT_TYPES.MOVE:
    case EXECUTION_UNIT_TYPES.RENAME:
      return 'WRITE_FILE';
    case EXECUTION_UNIT_TYPES.RUN_TERMINAL:
    case EXECUTION_UNIT_TYPES.VALIDATE:
      return 'RUN_TERMINAL';
    case EXECUTION_UNIT_TYPES.VERIFY:
      return null;
    default:
      return null;
  }
}

function kindForUnitType(type = '') {
  switch (String(type || '').toUpperCase()) {
    case EXECUTION_UNIT_TYPES.READ:
    case EXECUTION_UNIT_TYPES.ANALYZE:
      return TaskKind.ANALYSIS;
    case EXECUTION_UNIT_TYPES.WRITE:
    case EXECUTION_UNIT_TYPES.PATCH:
    case EXECUTION_UNIT_TYPES.DELETE:
    case EXECUTION_UNIT_TYPES.MOVE:
    case EXECUTION_UNIT_TYPES.RENAME:
      return TaskKind.GENERATE_CONTENT;
    case EXECUTION_UNIT_TYPES.RUN_TERMINAL:
    case EXECUTION_UNIT_TYPES.VALIDATE:
      return TaskKind.REASONING;
    case EXECUTION_UNIT_TYPES.VERIFY:
      return TaskKind.REASONING;
    default:
      return TaskKind.REASONING;
  }
}

function buildTaskGoal(unit = {}) {
  const description = String(unit.description || '').trim();
  if (description) return description;
  return `Execute ${String(unit.type || 'UNIT').toUpperCase()}`;
}

export function promoteExecutionUnitToTask(unit = {}, context = {}) {
  if (unit?.recommendationOnly === true || unit?.metadata?.recommendationOnly === true || unit?.executable === false) {
    console.log('[RECOMMENDATION_SKIPPED_FOR_EXECUTION]', {
      unitId: unit.id || 'unknown',
      unitType: unit.type || 'unknown',
      reason: 'recommendation units must not be promoted to executable tasks'
    });
    return null;
  }
  const approval = approvePlannerAuthority(unit, context?.executionContract?.requiredContext || unit.executionContract?.requiredContext || {});
  if (!approval.valid) {
    console.log('[AUTHORITY_REJECTED]', {
      unitId: unit.id || 'unknown',
      unitType: unit.type || 'unknown',
      reason: approval.validation?.reason || 'firewall rejected unit'
    });
    return null;
  }
  const approvedUnit = approval.candidate;
  console.log('[AUTHORITY_APPROVED]', {
    unitId: approvedUnit.id || 'unknown',
    unitType: approvedUnit.type || 'unknown',
    source: approvedUnit.authoritySource || null
  });
  const tool = toolForUnitType(unit.type);
  if (!tool) {
    console.log("[NULL_TOOL_BLOCKED]", {
      unitId: unit.id || 'unknown',
      unitType: unit.type || 'unknown',
      action: "cannot promote — no tool mapped for this unit type"
    });
    return null;
  }
  console.log('[EXECUTION_UNIT_TO_TASKNODE]', {
    unitId: approvedUnit.id || null,
    unitType: approvedUnit.type || null,
    tool,
    requestedKind: approvedUnit.requestedKind || approvedUnit.metadata?.requestedKind || null
  });
  const task = new Task({
    id: approvedUnit.id,
    kind: kindForUnitType(approvedUnit.type),
    goal: buildTaskGoal(approvedUnit),
    dependencies: Array.isArray(approvedUnit.dependencies) ? [...approvedUnit.dependencies] : [],
    tool,
    toolArgs: tool === 'READ_FILE'
      ? { path: approvedUnit.targetFiles?.[0] || approvedUnit.requiredReads?.[0] || '' }
      : tool === 'WRITE_FILE'
        ? { path: approvedUnit.targetFiles?.[0] || approvedUnit.requiredWrites?.[0] || '', file: approvedUnit.targetFiles?.[0] || approvedUnit.requiredWrites?.[0] || '', content: approvedUnit.inputs?.content || '' }
        : tool === 'APPLY_PATCH'
          ? { file: approvedUnit.targetFiles?.[0] || '', path: approvedUnit.targetFiles?.[0] || '', find: approvedUnit.inputs?.find || '', replace: approvedUnit.inputs?.replace || '' }
          : tool === 'RUN_TERMINAL'
            ? { command: approvedUnit.inputs?.command || approvedUnit.outputs?.command || '' }
            : tool === 'LIST_FILES'
              ? { path: '.', limit: 500 }
              : {},
    priority: approvedUnit.type === EXECUTION_UNIT_TYPES.VALIDATE ? 90 : 50,
    source: 'execution-planner',
    plannerReason: approvedUnit.description || null,
    unitType: approvedUnit.type,
    description: approvedUnit.description || null,
    targetFiles: approvedUnit.targetFiles || [],
    requiredReads: approvedUnit.requiredReads || [],
    requiredWrites: approvedUnit.requiredWrites || [],
    inputs: approvedUnit.inputs || {},
    outputs: approvedUnit.outputs || {},
    acceptanceCriteria: approvedUnit.acceptanceCriteria || [],
    completionPredicate: approvedUnit.completionPredicate || null,
    retryPolicy: approvedUnit.retryPolicy || {},
    verificationPolicy: approvedUnit.verificationPolicy || {},
    executionContract: approvedUnit.executionContract || null,
    canonicalTargets: Array.isArray(approvedUnit.canonicalTargets) && approvedUnit.canonicalTargets.length > 0
      ? [...approvedUnit.canonicalTargets]
      : [
          ...(Array.isArray(approvedUnit.targetFiles) ? approvedUnit.targetFiles : []),
          ...(Array.isArray(approvedUnit.requiredReads) ? approvedUnit.requiredReads : []),
          ...(Array.isArray(approvedUnit.requiredWrites) ? approvedUnit.requiredWrites : [])
        ],
    authoritySource: approvedUnit.authoritySource || null,
    authorityState: approvedUnit.authorityState || 'approved',
    approvalId: approvedUnit.approvalId || null,
    approvedByFirewall: approvedUnit.approvedByFirewall === true,
    requestedKind: approvedUnit.requestedKind || approvedUnit.metadata?.requestedKind || null,
    verificationEvidence: {
      unitType: approvedUnit.type,
      targetFiles: approvedUnit.targetFiles || [],
      requiredReads: approvedUnit.requiredReads || [],
      requiredWrites: approvedUnit.requiredWrites || []
    }
  });
  console.log('[TASKNODE_CREATED]', {
    taskId: task.id,
    tool: task.tool,
    requestedKind: task.requestedKind || null,
    targetFiles: task.targetFiles || []
  });

  if (task.tool === 'WRITE_FILE' || task.tool === 'APPLY_PATCH') {
    console.log('[WRITE_CANDIDATE_PROMOTED]', {
      unitId: approvedUnit.id || null,
      path: approvedUnit.targetFiles?.[0] || null,
      tool: task.tool || null,
      source: approvedUnit.authoritySource || null,
      plannedNewFile: approvedUnit.metadata?.plannedNewFile === true
    });
  }

  return task;
}

export function promoteExecutionUnitsToTasks(units = [], context = {}) {
  const tasks = [];
  for (const unit of Array.isArray(units) ? units : []) {
    if (unit?.recommendationOnly === true || unit?.metadata?.recommendationOnly === true || unit?.executable === false) {
      console.log('[RECOMMENDATION_SKIPPED_FOR_EXECUTION]', {
        id: unit.id || null,
        type: unit.type || null,
        reason: 'recommendation units must not enter task promotion'
      });
      continue;
    }
    if (String(unit.type || '').toUpperCase() === EXECUTION_UNIT_TYPES.ANALYZE) {
      console.log('[ANALYZE_UNIT_INTERNAL]', {
        id: unit.id,
        description: unit.description || 'Analyze workspace evidence',
        action: 'skipped promotion — ANALYZE remains internal to ExecutionGraph'
      });
      continue;
    }
    if (String(unit.type || '').toUpperCase() === EXECUTION_UNIT_TYPES.VERIFY) {
      console.log('[VERIFY_UNIT_INTERNAL]', {
        id: unit.id,
        description: unit.description || 'Verify execution graph completion',
        action: 'skipped promotion — VERIFY remains internal to ExecutionGraph'
      });
      continue;
    }
    const executionContract = typeof context.createExecutionContract === 'function'
      ? context.createExecutionContract(unit)
      : (unit.executionContract || context.executionContract || null);
    const task = promoteExecutionUnitToTask({ ...unit, executionContract }, { ...context, executionContract });
    if (task.tool || task.kind) {
      tasks.push(task);
    }
  }
  console.log('[TASK_GRAPH_FINALIZING]', { taskCount: tasks.length });
  console.log('[TASK_GRAPH_FINALIZED]', { taskCount: tasks.length });
  return {
    tasks,
    units: Array.isArray(units) ? units : [],
    context
  };
}
