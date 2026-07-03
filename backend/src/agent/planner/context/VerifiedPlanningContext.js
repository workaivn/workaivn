function freezeList(value = []) {
  return Object.freeze([...(Array.isArray(value) ? value : [])]);
}

function freezeObject(value = {}) {
  return Object.freeze({ ...(value && typeof value === "object" ? value : {}) });
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value)) {
    deepFreeze(value[key], seen);
  }
  return Object.freeze(value);
}

export function freezePlanningContext(context) {
  return deepFreeze(context);
}

export class VerifiedPlanningContext {
  constructor({
    workspace = {},
    facts = null,
    derived = {},
    projectScan = null,
    discoveredFiles = [],
    verifiedFiles = [],
    verifiedCommands = [],
    verifiedFramework = null,
    verifiedPackageManager = null,
    verifiedValidation = null,
    verifiedEntrypoints = [],
    verifiedAppRoots = [],
    verifiedSourceRoots = [],
    verifiedModuleRoots = [],
    verifiedRecommendations = [],
    blockedRecommendations = [],
    constraintGraph = null,
    planningStrategyGraph = null,
    objectiveConstraints = [],
    planningStrategies = [],
    initializationStrategies = [],
    requiredFramework = null,
    implementationStrategies = [],
    implementationVariants = [],
    selectedImplementation = null,
    implementationEvidence = [],
    implementationPolicyDecision = null,
    implementationVariantGraph = null,
    plannerPolicies = {},
    policies = null,
    proposals = [],
    promotionLog = [],
    plannedFiles = [],
    workspaceCapabilities = [],
    artifactCandidates = [],
    artifactGraph = null,
    artifactOperations = {},
    plannerApprovedArtifacts = [],
    satisfiedCapabilities = [],
    missingCapabilities = [],
    capabilityCoverage = null,
    capabilityGapGraph = null,
    satisfiedCapabilityGraph = null,
    missingCapabilityGraph = null,
    initializationCapabilities = [],
    capabilitySatisfaction = null,
    artifactOwnership = {},
    artifactLifecycle = {},
    operationPlan = [],
    capabilityEvidence = [],
    explicitRequestedNewFiles = [],
    initializationMode = null,
    objectiveAuthorityEligible = false
  } = {}) {
    const resolvedFacts = facts || projectScan || {};
    const resolvedDerived = {
      verifiedFiles: freezeList(derived.verifiedFiles || verifiedFiles),
      verifiedCommands: freezeList(derived.verifiedCommands || verifiedCommands),
      verifiedFramework: derived.verifiedFramework ?? verifiedFramework,
      verifiedPackageManager: derived.verifiedPackageManager ?? verifiedPackageManager,
      verifiedValidation: derived.verifiedValidation ?? verifiedValidation,
      verifiedEntrypoints: freezeList(derived.verifiedEntrypoints || verifiedEntrypoints),
      verifiedAppRoots: freezeList(derived.verifiedAppRoots || verifiedAppRoots),
      verifiedSourceRoots: freezeList(derived.verifiedSourceRoots || verifiedSourceRoots),
      verifiedModuleRoots: freezeList(derived.verifiedModuleRoots || verifiedModuleRoots),
      verifiedRecommendations: freezeList(derived.verifiedRecommendations || verifiedRecommendations),
      blockedRecommendations: freezeList(derived.blockedRecommendations || blockedRecommendations),
      constraintGraph: derived.constraintGraph || constraintGraph,
      planningStrategyGraph: derived.planningStrategyGraph || planningStrategyGraph,
      objectiveConstraints: freezeList(derived.objectiveConstraints || objectiveConstraints),
      planningStrategies: freezeList(derived.planningStrategies || planningStrategies),
      initializationStrategies: freezeList(derived.initializationStrategies || initializationStrategies),
      requiredFramework: derived.requiredFramework ?? requiredFramework,
      implementationStrategies: freezeList(derived.implementationStrategies || implementationStrategies),
      implementationVariants: freezeList(derived.implementationVariants || implementationVariants),
      selectedImplementation: derived.selectedImplementation || selectedImplementation,
      implementationEvidence: freezeList(derived.implementationEvidence || implementationEvidence),
      implementationPolicyDecision: freezeObject(derived.implementationPolicyDecision || implementationPolicyDecision),
      implementationVariantGraph: derived.implementationVariantGraph || implementationVariantGraph,
      proposals: freezeList(derived.proposals || proposals),
      satisfiedCapabilities: freezeList(derived.satisfiedCapabilities || satisfiedCapabilities),
      missingCapabilities: freezeList(derived.missingCapabilities || missingCapabilities),
      capabilityCoverage: freezeObject(derived.capabilityCoverage || capabilityCoverage),
      capabilityGapGraph: derived.capabilityGapGraph || capabilityGapGraph,
      satisfiedCapabilityGraph: derived.satisfiedCapabilityGraph || satisfiedCapabilityGraph,
      missingCapabilityGraph: derived.missingCapabilityGraph || missingCapabilityGraph,
      initializationCapabilities: freezeList(derived.initializationCapabilities || initializationCapabilities),
      capabilitySatisfaction: derived.capabilitySatisfaction || capabilitySatisfaction
    };

    this.workspace = deepFreeze({ ...(workspace && typeof workspace === 'object' ? workspace : {}) });
    this._facts = deepFreeze({ ...(resolvedFacts && typeof resolvedFacts === 'object' ? resolvedFacts : {}) });
    this._derived = deepFreeze({ ...resolvedDerived });
    this._policies = deepFreeze({ ...(policies || plannerPolicies || {}) });
    this.discoveredFiles = freezeList(discoveredFiles);
    this.promotionLog = freezeList(promotionLog);
    this.plannedFiles = freezeList(plannedFiles);
    this._workspaceCapabilities = freezeList(workspaceCapabilities);
    this._artifactCandidates = freezeList(artifactCandidates);
    this._artifactGraph = deepFreeze(artifactGraph && typeof artifactGraph === 'object' ? artifactGraph : null);
    this._artifactOperations = deepFreeze(artifactOperations && typeof artifactOperations === 'object' ? artifactOperations : {});
    this._plannerApprovedArtifacts = freezeList(plannerApprovedArtifacts);
    this._artifactOwnership = deepFreeze(artifactOwnership && typeof artifactOwnership === 'object' ? artifactOwnership : {});
    this._artifactLifecycle = deepFreeze(artifactLifecycle && typeof artifactLifecycle === 'object' ? artifactLifecycle : {});
    this._operationPlan = freezeList(operationPlan);
    this._capabilityEvidence = freezeList(capabilityEvidence);
    this._explicitRequestedNewFiles = freezeList(explicitRequestedNewFiles);
    this.initializationMode = initializationMode || null;
    this.objectiveAuthorityEligible = objectiveAuthorityEligible === true;
    freezePlanningContext(this);
  }

  get facts() {
    return this._facts;
  }

  get derived() {
    return this._derived;
  }

  get projectScan() {
    return this._facts;
  }

  get plannerPolicies() {
    return this._policies;
  }

  get policies() {
    return this._policies;
  }

  get blocked() {
    return {
      blockedRecommendations: this.blockedRecommendations
    };
  }

  get verifiedFiles() {
    return this._derived.verifiedFiles;
  }

  get verifiedCommands() {
    return this._derived.verifiedCommands;
  }

  get verifiedFramework() {
    return this._derived.verifiedFramework;
  }

  get verifiedPackageManager() {
    return this._derived.verifiedPackageManager;
  }

  get verifiedValidation() {
    return this._derived.verifiedValidation;
  }

  get verifiedEntrypoints() {
    return this._derived.verifiedEntrypoints;
  }

  get verifiedAppRoots() {
    return this._derived.verifiedAppRoots;
  }

  get verifiedSourceRoots() {
    return this._derived.verifiedSourceRoots;
  }

  get verifiedModuleRoots() {
    return this._derived.verifiedModuleRoots;
  }

  get verifiedRecommendations() {
    return this._derived.verifiedRecommendations;
  }

  get blockedRecommendations() {
    return this._derived.blockedRecommendations;
  }

  get constraintGraph() {
    return this._derived.constraintGraph;
  }

  get planningStrategyGraph() {
    return this._derived.planningStrategyGraph;
  }

  get objectiveConstraints() {
    return this._derived.objectiveConstraints;
  }

  get planningStrategies() {
    return this._derived.planningStrategies;
  }

  get initializationStrategies() {
    return this._derived.initializationStrategies;
  }

  get requiredFramework() {
    return this._derived.requiredFramework;
  }

  get implementationStrategies() {
    return this._derived.implementationStrategies;
  }

  get implementationVariants() {
    return this._derived.implementationVariants;
  }

  get selectedImplementation() {
    return this._derived.selectedImplementation;
  }

  get implementationEvidence() {
    return this._derived.implementationEvidence;
  }

  get implementationPolicyDecision() {
    return this._derived.implementationPolicyDecision;
  }

  get implementationVariantGraph() {
    return this._derived.implementationVariantGraph;
  }

  get proposals() {
    return this._derived.proposals;
  }

  get requestedFiles() {
    return this._facts.requestedFiles || [];
  }

  get requestedFileDetails() {
    return this._facts.requestedFileDetails || [];
  }

  get requestedFileKinds() {
    return this._facts.requestedFileKinds || [];
  }

  get conditionalRequestedFiles() {
    return this._facts.conditionalRequestedFiles || [];
  }

  get discoverIfExistsFiles() {
    return this._facts.discoverIfExistsFiles || [];
  }

  get referenceOnlyFiles() {
    return this._facts.referenceOnlyFiles || [];
  }

  get derivedFiles() {
    return this._facts.derivedFiles || [];
  }

  get plannedNewFiles() {
    const plannedNewFiles = this._facts.plannedNewFiles;
    return Array.isArray(plannedNewFiles) && plannedNewFiles.length > 0 ? plannedNewFiles : this.plannedFiles;
  }

  get workspaceCapabilities() {
    return this._workspaceCapabilities;
  }

  get artifactCandidates() {
    return this._artifactCandidates;
  }

  get artifactGraph() {
    return this._artifactGraph;
  }

  get artifactOperations() {
    return this._artifactOperations;
  }

  get plannerApprovedArtifacts() {
    return this._plannerApprovedArtifacts;
  }

  get satisfiedCapabilities() {
    return this._derived.satisfiedCapabilities;
  }

  get missingCapabilities() {
    return this._derived.missingCapabilities;
  }

  get capabilityCoverage() {
    return this._derived.capabilityCoverage;
  }

  get capabilityGapGraph() {
    return this._derived.capabilityGapGraph;
  }

  get satisfiedCapabilityGraph() {
    return this._derived.satisfiedCapabilityGraph;
  }

  get missingCapabilityGraph() {
    return this._derived.missingCapabilityGraph;
  }

  get initializationCapabilities() {
    return this._derived.initializationCapabilities;
  }

  get capabilitySatisfaction() {
    return this._derived.capabilitySatisfaction;
  }

  get artifactOwnership() {
    return this._artifactOwnership;
  }

  get artifactLifecycle() {
    return this._artifactLifecycle;
  }

  get operationPlan() {
    return this._operationPlan;
  }

  get capabilityEvidence() {
    return this._capabilityEvidence;
  }

  get packageJsonFound() {
    return this._facts.packageJsonFound === true || this.workspace.packageJsonFound === true;
  }

  get hasVerifiedFiles() {
    return this.verifiedFiles.length > 0;
  }

  get hasBlockedRecommendations() {
    return this.blockedRecommendations.length > 0;
  }

  fileIsVerified(path) {
    const normalized = String(path || '').replace(/\\/g, '/').toLowerCase();
    return this.verifiedFiles.some(f => f.replace(/\\/g, '/').toLowerCase() === normalized);
  }

  fileIsBlocked(path) {
    const normalized = String(path || '').replace(/\\/g, '/').toLowerCase();
    return this.blockedRecommendations.some(r => r.path && r.path.replace(/\\/g, '/').toLowerCase() === normalized);
  }

  commandIsVerified(command) {
    return this.verifiedCommands.some(c => String(c).trim().toLowerCase() === String(command).trim().toLowerCase());
  }

  get explicitRequestedNewFiles() {
    return this._explicitRequestedNewFiles;
  }

  fileIsPlanned(path) {
    const normalized = String(path || '').replace(/\\/g, '/').toLowerCase();
    return this.plannedFiles.some(f => f.replace(/\\/g, '/').toLowerCase() === normalized);
  }

  fileIsExplicitNew(path) {
    const normalized = String(path || '').replace(/\\/g, '/').toLowerCase();
    return this.explicitRequestedNewFiles.some(f => f.replace(/\\/g, '/').toLowerCase() === normalized);
  }
}
