import crypto from 'node:crypto';

import { classifyModelResponseFailure, normalizeModelResponse } from '../runtime/modelResponseNormalizer.js';
import { buildArtifactRequirementGraph, deduplicateRequirements, normalizeRequirement } from '../planning/artifactRequirementGraph.js';
import { buildSemanticGoalGraph } from '../planning/objectiveSemanticDecomposer.js';
import { buildRequirementGraph as buildTranslatedRequirementGraph } from '../planning/strategyRequirementTranslator.js';
import { mapRequirementsToWorkspace } from '../planning/workspaceMapper.js';
import { resolveWorkspaceCapabilities } from '../../planner/workspaceCapability/capabilityResolver.js';
import { resolveArtifacts } from '../planning/artifactResolution/artifactResolver.js';
import { resolveImplementationStrategy } from '../planning/implementationStrategy/implementationStrategyResolver.js';

function normalizePath(value = '') {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .trim();
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))];
}

function asLower(value = '') {
  return String(value || '').toLowerCase();
}

function normalizeOrigin(value = '') {
  return String(value || '').trim().toLowerCase();
}

function normalizeAuthoritySource(value = '') {
  const upper = String(value || '').trim().toUpperCase();
  if (['OBJECTIVE_AUTHORITY', 'WORKSPACE_AUTHORITY', 'VERIFIED_PLANNING_CONTEXT', 'RECOMMENDATION_ONLY'].includes(upper)) {
    return upper;
  }
  return upper || null;
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function getWorkspaceFiles(projectScanSnapshot = {}, planningContext = {}) {
  return unique([
    ...(Array.isArray(projectScanSnapshot?.discoveredFiles) ? projectScanSnapshot.discoveredFiles : []),
    ...(Array.isArray(projectScanSnapshot?.files) ? projectScanSnapshot.files : []),
    ...(Array.isArray(planningContext?.discoveredFiles) ? planningContext.discoveredFiles : []),
    ...(Array.isArray(planningContext?.verifiedFiles) ? planningContext.verifiedFiles : []),
    ...(Array.isArray(planningContext?.plannedFiles) ? planningContext.plannedFiles : []),
    ...(Array.isArray(planningContext?.facts?.discoveredFiles) ? planningContext.facts.discoveredFiles : []),
    ...(Array.isArray(planningContext?.facts?.verifiedFiles) ? planningContext.facts.verifiedFiles : []),
    ...(Array.isArray(planningContext?.facts?.plannedFiles) ? planningContext.facts.plannedFiles : [])
  ].map(normalizePath));
}

function inferWorkspaceHints(projectScanSnapshot = {}, planningContext = {}) {
  const files = getWorkspaceFiles(projectScanSnapshot, planningContext);
  const sourceRoot = files.find(file => /^src\//i.test(file))
    ? 'src'
    : (files.find(file => /^app\//i.test(file)) ? 'app' : (files.find(file => file.includes('/')) ? files.find(file => file.includes('/')).split('/')[0] : null));
  const extension = files.some(file => /\.tsx$/i.test(file))
    ? '.tsx'
    : (files.some(file => /\.jsx$/i.test(file)) ? '.jsx'
      : (files.some(file => /\.ts$/i.test(file)) ? '.ts'
        : (files.some(file => /\.js$/i.test(file)) ? '.js' : null)));
  const testExtension = files.some(file => /\.test\.tsx$/i.test(file) || /\.spec\.tsx$/i.test(file))
    ? '.tsx'
    : (files.some(file => /\.test\.jsx$/i.test(file) || /\.spec\.jsx$/i.test(file)) ? '.jsx'
      : (files.some(file => /\.test\.ts$/i.test(file) || /\.spec\.ts$/i.test(file)) ? '.ts'
        : (files.some(file => /\.test\.js$/i.test(file) || /\.spec\.js$/i.test(file)) ? '.js' : extension)));

  return {
    files,
    sourceRoot,
    extension,
    testExtension,
    styleExtension: files.some(file => /\.css$/i.test(file)) ? '.css' : extension
  };
}

function makeCandidate({
  name,
  purpose,
  artifactKind,
  suggestedPath = null,
  suggestedOperation = 'create',
  origin = 'objective',
  authoritySource = 'OBJECTIVE_AUTHORITY',
  confidence = 0.5,
  evidence = [],
  risks = [],
  dependencies = [],
  validationHints = []
} = {}) {
  return {
    id: `artifact:${crypto.randomUUID()}`,
    name: String(name || '').trim() || 'Artifact candidate',
    purpose: String(purpose || '').trim() || 'Proposed artifact',
    artifactKind: String(artifactKind || 'source').trim(),
    suggestedPath: suggestedPath ? normalizePath(suggestedPath) : null,
    suggestedOperation: String(suggestedOperation || 'create').trim().toLowerCase(),
    origin: normalizeOrigin(origin) || 'objective',
    authoritySource: normalizeAuthoritySource(authoritySource) || 'OBJECTIVE_AUTHORITY',
    confidence: Number.isFinite(Number(confidence)) ? Math.max(0, Math.min(1, Number(confidence))) : 0.5,
    evidence: unique(toArray(evidence).map(value => String(value || '').trim())),
    risks: unique(toArray(risks).map(value => String(value || '').trim())),
    dependencies: unique(toArray(dependencies).map(value => String(value || '').trim())),
    validationHints: unique(toArray(validationHints).map(value => String(value || '').trim())),
    executable: false
  };
}

function extractModelArtifacts(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== 'object') return [];
  if (Array.isArray(parsed.artifacts)) return parsed.artifacts;
  if (Array.isArray(parsed.candidates)) return parsed.candidates;
  if (Array.isArray(parsed.files)) return parsed.files;
  if (Array.isArray(parsed.artifactCandidates)) return parsed.artifactCandidates;
  if (parsed.name || parsed.purpose || parsed.suggestedPath || parsed.artifactKind) return [parsed];
  return [];
}

function inferGenericArtifacts({
  objective = '',
  taskIntent = {},
  projectScanSnapshot = {},
  planningContext = {},
  capabilityGraph = null
} = {}) {
  const lowerObjective = asLower(objective || taskIntent?.prompt || taskIntent?.objective || '');
  const capabilityHints = new Set();
  if (/\b(style|styles|css|theme|ui|page|screen|landing|dashboard|frontend|component)\b/.test(lowerObjective)) capabilityHints.add('GLOBAL_STYLE');
  if (/\b(nav|navigation|menu)\b/.test(lowerObjective)) capabilityHints.add('NAVIGATION');
  if (/\bhero\b/.test(lowerObjective)) capabilityHints.add('HERO');
  if (/\bfeature(s)?\b/.test(lowerObjective)) capabilityHints.add('FEATURES');
  if (/\bpricing\b/.test(lowerObjective)) capabilityHints.add('PRICING');
  if (/\bcta\b|\bcall to action\b/.test(lowerObjective)) capabilityHints.add('CTA');
  if (/\bfooter\b/.test(lowerObjective)) capabilityHints.add('FOOTER');
  if (/\btest|tests|validation|verify\b/.test(lowerObjective)) capabilityHints.add('TEST');
  if (/\bbuild\b/.test(lowerObjective)) capabilityHints.add('BUILD');

  const requirements = buildArtifactRequirementGraph({
    objective,
    goalType: taskIntent?.goalType || projectScanSnapshot?.goalType || 'UNKNOWN',
    planningContext,
    projectScanSnapshot,
    projectIntent: {
      ...taskIntent,
      prompt: objective || taskIntent?.prompt || taskIntent?.objective || '',
      objective: objective || taskIntent?.objective || taskIntent?.prompt || ''
    },
    policies: planningContext?.plannerPolicies || {}
  }).requirements;

  const enrichedRequirements = deduplicateRequirements([
    ...requirements,
    ...[...capabilityHints].map(capability => normalizeRequirement({
      capability,
      required: true,
      source: 'objective',
      confidence: 0.7,
      evidence: [`objective:${String(objective || '').slice(0, 120)}`]
    }))
  ]);

  return enrichedRequirements;
}

function normalizeCandidate(candidate = {}) {
  const suggestedPath = normalizePath(candidate?.suggestedPath || candidate?.path || candidate?.file || candidate?.targetPath || '');
  const origin = normalizeOrigin(candidate?.origin || candidate?.source || 'objective');
  const authoritySource = normalizeAuthoritySource(candidate?.authoritySource || (origin === 'workspace' ? 'WORKSPACE_AUTHORITY' : origin === 'verified_context' || origin === 'capability_graph' ? 'VERIFIED_PLANNING_CONTEXT' : 'OBJECTIVE_AUTHORITY'));
  return makeCandidate({
    name: candidate?.name || candidate?.title || candidate?.artifactName || suggestedPath || 'Artifact candidate',
    purpose: candidate?.purpose || candidate?.description || candidate?.reason || 'Proposed artifact',
    artifactKind: candidate?.artifactKind || candidate?.kind || candidate?.type || 'source',
    suggestedPath: suggestedPath || null,
    suggestedOperation: candidate?.suggestedOperation || candidate?.operation || (candidate?.mutation === true ? 'modify' : 'create'),
    origin,
    authoritySource,
    confidence: candidate?.confidence ?? candidate?.score ?? candidate?.likelihood ?? 0.5,
    evidence: candidate?.evidence || candidate?.evidenceRefs || candidate?.evidenceRef || [],
    risks: candidate?.risks || candidate?.warnings || [],
    dependencies: candidate?.dependencies || [],
    validationHints: candidate?.validationHints || candidate?.validation || []
  });
}

export function parseArtifactCandidateResponse(rawResponse) {
  const normalized = normalizeModelResponse(rawResponse, { mode: 'tool' });
  if (!normalized.success) {
    return {
      success: false,
      error: normalized,
      candidates: []
    };
  }

  const parsed = normalized.parsed;
  const artifacts = extractModelArtifacts(parsed).map(normalizeCandidate);
  if (artifacts.length === 0) {
    return {
      success: false,
      error: {
        code: 'MODEL_FORMAT_ERROR',
        message: 'Artifact candidate response did not include artifacts'
      },
      candidates: []
    };
  }

  return {
    success: true,
    candidates: artifacts,
    parsed
  };
}

export function generateArtifactCandidates({
  objective = '',
  taskIntent = null,
  projectScanSnapshot = {},
  planningContext = {},
  capabilityGraph = null,
  frameworkCandidates = [],
  bootstrapRecommendations = [],
  policies = {},
  modelRequest = null,
  modelResponse = null
} = {}) {
  console.log('[ARTIFACT_CANDIDATE_GENERATION_START]', {
    objectiveLength: String(objective || '').length,
    objectiveAuthorityEligible: taskIntent?.objectiveAuthorityEligible === true,
    allowedInitialization: policies?.ALLOW_PROJECT_INITIALIZATION === true
  });

  let modelCandidates = [];
  let modelError = null;
  if (modelRequest) {
    console.log('[ARTIFACT_CANDIDATE_MODEL_REQUEST]', {
      objective: String(objective || '').slice(0, 120),
      messageCount: Array.isArray(modelRequest?.messages) ? modelRequest.messages.length : null
    });
  }
  if (modelResponse !== null && modelResponse !== undefined) {
    console.log('[ARTIFACT_CANDIDATE_MODEL_RESPONSE]', {
      rawType: Array.isArray(modelResponse) ? 'array' : typeof modelResponse,
      contentLength: typeof modelResponse === 'string' ? modelResponse.length : null
    });
    const parsed = parseArtifactCandidateResponse(modelResponse);
    if (parsed.success) {
      modelCandidates = parsed.candidates;
    } else {
      modelError = parsed.error || { code: 'MODEL_FORMAT_ERROR', message: 'Artifact candidate parsing failed' };
      console.log('[ARTIFACT_CANDIDATE_PARSE_FAILED]', {
        reason: modelError.message || 'Artifact candidate parsing failed',
        code: modelError.code || classifyModelResponseFailure(modelError) || 'MODEL_FORMAT_ERROR'
      });
    }
  }

  const semanticGoalGraph = buildSemanticGoalGraph({
    objective,
    projectIntent: {
      ...taskIntent,
      prompt: objective || taskIntent?.prompt || taskIntent?.objective || '',
      objective: objective || taskIntent?.objective || taskIntent?.prompt || ''
    }
  });
  const planningStrategyGraph = planningContext?.planningStrategyGraph || semanticGoalGraph?.planningStrategyGraph || null;
  const requestedFileDetails = Array.isArray(planningContext?.requestedFileDetails) ? planningContext.requestedFileDetails : [];
  const translatedRequirementGraph = planningStrategyGraph || requestedFileDetails.length > 0
    ? buildTranslatedRequirementGraph({
        planningStrategyGraph,
        requestedFileDetails
      })
    : null;

  const requirementGraph = buildArtifactRequirementGraph({
    objective,
    goalType: taskIntent?.goalType || projectScanSnapshot?.projectType || 'UNKNOWN',
    planningContext,
    projectScanSnapshot,
    semanticGoalGraph,
    planningStrategyGraph,
    ...(translatedRequirementGraph ? { translatedRequirementGraph } : {}),
    projectIntent: {
      ...taskIntent,
      prompt: objective || taskIntent?.prompt || taskIntent?.objective || '',
      objective: objective || taskIntent?.objective || taskIntent?.prompt || ''
    },
    policies
  });
  const mergedRequirements = deduplicateRequirements([
    ...(Array.isArray(requirementGraph.requirements) ? requirementGraph.requirements : []),
    ...(modelCandidates.length > 0
      ? modelCandidates.map(candidate => normalizeRequirement({
          capability: String(candidate.capability || candidate.artifactKind || 'APPLICATION_ENTRY').toUpperCase(),
          artifactType: candidate.artifactType || candidate.kind || 'source',
          purpose: candidate.purpose || candidate.description || 'Model-proposed artifact',
          required: candidate.required !== false,
          source: 'model_candidate',
          confidence: candidate.confidence ?? 0.55,
          evidence: candidate.evidence || [],
          dependencies: candidate.dependencies || [],
          priority: candidate.priority ?? 50
        }))
      : [])
  ]);

  const implementationResolution = resolveImplementationStrategy({
    objective,
    requirements: mergedRequirements,
    objectiveConstraints: Array.isArray(planningContext?.objectiveConstraints) ? planningContext.objectiveConstraints : [],
    planningStrategies: Array.isArray(planningContext?.planningStrategies) ? planningContext.planningStrategies : [],
    initializationStrategies: Array.isArray(planningContext?.initializationStrategies) ? planningContext.initializationStrategies : [],
    planningContext,
    projectScanSnapshot,
    projectIntent: {
      ...taskIntent,
      prompt: objective || taskIntent?.prompt || taskIntent?.objective || '',
      objective: objective || taskIntent?.objective || taskIntent?.prompt || ''
    }
  });
  const implementationPlanningContext = {
    ...planningContext,
    ...(implementationResolution || {})
  };

  const capabilityResolution = resolveWorkspaceCapabilities({
    requirements: mergedRequirements,
    projectScanSnapshot,
    planningContext: {
      ...implementationPlanningContext,
      workspaceCapabilities: Array.isArray(planningContext?.workspaceCapabilities) ? planningContext.workspaceCapabilities : [],
      capabilityEvidence: Array.isArray(planningContext?.capabilityEvidence) ? planningContext.capabilityEvidence : []
    },
    objective,
    planningStrategyGraph,
    constraintGraph: requirementGraph?.constraintGraph || requirementGraph?.planningStrategyGraph?.constraintGraph || null
  });
  const artifactResolution = resolveArtifacts({
    mappedCapabilities: Array.isArray(capabilityResolution.mappedCapabilities) ? capabilityResolution.mappedCapabilities : [],
    requirements: mergedRequirements,
    workspaceCapabilities: capabilityResolution.workspaceCapabilities,
    planningContext: implementationPlanningContext,
    projectScanSnapshot,
    objective,
    planningStrategyGraph,
    constraintGraph: requirementGraph?.constraintGraph || requirementGraph?.planningStrategyGraph?.constraintGraph || null,
    satisfactionAnalysis: capabilityResolution.capabilitySatisfaction
  });

  const workspaceMapping = mapRequirementsToWorkspace({
    requirements: mergedRequirements,
    planningContext: implementationPlanningContext,
    projectScanSnapshot,
    projectIntent: {
      ...taskIntent,
      prompt: objective || taskIntent?.prompt || taskIntent?.objective || '',
      objective: objective || taskIntent?.objective || taskIntent?.prompt || ''
    },
    objective,
    planningStrategyGraph,
    implementationResolution
  });
  const normalizedModelCandidates = modelCandidates.map(candidate => normalizeCandidate({
    ...candidate,
    suggestedPath: candidate.path || candidate.suggestedPath || candidate.file || candidate.targetPath || null,
    suggestedOperation: candidate.operation || candidate.suggestedOperation || 'create',
    origin: candidate.source === 'workspace_evidence' ? 'workspace' : (candidate.source === 'model_candidate' ? 'model_candidate' : 'objective'),
    authoritySource: candidate.source === 'workspace_evidence'
      ? 'VERIFIED_PLANNING_CONTEXT'
      : 'OBJECTIVE_AUTHORITY'
  }));
  const modelCandidatePaths = new Set(normalizedModelCandidates.map(candidate => normalizePath(candidate.suggestedPath || candidate.name || '')));
  const baseSourceCandidates = Array.isArray(artifactResolution.executionCandidates) && artifactResolution.executionCandidates.length > 0
    ? artifactResolution.executionCandidates
    : (workspaceMapping.candidates.length > 0
      ? workspaceMapping.candidates
      : []);
  const sourceCandidates = [
    ...baseSourceCandidates.filter(candidate => {
      const candidatePath = normalizePath(candidate.path || candidate.suggestedPath || candidate.name || '');
      return !candidatePath || !modelCandidatePaths.has(candidatePath);
    }),
    ...normalizedModelCandidates
  ];

  const deduped = [];
  const seen = new Set();
  for (const candidate of sourceCandidates) {
    const candidatePath = normalizePath(candidate.path || candidate.suggestedPath || candidate.file || candidate.targetPath || '');
    const normalized = normalizeCandidate({
      ...candidate,
      suggestedPath: candidatePath || null,
      suggestedOperation: candidate.operation || candidate.suggestedOperation || 'create',
      origin: candidatePath
        ? (candidate.source === 'model_candidate' ? 'model_candidate' : 'workspace')
        : (candidate.source === 'workspace_evidence' ? 'workspace' : (candidate.source === 'model_candidate' ? 'model_candidate' : 'objective')),
      authoritySource: candidatePath
        ? 'VERIFIED_ARTIFACT_MAPPING'
        : (candidate.source === 'workspace_evidence'
          ? 'VERIFIED_PLANNING_CONTEXT'
          : 'OBJECTIVE_AUTHORITY')
    });
    normalized.requirementId = candidate.requirementId || candidate.id || null;
    normalized.requirementCapability = candidate.requirementCapability || candidate.capability || null;
    normalized.mappingReason = candidate.mappingReason || null;
    normalized.unresolved = candidate.unresolved === true;
    const key = [
      normalized.origin,
      normalized.authoritySource,
      normalized.artifactKind,
      normalized.suggestedPath || normalized.name,
      normalized.requirementCapability || ''
    ].join('|').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(normalized);
    console.log('[ARTIFACT_CANDIDATE_CREATED]', {
      id: normalized.id,
      requirementId: normalized.requirementId,
      requirementCapability: normalized.requirementCapability,
      name: normalized.name,
      artifactKind: normalized.artifactKind,
      origin: normalized.origin,
      authoritySource: normalized.authoritySource,
      suggestedPath: normalized.suggestedPath || null,
      mappingReason: normalized.mappingReason || null,
      executable: false
    });
  }

  return {
    candidates: artifactResolution.executionCandidates,
    modelError,
    usedModel: modelCandidates.length > 0,
    fallbackUsed: modelCandidates.length === 0,
    requirementGraph,
    semanticGoalGraph,
    planningStrategyGraph,
    workspaceMapping,
    workspaceCapabilities: capabilityResolution.workspaceCapabilities,
    artifactGraph: artifactResolution.artifactGraph,
    artifactOperations: artifactResolution.artifactOperations,
    plannerApprovedArtifacts: artifactResolution.plannerApprovedArtifacts,
    artifactOwnership: artifactResolution.artifactOwnership,
    artifactLifecycle: artifactResolution.artifactLifecycle,
    operationPlan: artifactResolution.operationPlan,
    artifactCandidates: artifactResolution.plannerApprovedArtifacts,
    capabilityEvidence: capabilityResolution.capabilityEvidence,
    capabilityCoverage: capabilityResolution.capabilityCoverage,
    capabilityGapGraph: capabilityResolution.capabilityGapGraph,
    satisfiedCapabilities: capabilityResolution.satisfiedCapabilities,
    missingCapabilities: capabilityResolution.missingCapabilities,
    initializationCapabilities: capabilityResolution.initializationCapabilities,
    implementationResolution,
    executionCandidates: artifactResolution.executionCandidates,
    rawCandidates: deduped
  };
}
