import { createExecutionGraph } from './executionGraph.js';
import { buildExecutionContract } from './executionContract.js';
import { decomposeGoalToExecutionUnits } from './goalDecomposer.js';
import { promoteExecutionUnitsToTasks } from './plannerPromoter.js';
import { scheduleExecutionUnits } from './executionScheduler.js';
import { approvePlannerAuthority } from './plannerAuthorityFirewall.js';
import { assertExecutionGraphClean } from '../execution/ExecutionInputGuard.js';
import { normalizeAuthoritySource, AuthoritySource } from '../../planner/authority/AuthoritySource.js';
import { validateLegacyTargetLeak } from '../planning/taskModeFirewall.js';

export function createExecutionPlanner({
  objective = '',
  verifiedPlanningContext = null,
  knowledgeGraph = null,
  canonicalFileUniverse = [],
  plannerPolicies = {},
  projectIntent = {},
  projectScan = {},
  explicitRequestedNewFiles = [],
  artifactCandidateModelRequest = null,
  artifactCandidateModelResponse = null
} = {}) {
  const contextExplicitRequestedNewFiles = Array.isArray(verifiedPlanningContext?.explicitRequestedNewFiles)
    ? verifiedPlanningContext.explicitRequestedNewFiles
    : [];
  const planningExplicitRequestedNewFiles = [...new Set([
    ...contextExplicitRequestedNewFiles,
    ...(Array.isArray(explicitRequestedNewFiles) ? explicitRequestedNewFiles : [])
  ])];
  console.log('[EXECUTION_PLANNER_AUTHORITY]', {
    objective: String(objective || '').slice(0, 120),
    verifiedFileCount: Array.isArray(verifiedPlanningContext?.verifiedFiles) ? verifiedPlanningContext.verifiedFiles.length : 0,
    verifiedCommandCount: Array.isArray(verifiedPlanningContext?.verifiedCommands) ? verifiedPlanningContext.verifiedCommands.length : 0,
    requestedFileCount: Array.isArray(verifiedPlanningContext?.requestedFileDetails) ? verifiedPlanningContext.requestedFileDetails.length : 0,
    explicitRequestedNewFileCount: planningExplicitRequestedNewFiles.length
  });
  const requestedFileDetails = Array.isArray(verifiedPlanningContext?.requestedFileDetails)
    ? verifiedPlanningContext.requestedFileDetails
    : Array.isArray(verifiedPlanningContext?.facts?.requestedFileDetails)
      ? verifiedPlanningContext.facts.requestedFileDetails
      : [];
  const requestedFileKinds = Array.isArray(verifiedPlanningContext?.requestedFileKinds)
    ? verifiedPlanningContext.requestedFileKinds
    : Array.isArray(verifiedPlanningContext?.facts?.requestedFileKinds)
      ? verifiedPlanningContext.facts.requestedFileKinds
      : [];
  const plannedNewFiles = Array.isArray(verifiedPlanningContext?.plannedNewFiles)
    ? verifiedPlanningContext.plannedNewFiles
    : Array.isArray(verifiedPlanningContext?.facts?.plannedNewFiles)
      ? verifiedPlanningContext.facts.plannedNewFiles
      : [];
  const units = decomposeGoalToExecutionUnits({
    objective,
    verifiedPlanningContext,
    knowledgeGraph,
    canonicalFileUniverse,
    plannerPolicies,
    projectIntent,
    projectScan,
    explicitRequestedNewFiles: planningExplicitRequestedNewFiles,
    requestedFileDetails,
    requestedFileKinds,
    plannedNewFiles,
    artifactCandidateModelRequest,
    artifactCandidateModelResponse
  });
  const projectedExecutionGraph = units?.executionGraph || null;
  const projectedExecutionValidation = units?.executionValidation || null;
  const legacyTargetLeak = validateLegacyTargetLeak({
    executionUnits: units,
    plannerApprovedArtifacts: units,
    executionCandidates: units,
    stage: 'execution_planner',
    context: {
      verifiedPlanningContext,
      projectScan,
      projectIntent,
      plannerPolicies
    }
  });
  if (!legacyTargetLeak.valid) {
    console.log('[LEGACY_TARGET_LEAK_BLOCKED]', {
      stage: 'execution_planner',
      reason: legacyTargetLeak.reason,
      leaks: legacyTargetLeak.leaks
    });
    return {
      graph: createExecutionGraph([]),
      units: [],
      approvedUnits: [],
      tasks: [],
      executionContract: buildExecutionContract({
        unit: null,
        verifiedPlanningContext,
        knowledgeGraph,
        canonicalFileUniverse,
        plannerPolicies
      }),
      schedule: scheduleExecutionUnits(createExecutionGraph([])),
      validation: {
        valid: false,
        errors: [legacyTargetLeak.reason, ...legacyTargetLeak.leaks.map(leak => `${leak.path} (${leak.stage})`) ]
      },
      rejectedUnits: legacyTargetLeak.leaks.map(leak => ({
        unitId: null,
        reason: `${legacyTargetLeak.reason}: ${leak.path}`
      })),
      promoteExecutionUnitsToTasks: () => []
    };
  }
  const approvedUnits = [];
  const rejectedUnits = [];
  for (const unit of units) {
    const originalSource = unit.authoritySource || null;
    const approval = approvePlannerAuthority(unit, {
      verifiedPlanningContext,
      knowledgeGraph,
      canonicalFileUniverse,
      plannerPolicies,
      projectIntent,
      projectScan
    });
    const preservedSource = approval.valid ? (approval.candidate?.authoritySource || originalSource) : originalSource;
    if (originalSource && originalSource === preservedSource) {
      console.log('[AUTHORITY_SOURCE_PRESERVED]', {
        unitId: unit.id || null,
        source: originalSource
      });
      console.log('[AUTHORITY_SOURCE_UNCHANGED]', {
        unitId: unit.id || null,
        source: originalSource,
        note: 'Authority source unchanged through firewall approval'
      });
    }
    if (approval.valid) {
      if (originalSource === 'explicit_user_request' || unit.metadata?.explicitUserRequest === true) {
        console.log('[EXPLICIT_WRITE_APPROVED]', {
          unitId: unit.id || null,
          path: unit.targetFiles?.[0] || null,
          source: preservedSource
        });
      }
      approvedUnits.push(approval.candidate);
    } else {
      if (originalSource === 'explicit_user_request' || unit.metadata?.explicitUserRequest === true) {
        console.log('[EXPLICIT_WRITE_REJECTED]', {
          unitId: unit.id || null,
          path: unit.targetFiles?.[0] || null,
          reason: approval.validation?.reason || 'firewall rejected unit'
        });
      }
      rejectedUnits.push({ unitId: unit.id || null, reason: approval.validation?.reason || 'firewall rejected unit' });
    }
  }
  if (rejectedUnits.length > 0) {
    console.log('[EXECUTION_GRAPH_FIDELITY_FAIL]', {
      reason: 'Execution graph approval removed one or more projected nodes',
      rejectedCount: rejectedUnits.length,
      projectedCount: Array.isArray(units) ? units.length : 0,
      approvedCount: approvedUnits.length
    });
    return {
      graph: projectedExecutionGraph || createExecutionGraph([]),
      units: [],
      approvedUnits: [],
      tasks: [],
      executionContract: buildExecutionContract({
        unit: null,
        verifiedPlanningContext,
        knowledgeGraph,
        canonicalFileUniverse,
        plannerPolicies
      }),
      schedule: scheduleExecutionUnits(projectedExecutionGraph || createExecutionGraph([])),
      validation: {
        valid: false,
        errors: rejectedUnits.map(entry => entry.reason || 'execution graph approval rejected')
      },
      rejectedUnits,
      promoteExecutionUnitsToTasks: () => []
    };
  }

  const graph = projectedExecutionGraph || createExecutionGraph(approvedUnits);
  if (projectedExecutionGraph && Array.isArray(approvedUnits)) {
    const approvedById = new Map(approvedUnits.map(unit => [unit.id, unit]));
    for (const node of graph.allUnits()) {
      const approved = approvedById.get(node.id);
      if (!approved) continue;
      node.approvalId = approved.approvalId || node.approvalId || null;
      node.approvedByFirewall = approved.approvedByFirewall === true || node.approvedByFirewall === true;
      node.authoritySource = approved.authoritySource || node.authoritySource || null;
      node.authorityState = approved.authorityState || node.authorityState || 'approved';
      node.authority = approved.authority && typeof approved.authority === 'object' ? { ...approved.authority } : (node.authority || null);
      node.metadata = {
        ...(node.metadata && typeof node.metadata === 'object' ? node.metadata : {}),
        ...(approved.metadata && typeof approved.metadata === 'object' ? approved.metadata : {}),
        approvalId: node.approvalId,
        approvedByFirewall: node.approvedByFirewall,
        authoritySource: node.authoritySource,
        authorityState: node.authorityState
      };
    }
  }
  if (projectedExecutionValidation && projectedExecutionValidation.valid === false) {
    console.log('[EXECUTION_GRAPH_FIDELITY_FAIL]', {
      reason: 'Projected execution graph failed validation',
      errorCount: projectedExecutionValidation.errors.length
    });
    return {
      graph,
      units: [],
      approvedUnits: [],
      tasks: [],
      executionContract: buildExecutionContract({
        unit: null,
        verifiedPlanningContext,
        knowledgeGraph,
        canonicalFileUniverse,
        plannerPolicies
      }),
      schedule: scheduleExecutionUnits(graph),
      validation: projectedExecutionValidation,
      rejectedUnits,
      promoteExecutionUnitsToTasks: () => []
    };
  }
  assertExecutionGraphClean(graph);
  const validation = graph.validate();
  const executionContract = buildExecutionContract({
    unit: graph.readyUnits()[0] || graph.approvedUnits[0] || graph.allUnits()[0] || null,
    verifiedPlanningContext,
    knowledgeGraph,
    canonicalFileUniverse,
    plannerPolicies
  });
  const promoted = promoteExecutionUnitsToTasks(graph.approvedUnits, {
    executionContract,
    createExecutionContract: (unit) => buildExecutionContract({
      unit,
      verifiedPlanningContext,
      knowledgeGraph,
      canonicalFileUniverse,
      plannerPolicies
    })
  });
  const schedule = scheduleExecutionUnits(graph);
  const writeLikeUnits = graph.allUnits().filter(unit => ['WRITE', 'PATCH'].includes(String(unit.type || '').toUpperCase()));
  console.log('[EXECUTION_UNITS_CREATED]', {
    plannerDerivedWrites: writeLikeUnits.filter(unit => normalizeAuthoritySource(unit.authoritySource) === AuthoritySource.MODEL_SUGGESTION).length,
    explicitWrites: writeLikeUnits.filter(unit => normalizeAuthoritySource(unit.authoritySource) === AuthoritySource.WORKSPACE_AUTHORITY).length,
    workspaceWrites: writeLikeUnits.filter(unit => normalizeAuthoritySource(unit.authoritySource) === AuthoritySource.WORKSPACE_AUTHORITY).length
  });

  console.log('[EXECUTION_GRAPH_CREATED]', {
    graphId: graph.id,
    unitCount: graph.allUnits().length,
    readyCount: schedule.readyUnits.length
  });
  console.log('[EXECUTION_GRAPH_GENERATED]', {
    graphId: graph.id,
    unitCount: graph.allUnits().length,
    levelCount: Array.isArray(schedule.levels) ? schedule.levels.length : 0
  });
  console.log('[EXECUTION_GRAPH_READY]', {
    graphId: graph.id,
    readyCount: schedule.readyUnits.length
  });

  return {
    graph,
    units: graph.approvedUnits,
    approvedUnits: graph.approvedUnits,
    tasks: promoted.tasks,
    executionContract,
    schedule,
    validation,
    rejectedUnits,
    promoteExecutionUnitsToTasks: (context = {}) => promoteExecutionUnitsToTasks(graph.approvedUnits, context)
  };
}
