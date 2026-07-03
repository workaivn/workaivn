import crypto from 'node:crypto';

import { createExecutionUnit, EXECUTION_UNIT_TYPES } from '../executionPlanner/executionUnit.js';
import { createExecutionGraph } from '../executionPlanner/executionGraph.js';
import { unique } from '../projectIntelligence/inference.js';
import { EXECUTABLE_INTENT_TYPES } from './executionIntentGraph.js';
import { projectExecutionGraph } from './executionProjection.js';

function normalizePath(value = '') {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .trim();
}

function toLower(value = '') {
  return String(value || '').toLowerCase();
}

function uniqueLower(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean).map(value => value.toLowerCase()))];
}

function removeRedundantEdgesFromMap(dependencyMap = new Map()) {
  const direct = new Map();
  for (const [id, deps] of dependencyMap.entries()) {
    direct.set(id, new Set(unique(deps)));
  }

  const reachable = (from, target, seen = new Set()) => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    for (const dep of direct.get(from) || []) {
      if (dep === target || reachable(dep, target, seen)) return true;
    }
    return false;
  };

  for (const [id, deps] of direct.entries()) {
    for (const dep of [...deps]) {
      for (const other of deps) {
        if (dep === other) continue;
        if (reachable(dep, other)) {
          deps.delete(other);
        }
      }
    }
    dependencyMap.set(id, [...deps]);
  }
  return dependencyMap;
}

export function detectCycles(nodes = []) {
  const byId = new Map((Array.isArray(nodes) ? nodes : []).map(node => [node.id, node]));
  const cycles = [];
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  const walk = (id) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const cycleStart = stack.indexOf(id);
      cycles.push(cycleStart >= 0 ? stack.slice(cycleStart).concat(id) : [...stack, id]);
      return;
    }
    visiting.add(id);
    stack.push(id);
    const node = byId.get(id);
    for (const dep of Array.isArray(node?.dependencies) ? node.dependencies : []) {
      if (byId.has(dep)) walk(dep);
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  };

  for (const id of byId.keys()) walk(id);
  return cycles;
}

export function verifyDependencyIntegrity(nodes = []) {
  const list = Array.isArray(nodes) ? nodes : [];
  const ids = new Set(list.map(node => node.id));
  const errors = [];

  for (const node of list) {
    for (const dep of unique(node.dependencies || [])) {
      if (!ids.has(dep)) {
        errors.push(`Missing dependency "${dep}" for "${node.id}"`);
      }
    }
  }

  const cycles = detectCycles(list);
  for (const cycle of cycles) {
    errors.push(`Dependency cycle detected: ${cycle.join(' -> ')}`);
  }

  return { valid: errors.length === 0, errors, cycles };
}

export function calculateExecutionLevels(nodes = []) {
  const list = Array.isArray(nodes) ? nodes : [];
  const byId = new Map(list.map(node => [node.id, node]));
  const memo = new Map();
  const visiting = new Set();

  const levelOf = (id) => {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const node = byId.get(id);
    const deps = unique(node?.dependencies || []).filter(dep => byId.has(dep));
    const level = deps.length === 0 ? 0 : 1 + Math.max(...deps.map(dep => levelOf(dep)));
    visiting.delete(id);
    memo.set(id, level);
    return level;
  };

  for (const id of byId.keys()) levelOf(id);
  const levels = [];
  for (const node of list) {
    const level = memo.get(node.id) || 0;
    if (!levels[level]) levels[level] = [];
    levels[level].push(node);
  }
  return levels.filter(Boolean).map(group => group.sort((left, right) => (right.confidence || 0) - (left.confidence || 0) || String(left.id).localeCompare(String(right.id))));
}

function inferIntentFromUnit(unit = {}) {
  const type = String(unit.type || '').toUpperCase();
  const target = normalizePath(unit.targetFiles?.[0] || unit.requiredReads?.[0] || unit.requiredWrites?.[0] || '');
  const command = String(unit.inputs?.command || unit.outputs?.command || unit.toolArgs?.command || '').toLowerCase();

  if (type === EXECUTION_UNIT_TYPES.READ) {
    if (/package\.json$/.test(target)) return 'PACKAGE_DISCOVERY';
    if (/composer\.json$/.test(target)) return 'DISCOVER_BLADE';
    if (/app\/page\.(?:ts|tsx|js|jsx)$/.test(target) || /src\/app\.(?:ts|tsx|js|jsx)$/.test(target)) return 'ENTRY_DISCOVERY';
    return 'READ_CONTEXT';
  }

  if (type === EXECUTION_UNIT_TYPES.PATCH) return 'PATCH_SOURCE';
  if (type === EXECUTION_UNIT_TYPES.WRITE) {
    if (/\.test\.(?:ts|tsx|js|jsx)$|\.spec\.(?:ts|tsx|js|jsx)$/.test(target)) return 'GENERATE_TEST';
    if (/\.(?:css|scss|sass|less)$/.test(target)) return 'GENERATE_STYLE';
    if (/\.(?:png|jpg|jpeg|gif|webp|svg|ico)$/.test(target)) {
      if (/icon|favicon/.test(target)) return 'GENERATE_ICON';
      return 'GENERATE_IMAGE';
    }
    if (/\.blade\.php$/.test(target)) return 'GENERATE_VIEW';
    if (/controller/.test(target)) return 'GENERATE_CONTROLLER';
    if (/html?$/.test(target)) return 'GENERATE_HTML';
    return 'GENERATE_SOURCE';
  }

  if (type === EXECUTION_UNIT_TYPES.RUN_TERMINAL || type === EXECUTION_UNIT_TYPES.VALIDATE) {
    if (/\btest\b/.test(command)) return 'RUN_TEST';
    if (/\bbuild\b/.test(command)) return 'RUN_BUILD';
    if (/\blint\b/.test(command)) return 'RUN_LINT';
    return 'RUN_VALIDATION';
  }

  if (type === EXECUTION_UNIT_TYPES.VERIFY) return 'VERIFY_RESULT';
  return 'COLLECT_EVIDENCE';
}

function inferIntentPath(unit = {}, context = {}) {
  const target = normalizePath(unit.targetFiles?.[0] || unit.requiredReads?.[0] || unit.requiredWrites?.[0] || '');
  const projectType = String(context?.projectScanSnapshot?.projectType || context?.projectIntent?.requestedFramework || '').toLowerCase();
  if (target) return target;
  if (/next/.test(projectType)) return 'app/page.tsx';
  if (/laravel/.test(projectType)) return 'resources/views/welcome.blade.php';
  if (/php/.test(projectType)) return 'index.php';
  if (/flutter/.test(projectType)) return 'lib/main.dart';
  return null;
}

function buildExecutionUnitFromIntent({ intentNode, dependencyIds = [], context = {}, unitHint = null } = {}) {
  const intent = String(intentNode?.intent || '').toUpperCase();
  const path = inferIntentPath(unitHint || {}, context);
  const confidence = Number.isFinite(Number(intentNode?.confidence)) ? Number(intentNode.confidence) : 0.5;
  const requestedKind = unitHint?.requestedKind || unitHint?.metadata?.requestedKind || null;
  const authoritySource = unitHint?.authoritySource || unitHint?.metadata?.authoritySource || (requestedKind === 'EXPLICIT_CREATE' ? 'explicit_user_request' : (intent.startsWith('RUN_') || intent === 'VERIFY_RESULT' || intent === 'QUALITY_GATE' || intent === 'FINALIZE' ? 'verified_planning_context' : 'objective_authority'));
  const authorityState = unitHint?.authorityState || unitHint?.metadata?.authorityState || 'candidate';
  const explicitUserRequest = unitHint?.authority?.source === 'explicit_user_request' ||
    unitHint?.metadata?.explicitUserRequest === true ||
    unitHint?.metadata?.requestedFile === true ||
    requestedKind === 'EXPLICIT_CREATE';
  const authority = explicitUserRequest ? { source: 'explicit_user_request' } : (unitHint?.authority && typeof unitHint.authority === 'object' ? { ...unitHint.authority } : null);

  if (!EXECUTABLE_INTENT_TYPES.has(intent)) return null;

  if (intent.startsWith('RUN_')) {
    const command = Array.isArray(context?.verifiedCommands) && context.verifiedCommands.length > 0
      ? context.verifiedCommands[0]
      : (context?.projectScanSnapshot?.testCommands?.[0] || context?.projectScanSnapshot?.buildCommands?.[0] || context?.projectScanSnapshot?.runCommands?.[0] || '');
    if (!command) return null;
    return createExecutionUnit({
      id: unitHint?.id || `run:${crypto.randomUUID()}`,
      type: EXECUTION_UNIT_TYPES.RUN_TERMINAL,
      description: intentNode?.purpose || `Run ${command}`,
      targetFiles: [],
      requiredReads: [],
      requiredWrites: [],
      dependencies: unique(dependencyIds),
      inputs: { command, intent },
      outputs: { command },
      acceptanceCriteria: [intentNode?.purpose || `Command succeeds: ${command}`],
      retryPolicy: { maxAttempts: 2, mode: 'validation' },
      verificationPolicy: { requiresTerminal: true, command },
      metadata: { intent, confidence, source: 'dependency-resolver' },
      authority,
      authoritySource,
      authorityState
    });
  }

  if (intent === 'VERIFY_RESULT' || intent === 'QUALITY_GATE' || intent === 'FINALIZE') {
    return createExecutionUnit({
      id: unitHint?.id || `verify:${crypto.randomUUID()}`,
      type: EXECUTION_UNIT_TYPES.VERIFY,
      description: intentNode?.purpose || 'Verify execution result',
      targetFiles: [],
      requiredReads: [],
      requiredWrites: [],
      dependencies: unique(dependencyIds),
      inputs: { intent },
      outputs: { verified: true },
      acceptanceCriteria: [intentNode?.purpose || 'Execution result verified'],
      retryPolicy: { maxAttempts: 1, mode: 'verify' },
      verificationPolicy: { requiresTerminal: false, requiresWrites: false },
      metadata: { intent, confidence, source: 'dependency-resolver' },
      authority,
      authoritySource,
      authorityState
    });
  }

  const isPatch = intent === 'PATCH_SOURCE';
  const unitType = isPatch ? EXECUTION_UNIT_TYPES.PATCH : EXECUTION_UNIT_TYPES.WRITE;
  const targetPath = path || normalizePath(intentNode?.outputs?.path || intentNode?.inputs?.path || '');
  if (!targetPath && !isPatch) return null;
  if (!targetPath && isPatch) return null;

  return createExecutionUnit({
    id: unitHint?.id || `${unitType.toLowerCase()}:${targetPath || crypto.randomUUID()}`,
    type: unitType,
    description: intentNode?.purpose || `${unitType === EXECUTION_UNIT_TYPES.PATCH ? 'Patch' : 'Write'} ${targetPath}`,
    targetFiles: [targetPath],
    requiredReads: unitType === EXECUTION_UNIT_TYPES.PATCH ? [targetPath] : [],
    requiredWrites: [targetPath],
    dependencies: unique(dependencyIds),
    inputs: { intent, path: targetPath },
    outputs: { file: targetPath },
    acceptanceCriteria: [intentNode?.purpose || `${targetPath} is produced`],
    retryPolicy: { maxAttempts: 2, mode: 'write' },
    verificationPolicy: { requiresReads: unitType === EXECUTION_UNIT_TYPES.PATCH, requiresWrites: true },
    metadata: {
      intent,
      confidence,
      source: 'dependency-resolver',
      explicitUserRequest,
      requestedFile: explicitUserRequest
    },
    authority,
    authoritySource,
    authorityState,
    requestedKind: requestedKind || (intent === 'GENERATE_TEST' || intent === 'GENERATE_SOURCE' || intent === 'GENERATE_STYLE' || intent === 'GENERATE_ASSET' ? 'EXPLICIT_CREATE' : null)
  });
}

function buildDiscoveryUnit({ intentNode, dependencyIds = [], context = {}, unitHint = null, readPath = '' } = {}) {
  const intent = String(intentNode?.intent || '').toUpperCase();
  const confidence = Number.isFinite(Number(intentNode?.confidence)) ? Number(intentNode.confidence) : 0.5;
  const authoritySource = unitHint?.authoritySource || unitHint?.metadata?.authoritySource || 'verified_planning_context';
  const authorityState = unitHint?.authorityState || unitHint?.metadata?.authorityState || 'candidate';
  const targetPath = normalizePath(readPath || intentNode?.outputs?.path || intentNode?.inputs?.path || '');
  if (!targetPath) return null;
  return createExecutionUnit({
    id: unitHint?.id || intentNode?.id || `read:${targetPath}`,
    type: EXECUTION_UNIT_TYPES.READ,
    description: intentNode?.purpose || `Read ${targetPath}`,
    targetFiles: [targetPath],
    requiredReads: [targetPath],
    requiredWrites: [],
    dependencies: unique(dependencyIds),
    inputs: { intent, path: targetPath },
    outputs: { file: targetPath },
    acceptanceCriteria: [intentNode?.purpose || `${targetPath} is read`],
    retryPolicy: { maxAttempts: 1, mode: 'read_only' },
    verificationPolicy: { requiresReads: true, requiresWrites: false },
    metadata: { intent, confidence, source: 'dependency-resolver' },
    authority: unitHint?.authority && typeof unitHint.authority === 'object' ? { ...unitHint.authority } : null,
    authoritySource,
    authorityState,
    requestedKind: unitHint?.requestedKind || unitHint?.metadata?.requestedKind || null
  });
}

function discoverReadPath(unit = {}, context = {}) {
  const projectType = String(context?.projectScanSnapshot?.projectType || '').toLowerCase();
  const packageJsonFound = context?.projectScanSnapshot?.packageJsonFound === true;
  const packageJsonPath = normalizePath(context?.projectScanSnapshot?.packageJsonPath || 'package.json');
  const entryFiles = unique(context?.projectScanSnapshot?.entryFiles || []);
  if (packageJsonFound) return packageJsonPath;
  if (projectType === 'laravel') return 'composer.json';
  if (entryFiles.length > 0) return entryFiles[0];
  if (/react|vite|next|node/.test(projectType)) return packageJsonPath;
  return null;
}

function findCandidateForIntentNode(intentNode = {}, executionCandidates = [], context = {}) {
  const intent = String(intentNode?.intent || '').toUpperCase();
  const targetPath = normalizePath(intentNode?.outputs?.path || intentNode?.inputs?.path || '');
  const lowerTarget = targetPath.toLowerCase();
  const candidates = Array.isArray(executionCandidates) ? executionCandidates : [];
  const matching = candidates.filter(candidate => {
    const candidateIntent = inferIntentFromUnit(candidate);
    if (candidateIntent !== intent) return false;
    const candidateTarget = normalizePath(candidate?.targetFiles?.[0] || candidate?.requiredWrites?.[0] || candidate?.requiredReads?.[0] || '');
    if (!lowerTarget) return true;
    return candidateTarget.toLowerCase() === lowerTarget;
  });
  if (matching.length > 0) return matching[0];

  if (intent === 'READ_CONTEXT' || intent === 'PACKAGE_DISCOVERY' || intent === 'ENTRY_DISCOVERY') {
    const readPath = intent === 'ENTRY_DISCOVERY'
      ? unique(context?.projectScanSnapshot?.entryFiles || [])[0] || discoverReadPath(intentNode, context)
      : discoverReadPath(intentNode, context);
    if (!readPath) return null;
    const readLower = readPath.toLowerCase();
    const readMatch = candidates.find(candidate => {
      if (inferIntentFromUnit(candidate) !== 'READ_CONTEXT' && inferIntentFromUnit(candidate) !== 'PACKAGE_DISCOVERY' && inferIntentFromUnit(candidate) !== 'ENTRY_DISCOVERY') return false;
      const candidateTarget = normalizePath(candidate?.targetFiles?.[0] || candidate?.requiredReads?.[0] || '');
      return candidateTarget.toLowerCase() === readLower;
    });
    return readMatch || null;
  }

  return candidates.find(candidate => inferIntentFromUnit(candidate) === intent) || null;
}

function createExecutionUnitsFromIntentGraph(intentGraph = {}, context = {}, executionCandidates = []) {
  const nodeById = new Map((Array.isArray(intentGraph?.nodes) ? intentGraph.nodes : []).map(node => [node.id, node]));
  const units = [];
  const readPathsUsed = new Set();
  const dependencyMemo = new Map();
  const unitByNodeId = new Map();

  const resolveNodeUnitIds = (intentId) => {
    if (dependencyMemo.has(intentId)) return dependencyMemo.get(intentId);
    const node = nodeById.get(intentId);
    if (!node) {
      dependencyMemo.set(intentId, []);
      return [];
    }

    const upstreamUnitIds = new Set();
    for (const depId of unique(node.dependencies || [])) {
      for (const depUnitId of resolveNodeUnitIds(depId)) {
        upstreamUnitIds.add(depUnitId);
      }
    }
    const dependencyIds = [...upstreamUnitIds];

    let producedUnitIds = [];
    const intent = String(node.intent || '').toUpperCase();

    if (intent === 'READ_CONTEXT' || intent === 'PACKAGE_DISCOVERY' || intent === 'ENTRY_DISCOVERY') {
      const readPath = intent === 'ENTRY_DISCOVERY'
        ? unique(context?.projectScanSnapshot?.entryFiles || [])[0] || discoverReadPath(node, context)
        : discoverReadPath(node, context);
      if (readPath) {
        const lower = readPath.toLowerCase();
        let unit = unitByNodeId.get(intentId) || null;
        if (!unit && !readPathsUsed.has(lower)) {
          readPathsUsed.add(lower);
          const candidate = findCandidateForIntentNode(node, executionCandidates, context);
          unit = buildDiscoveryUnit({
            intentNode: node,
            dependencyIds,
            context,
            unitHint: candidate ? { ...candidate, id: intentId } : { id: intentId, targetFiles: [readPath] },
            readPath
          });
          if (unit) {
            unit.id = intentId;
            unit.intent = intent;
            unit.metadata = { ...(unit.metadata || {}), intent, intentNodeId: intentId, source: 'dependency-resolver' };
            unit.dependencies = unique(dependencyIds);
            unit.executionEligible = true;
            units.push(unit);
            unitByNodeId.set(intentId, unit);
          }
        }
        if (unit) producedUnitIds = [unit.id];
      }
    } else if (EXECUTABLE_INTENT_TYPES.has(intent)) {
      let unit = unitByNodeId.get(intentId) || null;
      if (!unit) {
        const candidate = findCandidateForIntentNode(node, executionCandidates, context);
        unit = buildExecutionUnitFromIntent({
          intentNode: node,
          dependencyIds,
          context,
          unitHint: candidate ? { ...candidate, id: intentId } : { id: intentId, targetFiles: [node.outputs?.path || node.inputs?.path || ''] }
        });
        if (unit) {
          unit.id = intentId;
          unit.intent = intent;
          unit.metadata = { ...(unit.metadata || {}), intent, intentNodeId: intentId, source: 'dependency-resolver' };
          unit.dependencies = unique(dependencyIds);
          unit.executionEligible = true;
          units.push(unit);
          unitByNodeId.set(intentId, unit);
        }
      }
      if (unit) producedUnitIds = [unit.id];
    } else {
      producedUnitIds = dependencyIds;
    }

    const result = unique(producedUnitIds);
    dependencyMemo.set(intentId, result);
    return result;
  };

  for (const node of Array.isArray(intentGraph?.nodes) ? intentGraph.nodes : []) {
    resolveNodeUnitIds(node.id);
  }

  const deduped = [];
  const seen = new Set();
  for (const unit of units) {
    const key = `${String(unit.type || '').toUpperCase()}|${String(unit.intent || unit.metadata?.intent || '').toUpperCase()}|${uniqueLower(unit.targetFiles || []).join(',')}|${uniqueLower(unit.dependencies || []).join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(unit);
  }
  return deduped;
}

export function removeRedundantEdges(edges = []) {
  const dependencyMap = new Map();
  for (const edge of Array.isArray(edges) ? edges : []) {
    if (!edge?.to) continue;
    if (!dependencyMap.has(edge.to)) dependencyMap.set(edge.to, []);
    dependencyMap.get(edge.to).push(edge.from);
  }
  removeRedundantEdgesFromMap(dependencyMap);
  const output = [];
  for (const [to, deps] of dependencyMap.entries()) {
    for (const from of deps) {
      output.push({ from, to, relation: 'depends_on' });
    }
  }
  return output;
}

export function resolveExecutionDependencies(intentGraph = {}, {
  executionCandidates = [],
  planningContext = {},
  projectScanSnapshot = {},
  projectIntent = {},
  verifiedCommands = [],
  objective = ''
} = {}) {
  console.log('[DEPENDENCY_RESOLUTION_START]', {
    intentNodeCount: Array.isArray(intentGraph?.nodes) ? intentGraph.nodes.length : 0,
    candidateCount: Array.isArray(executionCandidates) ? executionCandidates.length : 0
  });

  const projected = projectExecutionGraph(intentGraph, {
    planningContext,
    projectScanSnapshot,
    projectIntent,
    verifiedCommands,
    objective,
    executionCandidates
  });

  const fidelityValidation = projected.validation || { valid: true, errors: [] };
  if (!fidelityValidation.valid) {
    console.log('[DEPENDENCY_GRAPH_COMPLETE]', {
      valid: false,
      errorCount: fidelityValidation.errors.length
    });
    return {
      executionUnits: [],
      levels: [],
      parallelGroups: [],
      executionGraph: createExecutionGraph([]),
      validation: fidelityValidation
    };
  }

  const executionUnits = projected.executionUnits;
  const levels = calculateExecutionLevels(executionUnits);
  levels.forEach((level, index) => {
    console.log('[DEPENDENCY_LEVEL]', {
      level: index,
      unitIds: level.map(unit => unit.id)
    });
    if (level.length > 1) {
      console.log('[DEPENDENCY_PARALLEL_GROUP]', {
        level: index,
        unitIds: level.map(unit => unit.id)
      });
    }
  });

  const executionGraph = projected.executionGraph;
  const graphValidation = executionGraph.validate();
  const resultValidation = graphValidation.valid ? { valid: true, errors: [] } : { valid: false, errors: graphValidation.errors };
  console.log('[DEPENDENCY_GRAPH_COMPLETE]', {
    valid: resultValidation.valid,
    errorCount: resultValidation.errors.length
  });
  console.log('[EXECUTION_GRAPH_GENERATED]', {
    unitCount: executionGraph.allUnits().length,
    levelCount: levels.length
  });
  console.log('[EXECUTION_GRAPH_READY]', {
    readyCount: executionGraph.readyUnits().length
  });

  return {
    executionUnits,
    levels,
    parallelGroups: levels,
    executionGraph,
    validation: resultValidation
  };
}

export { removeRedundantEdgesFromMap as _removeRedundantEdgesFromMap };
