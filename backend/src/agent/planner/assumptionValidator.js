export const ASSUMPTION_ACTION = Object.freeze({
  PROCEED: 'PROCEED',
  SKIP_OPTIONAL_PREREQUISITE: 'SKIP_OPTIONAL_PREREQUISITE',
  REQUEST_REPLAN: 'REQUEST_REPLAN',
  REQUEST_DISCOVERY: 'REQUEST_DISCOVERY',
  BLOCK_FATAL: 'BLOCK_FATAL'
});

const KNOWN_CONFIG_FILES = [
  'package.json',
  'tsconfig.json',
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.cjs',
  'jest.config.js',
  'jest.config.ts',
  'jest.config.mjs',
  'jest.config.cjs',
  'vitest.config.ts',
  'vitest.config.js',
  'composer.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Cargo.toml',
  'requirements.txt',
  'pyproject.toml',
  'pubspec.yaml',
  'next.config.js',
  'next.config.ts'
];

export class PlannerAssumption {
  constructor({
    path,
    source,
    confidence = 0.5,
    required = false,
    optional = false,
    verified = false,
    discoveryEvidence = null,
    requestedKind = null,
    authoritySource = source || null,
    conditional = false,
    explicit = false
  }) {
    this.path = path;
    this.source = source;
    this.confidence = confidence;
    this.required = required;
    this.optional = optional;
    this.verified = verified;
    this.discoveryEvidence = discoveryEvidence;
    this.requestedKind = requestedKind;
    this.authoritySource = authoritySource;
    this.conditional = conditional;
    this.explicit = explicit;
  }
}

export function createPlannerAssumption(filePath, source, options = {}) {
  return new PlannerAssumption({ path: filePath, source, ...options });
}

export function validateAssumptions(workspaceState = {}, projectScan = {}, assumptions = []) {
  const existingFiles = new Set(
    (workspaceState.existingFiles || []).map(f => f.replace(/\\/g, '/').toLowerCase())
  );
  const scanFiles = new Set(
    (projectScan.entryFiles || []).map(f => f.replace(/\\/g, '/').toLowerCase())
  );
  const allExisting = new Set([...existingFiles, ...scanFiles]);

  return assumptions.map(assumption => {
    const normalizedPath = assumption.path.replace(/\\/g, '/').toLowerCase();
    const exists = allExisting.has(normalizedPath);
    const requestedKind = String(assumption.requestedKind || '').trim().toUpperCase();
    const authoritySource = String(assumption.authoritySource || assumption.source || '').trim().toLowerCase();

    if (exists) {
      assumption.verified = true;
      assumption.discoveryEvidence = {
        foundInExistingFiles: existingFiles.has(normalizedPath),
        foundInEntryFiles: scanFiles.has(normalizedPath),
        matchedPath: normalizedPath
      };
      console.log('[PLANNER_ASSUMPTION_VERIFIED]', {
        path: assumption.path,
        source: assumption.source,
        requestedKind: assumption.requestedKind || null,
        authoritySource: assumption.authoritySource || null,
        confidence: assumption.confidence,
        required: assumption.required,
        optional: assumption.optional,
        conditional: assumption.conditional === true,
        explicit: assumption.explicit === true,
        discoveryEvidence: assumption.discoveryEvidence
      });
    } else {
      if (requestedKind === 'DISCOVER_IF_EXISTS') {
        assumption.verified = false;
        assumption.discoveryEvidence = {
          foundInExistingFiles: false,
          foundInEntryFiles: false,
          matchedPath: null
        };
        console.log('[DISCOVER_IF_EXISTS_ABSENT]', {
          path: assumption.path,
          requestedKind,
          reason: 'Optional discovery target not present'
        });
        return assumption;
      }

      if (requestedKind === 'EXPLICIT_CREATE' && authoritySource === 'explicit_user_request') {
        assumption.verified = false;
        assumption.discoveryEvidence = {
          foundInExistingFiles: false,
          foundInEntryFiles: false,
          matchedPath: null
        };
        console.log('[PLANNER_ASSUMPTION_ACCEPTED_CREATE_MISSING]', {
          path: assumption.path,
          requestedKind,
          authoritySource: 'explicit_user_request',
          reason: 'Explicit create target may be missing from workspace'
        });
        return assumption;
      }

      assumption.verified = false;
      assumption.discoveryEvidence = {
        foundInExistingFiles: false,
        foundInEntryFiles: false,
        matchedPath: null
      };
      console.log('[PLANNER_ASSUMPTION_REJECTED]', {
        path: assumption.path,
        source: assumption.source,
        requestedKind: assumption.requestedKind || null,
        authoritySource: assumption.authoritySource || null,
        confidence: assumption.confidence,
        required: assumption.required,
        optional: assumption.optional,
        conditional: assumption.conditional === true,
        explicit: assumption.explicit === true,
        reason: 'File not found in workspace',
        discoveryEvidence: assumption.discoveryEvidence
      });
    }

    return assumption;
  });
}

export function generateAssumptionsFromClassifier(requestedFiles = [], source = 'classifier') {
  return requestedFiles.map(file => {
    const entry = typeof file === 'string' ? { path: file } : (file || {});
    const path = entry.path || entry.file || entry.target || entry.name || '';
    return createPlannerAssumption(path, source, {
      required: true,
      optional: false,
      verified: entry.verified === true,
      requestedKind: entry.kind || entry.requestedKind || null,
      authoritySource: entry.authoritySource || source,
      conditional: entry.conditional === true,
      explicit: entry.explicit !== false,
      discoveryEvidence: entry.discoveryEvidence || null
    });
  });
}

export function generateAssumptionsFromBootstrap(profile = {}) {
  const targetFiles = profile.targetFiles || [];
  for (const entry of targetFiles) {
    const filePath = entry.path || entry.file || entry;
    if (!filePath) continue;
    console.log('[PLANNER_ASSUMPTION_BLOCKED_LEGACY_SOURCE]', {
      path: filePath,
      source: `bootstrap:${profile.id || 'unknown'}`,
      reason: 'bootstrap/profile sources are recommendation-only'
    });
  }
  return [];
}

export function generateAssumptionsFromProjectType(projectType = 'generic') {
  console.log('[PLANNER_ASSUMPTION_BLOCKED_LEGACY_SOURCE]', {
    source: `project_type:${projectType || 'generic'}`,
    reason: 'project type hints are recommendation-only'
  });
  return [];
}

export function validatePlannerAssumptions({
  workspaceState = {},
  projectScan = {},
  classifierRequestedFiles = [],
  bootstrapProfile = null,
  projectType = 'generic'
} = {}) {
  const allAssumptions = [];

  const classifierAssumptions = generateAssumptionsFromClassifier(classifierRequestedFiles);
  for (const assumption of classifierAssumptions) {
    console.log('[PLANNER_ASSUMPTION_CREATED]', {
      path: assumption.path,
      source: assumption.source,
      requestedKind: assumption.requestedKind || null,
      authoritySource: assumption.authoritySource || null,
      required: assumption.required,
      optional: assumption.optional,
      conditional: assumption.conditional === true,
      explicit: assumption.explicit === true
    });
    allAssumptions.push(assumption);
  }

  if (bootstrapProfile) {
    generateAssumptionsFromBootstrap(bootstrapProfile);
  }

  generateAssumptionsFromProjectType(projectType);

  const validated = validateAssumptions(workspaceState, projectScan, allAssumptions);

  for (const assumption of validated) {
    if (!assumption.verified && assumption.optional) {
      console.log('[PLANNER_PREREQUISITE_SKIPPED]', {
        path: assumption.path,
        source: assumption.source,
        reason: 'Optional prerequisite not found in workspace'
      });
    }
  }

  for (const assumption of validated) {
    if (assumption.verified && assumption.required) {
      console.log('[PLANNER_PREREQUISITE_CREATED]', {
        path: assumption.path,
        source: assumption.source,
        verified: true
      });
    }
  }

  return validated;
}

export function filterUnverifiedFiles(files = [], validatedAssumptions = []) {
  const assumptionMap = new Map();
  for (const assumption of validatedAssumptions) {
    const key = assumption.path.replace(/\\/g, '/').toLowerCase();
    assumptionMap.set(key, assumption);
  }

  return files.filter(file => {
    const normalized = file.replace(/\\/g, '/').toLowerCase();
    const assumption = assumptionMap.get(normalized);
    if (assumption && !assumption.verified) {
      console.log('[PLANNER_ASSUMPTION_REJECTED]', {
        path: file,
        reason: 'Assumption not verified — filtering from prerequisites'
      });
      return false;
    }
    return true;
  });
}

export function decideAssumptionAction(assumption) {
  if (assumption.verified) return ASSUMPTION_ACTION.PROCEED;
  if (assumption.required && !assumption.verified) return ASSUMPTION_ACTION.BLOCK_FATAL;
  if (assumption.optional && !assumption.verified) return ASSUMPTION_ACTION.SKIP_OPTIONAL_PREREQUISITE;
  if (!assumption.required && !assumption.optional && !assumption.verified) return ASSUMPTION_ACTION.REQUEST_DISCOVERY;
  return ASSUMPTION_ACTION.REQUEST_REPLAN;
}
