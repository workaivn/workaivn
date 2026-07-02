import { createExecutionGraph } from './executionGraph.js';
import { buildExecutionContract } from './executionContract.js';
import { decomposeGoalToExecutionUnits } from './goalDecomposer.js';
import { promoteExecutionUnitsToTasks } from './plannerPromoter.js';
import { scheduleExecutionUnits } from './executionScheduler.js';
import { approvePlannerAuthority } from './plannerAuthorityFirewall.js';

export function createExecutionPlanner({
  objective = '',
  verifiedPlanningContext = null,
  knowledgeGraph = null,
  canonicalFileUniverse = [],
  plannerPolicies = {},
  projectIntent = {},
  projectScan = {},
  explicitRequestedNewFiles = []
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
    plannedNewFiles
  });
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
  const graph = createExecutionGraph(approvedUnits);
  const validation = graph.validate();
  const executionContract = buildExecutionContract({
    unit: graph.readyUnits()[0] || graph.allUnits()[0] || null,
    verifiedPlanningContext,
    knowledgeGraph,
    canonicalFileUniverse,
    plannerPolicies
  });
  const promoted = promoteExecutionUnitsToTasks(graph.allUnits(), {
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
    plannerDerivedWrites: writeLikeUnits.filter(unit => unit.authoritySource === 'planner_derived').length,
    explicitWrites: writeLikeUnits.filter(unit => unit.authoritySource === 'explicit_user_request').length,
    workspaceWrites: writeLikeUnits.filter(unit => unit.authoritySource === 'workspace_derived' || unit.authoritySource === 'workspace_evidence').length
  });

  console.log('[EXECUTION_GRAPH_CREATED]', {
    graphId: graph.id,
    unitCount: graph.allUnits().length,
    readyCount: schedule.readyUnits.length
  });

  return {
    graph,
    units: graph.allUnits(),
    tasks: promoted.tasks,
    executionContract,
    schedule,
    validation,
    rejectedUnits,
    promoteExecutionUnitsToTasks: (context = {}) => promoteExecutionUnitsToTasks(graph.allUnits(), context)
  };
}
