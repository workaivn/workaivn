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
    plannerPolicies = {},
    policies = null,
    proposals = [],
    promotionLog = [],
    plannedFiles = [],
    explicitRequestedNewFiles = []
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
      proposals: freezeList(derived.proposals || proposals)
    };

    this.workspace = deepFreeze({ ...(workspace && typeof workspace === 'object' ? workspace : {}) });
    this._facts = deepFreeze({ ...(resolvedFacts && typeof resolvedFacts === 'object' ? resolvedFacts : {}) });
    this._derived = deepFreeze({ ...resolvedDerived });
    this._policies = deepFreeze({ ...(policies || plannerPolicies || {}) });
    this.discoveredFiles = freezeList(discoveredFiles);
    this.promotionLog = freezeList(promotionLog);
    this.plannedFiles = freezeList(plannedFiles);
    this._explicitRequestedNewFiles = freezeList(explicitRequestedNewFiles);
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
