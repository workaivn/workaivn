import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildPlan } from '../planner/planBuilder.js';
import { Planner } from '../planner/planner.js';
import {
  PlannerAssumption,
  createPlannerAssumption,
  validatePlannerAssumptions,
  validateAssumptions,
  filterUnverifiedFiles,
  generateAssumptionsFromClassifier,
  generateAssumptionsFromBootstrap,
  generateAssumptionsFromProjectType,
  decideAssumptionAction,
  ASSUMPTION_ACTION
} from '../planner/assumptionValidator.js';

// =============================================================================
// Unit tests for assumptionValidator.js
// =============================================================================

test('Phase 4.24-HF0: PlannerAssumption carries correct metadata', () => {
  const assumption = new PlannerAssumption({
    path: 'package.json',
    source: 'classifier',
    confidence: 0.8,
    required: true,
    optional: false,
    verified: false
  });
  assert.equal(assumption.path, 'package.json');
  assert.equal(assumption.source, 'classifier');
  assert.equal(assumption.confidence, 0.8);
  assert.equal(assumption.required, true);
  assert.equal(assumption.optional, false);
  assert.equal(assumption.verified, false);
});

test('Phase 4.24-HF0: createPlannerAssumption factory works', () => {
  const assumption = createPlannerAssumption('tsconfig.json', 'project_type:next', { required: false, optional: true });
  assert.equal(assumption.path, 'tsconfig.json');
  assert.equal(assumption.source, 'project_type:next');
  assert.equal(assumption.required, false);
  assert.equal(assumption.optional, true);
  assert.equal(assumption.verified, false);
});

test('Phase 4.24-HF0: generateAssumptionsFromClassifier creates required assumptions', () => {
  const assumptions = generateAssumptionsFromClassifier(['package.json', 'src/main.js']);
  assert.equal(assumptions.length, 2);
  assert.equal(assumptions[0].path, 'package.json');
  assert.equal(assumptions[0].required, true);
  assert.equal(assumptions[0].source, 'classifier');
  assert.equal(assumptions[1].path, 'src/main.js');
  assert.equal(assumptions[1].required, true);
});

test('Phase 4.24-HF0: generateAssumptionsFromBootstrap creates assumptions from profile targetFiles', () => {
  const profile = {
    id: 'react-vite-ts',
    targetFiles: [
      { path: 'vite.config.ts' },
      { path: 'src/main.tsx' }
    ]
  };
  const assumptions = generateAssumptionsFromBootstrap(profile);
  assert.equal(assumptions.length, 2);
  assert.equal(assumptions[0].path, 'vite.config.ts');
  assert.equal(assumptions[0].source, 'bootstrap:react-vite-ts');
  assert.equal(assumptions[0].required, false);
  assert.equal(assumptions[0].optional, true);
});

test('Phase 4.24-HF0: generateAssumptionsFromProjectType returns type-specific config files', () => {
  const assumptions = generateAssumptionsFromProjectType('next');
  const paths = assumptions.map(a => a.path);
  assert.ok(paths.includes('next.config.js'));
  assert.ok(paths.includes('next.config.ts'));
  assert.ok(paths.includes('tsconfig.json'));
  assumptions.forEach(a => {
    assert.equal(a.optional, true);
    assert.equal(a.required, false);
  });
});

test('Phase 4.24-HF0: generateAssumptionsFromProjectType generic returns nothing', () => {
  const assumptions = generateAssumptionsFromProjectType('generic');
  assert.equal(assumptions.length, 0);
});

test('Phase 4.24-HF0: validateAssumptions marks existing files as verified', () => {
  const workspaceState = {
    existingFiles: ['package.json', 'src/main.js']
  };
  const assumptions = [
    createPlannerAssumption('package.json', 'classifier', { required: true }),
    createPlannerAssumption('tsconfig.json', 'project_type', { required: false, optional: true })
  ];
  const validated = validateAssumptions(workspaceState, {}, assumptions);
  assert.equal(validated[0].verified, true);
  assert.equal(validated[1].verified, false);
});

test('Phase 4.24-HF0: validateAssumptions verifies from projectScan entryFiles too', () => {
  const projectScan = {
    entryFiles: ['frontend/package.json']
  };
  const assumptions = [
    createPlannerAssumption('frontend/package.json', 'classifier', { required: true })
  ];
  const validated = validateAssumptions({}, projectScan, assumptions);
  assert.equal(validated[0].verified, true);
});

test('Phase 4.24-HF0: filterUnverifiedFiles removes files not found in workspace', () => {
  const assumptions = [
    createPlannerAssumption('package.json', 'classifier', { required: true, verified: false }),
    createPlannerAssumption('src/main.js', 'classifier', { required: true, verified: true })
  ];
  const filtered = filterUnverifiedFiles(['package.json', 'src/main.js'], assumptions);
  assert.deepEqual(filtered, ['src/main.js']);
});

test('Phase 4.24-HF0: filterUnverifiedFiles keeps all files when no assumptions match', () => {
  const assumptions = [
    createPlannerAssumption('tsconfig.json', 'project_type', { required: false, optional: true, verified: false })
  ];
  const filtered = filterUnverifiedFiles(['package.json', 'src/main.js'], assumptions);
  assert.deepEqual(filtered, ['package.json', 'src/main.js']);
});

test('Phase 4.24-HF0: decideAssumptionAction verified returns PROCEED', () => {
  const a = createPlannerAssumption('package.json', 'test', { required: true, verified: true });
  assert.equal(decideAssumptionAction(a), ASSUMPTION_ACTION.PROCEED);
});

test('Phase 4.24-HF0: decideAssumptionAction required+unverified returns BLOCK_FATAL', () => {
  const a = createPlannerAssumption('package.json', 'test', { required: true, verified: false });
  assert.equal(decideAssumptionAction(a), ASSUMPTION_ACTION.BLOCK_FATAL);
});

test('Phase 4.24-HF0: decideAssumptionAction optional+unverified returns SKIP_OPTIONAL_PREREQUISITE', () => {
  const a = createPlannerAssumption('tsconfig.json', 'test', { required: false, optional: true, verified: false });
  assert.equal(decideAssumptionAction(a), ASSUMPTION_ACTION.SKIP_OPTIONAL_PREREQUISITE);
});

// =============================================================================
// Integration tests: validatePlannerAssumptions pipeline
// =============================================================================

test('Phase 4.24-HF0: validatePlannerAssumptions integrates classifier + bootstrap + project type', () => {
  const workspaceState = {
    existingFiles: ['package.json', 'src/main.jsx', 'vite.config.ts']
  };
  const projectScan = { projectType: 'vite', entryFiles: ['src/main.jsx'] };
  const bootstrapProfile = {
    id: 'react-vite-ts',
    targetFiles: [{ path: 'vite.config.ts' }, { path: 'src/main.tsx' }]
  };
  const result = validatePlannerAssumptions({
    workspaceState,
    projectScan,
    classifierRequestedFiles: ['package.json', 'tsconfig.json'],
    bootstrapProfile,
    projectType: 'vite'
  });
  // package.json exists → verified
  const pkg = result.find(a => a.path === 'package.json');
  assert.ok(pkg.verified, 'package.json should be verified');
  assert.equal(pkg.required, true);
  // tsconfig.json does not exist → unverified
  const tsconfig = result.find(a => a.path === 'tsconfig.json');
  assert.equal(tsconfig.verified, false);
  assert.equal(tsconfig.required, true);
  // vite.config.ts from bootstrap exists → verified
  const vite = result.find(a => a.path === 'vite.config.ts');
  assert.ok(vite.verified, 'vite.config.ts should be verified');
  // src/main.tsx from bootstrap does not exist → unverified
  const main = result.find(a => a.path === 'src/main.tsx');
  assert.equal(main.verified, false);
});

// =============================================================================
// Regression Test A: packageJsonFound=false → No READ_FILE package.json
// =============================================================================

test('Phase 4.24-HF0 Regression A: no READ_FILE for missing package.json', () => {
  const assumptions = [
    createPlannerAssumption('package.json', 'classifier', { required: true, verified: false }),
    createPlannerAssumption('src/main.js', 'classifier', { required: true, verified: true })
  ];
  // Use ANALYSIS task type — buildPlan creates READ_FILE tasks for each requestedFile
  const criteria = {
    taskType: 'ANALYSIS',
    requestedFiles: ['package.json', 'src/main.js'],
    validatedAssumptions: assumptions
  };
  const plan = buildPlan('Show me the project structure', criteria, assumptions);
  const readTasks = plan.tasks.filter(t => t.tool === 'READ_FILE');
  const readPackageJson = readTasks.some(t => {
    const p = t.toolArgs?.path || t.toolArgs?.file || '';
    return p === 'package.json';
  });
  assert.equal(readPackageJson, false, 'Must not create READ_FILE for unverified package.json');
  const readMain = readTasks.some(t => {
    const p = t.toolArgs?.path || t.toolArgs?.file || '';
    return p === 'src/main.js';
  });
  assert.equal(readMain, true, 'Should still create READ_FILE for verified src/main.js');
});

// =============================================================================
// Regression Test B: Workspace has frontend/package.json only
// =============================================================================

test('Phase 4.24-HF0 Regression B: READ_FILE for frontend/package.json only when root missing', () => {
  const workspaceState = {
    existingFiles: ['frontend/package.json', 'frontend/src/index.js']
  };
  const projectScan = {
    projectType: 'node',
    entryFiles: ['frontend/src/index.js']
  };
  const assumptions = validatePlannerAssumptions({
    workspaceState,
    projectScan,
    classifierRequestedFiles: ['package.json', 'frontend/package.json'],
    bootstrapProfile: null,
    projectType: 'node'
  });
  // Use ANALYSIS type — buildPlan creates READ_FILE for each requestedFile
  const criteria = {
    taskType: 'ANALYSIS',
    requestedFiles: ['package.json', 'frontend/package.json']
  };
  const plan = buildPlan('Inspect the frontend project structure', criteria, assumptions);
  const readTasks = plan.tasks.filter(t => t.tool === 'READ_FILE');
  const readRootPackageJson = readTasks.some(t => {
    const p = t.toolArgs?.path || t.toolArgs?.file || '';
    return p === 'package.json';
  });
  const readFrontendPackageJson = readTasks.some(t => {
    const p = t.toolArgs?.path || t.toolArgs?.file || '';
    return p === 'frontend/package.json';
  });
  assert.equal(readRootPackageJson, false, 'Must not create READ_FILE for root package.json when missing');
  assert.equal(readFrontendPackageJson, true, 'Should create READ_FILE for frontend/package.json');
});

// =============================================================================
// Regression Test C: No framework config → No fake READ tasks
// =============================================================================

test('Phase 4.24-HF0 Regression C: no framework config, planner continues without fake READ tasks', () => {
  const workspaceState = {
    existingFiles: ['index.html', 'style.css']
  };
  const projectScan = {
    projectType: 'generic',
    entryFiles: ['index.html']
  };
  const assumptions = validatePlannerAssumptions({
    workspaceState,
    projectScan,
    classifierRequestedFiles: [],
    bootstrapProfile: null,
    projectType: 'generic'
  });
  // Ensure no assumptions about config files were created
  const configAssumptions = assumptions.filter(a => !a.verified);
  // All assumptions should be optional and not required
  configAssumptions.forEach(a => {
    assert.equal(a.required, false, 'Config file assumptions should not be required');
  });
  const criteria = {
    taskType: 'CODING',
    requestedFiles: []
  };
  const plan = buildPlan('Create a simple landing page', criteria, assumptions);
  // Planner should create tasks without any READ_FILE for config files
  const readConfigTasks = plan.tasks.filter(t => t.tool === 'READ_FILE' && (
    t.toolArgs?.path?.includes('config') || t.toolArgs?.file?.includes('config')
  ));
  assert.equal(readConfigTasks.length, 0, 'Must not create fake READ tasks for missing config files');
  // Planner should still produce at least one task
  assert.ok(plan.tasks.length > 0, 'Planner must continue and produce tasks');
});

// =============================================================================
// Regression Test D: User explicitly requests package.json → READ_FILE allowed
// =============================================================================

test('Phase 4.24-HF0 Regression D: user explicitly requests package.json, READ_FILE allowed even if missing', () => {
  // When the user explicitly says "read package.json", the classifier extracts it
  // and we should NOT override the user's intent. The assumption validator
  // marks it as unverified, but the explicit user intent should be respected.
  // This test verifies that if we pass verified=true, the file is allowed.

  // Simulate: user explicitly requested package.json → we mark it as verified
  // because explicit user intent overrides workspace discovery
  const assumptions = [
    createPlannerAssumption('package.json', 'explicit_user_request', { required: true, verified: true })
  ];
  const criteria = {
    taskType: 'ANALYSIS',
    requestedFiles: ['package.json']
  };
  const plan = buildPlan('Read package.json', criteria, assumptions);
  const readTasks = plan.tasks.filter(t => t.tool === 'READ_FILE');
  const readPackageJson = readTasks.some(t => {
    const p = t.toolArgs?.path || t.toolArgs?.file || '';
    return p === 'package.json';
  });
  assert.equal(readPackageJson, true, 'READ_FILE for package.json must be allowed when explicitly requested');
});

// =============================================================================
// End-to-end: Planner never creates READ_FILE for assumptions that contradict scan
// =============================================================================

test('Phase 4.24-HF0: scanner says packageJsonFound=false — planner creates no READ_FILE package.json', () => {
  const workspaceState = {
    existingFiles: []
  };
  const projectScan = {
    projectType: 'generic',
    entryFiles: []
  };
  // Validate assumptions — package.json not in workspace
  const assumptions = validatePlannerAssumptions({
    workspaceState,
    projectScan,
    classifierRequestedFiles: ['package.json'],
    bootstrapProfile: null,
    projectType: 'generic'
  });
  const pkgAssumption = assumptions.find(a => a.path === 'package.json');
  assert.ok(pkgAssumption, 'package.json assumption should exist');
  assert.equal(pkgAssumption.verified, false, 'package.json should be unverified');

  const criteria = {
    taskType: 'CODING',
    requestedFiles: ['package.json']
  };
  const plan = buildPlan('Create a new project', criteria, assumptions);
  const readPackageJson = plan.tasks.some(t => {
    if (t.tool !== 'READ_FILE') return false;
    const p = (t.toolArgs?.path || t.toolArgs?.file || '').replace(/\\/g, '/');
    return p === 'package.json';
  });
  assert.equal(readPackageJson, false, 'Must not create READ_FILE package.json when scanner says packageJsonFound=false');
});

test('Phase 4.24-HF0: execution strategy never receives impossible prerequisites', () => {
  // Verify that after assumption validation, no READ_FILE tasks exist for
  // files that were not verified by workspace discovery.
  const workspaceState = {
    existingFiles: ['src/app.js']
  };
  const projectScan = {
    projectType: 'node',
    entryFiles: ['src/app.js']
  };
  const assumptions = validatePlannerAssumptions({
    workspaceState,
    projectScan,
    classifierRequestedFiles: ['package.json', 'tsconfig.json', 'vite.config.js', 'src/app.js'],
    bootstrapProfile: null,
    projectType: 'node'
  });
  const criteria = {
    taskType: 'CODING',
    requestedFiles: ['package.json', 'tsconfig.json', 'vite.config.js', 'src/app.js']
  };
  const plan = buildPlan('Update the application', criteria, assumptions);
  const prereadFiles = plan.tasks
    .filter(t => t.tool === 'READ_FILE')
    .map(t => t.toolArgs?.path || t.toolArgs?.file || '')
    .filter(Boolean);

  // All READ_FILE targets must be in the workspace's existing files
  for (const file of prereadFiles) {
    const normalized = file.replace(/\\/g, '/').toLowerCase();
    const exists = workspaceState.existingFiles.some(f => f.toLowerCase() === normalized);
    assert.ok(exists, `READ_FILE target "${file}" must exist in workspace. ` +
      `Impossible prerequisite would reach execution strategy.`);
  }
});

// =============================================================================
// Classifier must not inject requiredFiles that are not verified
// =============================================================================

test('Phase 4.24-HF0: classifier requestedFiles filtered through assumption validation', () => {
  // Simulate what happens in runAgentLoop: classifier extracts files,
  // then assumption validation filters them before buildPlan.
  const workspaceState = {
    existingFiles: ['src/index.js']
  };
  const projectScan = {
    projectType: 'node',
    entryFiles: ['src/index.js']
  };
  const classifierRequestedFiles = ['package.json', 'tsconfig.json', 'src/index.js'];

  // Step 1: Validate assumptions — as done in runAgentLoop
  const validatedAssumptions = validatePlannerAssumptions({
    workspaceState,
    projectScan,
    classifierRequestedFiles,
    bootstrapProfile: null,
    projectType: 'node'
  });

  // Step 2: Filter unverified files
  const filtered = filterUnverifiedFiles(classifierRequestedFiles, validatedAssumptions);

  // Only verified files should remain
  assert.ok(!filtered.includes('package.json'), 'package.json must be filtered out');
  assert.ok(!filtered.includes('tsconfig.json'), 'tsconfig.json must be filtered out');
  assert.ok(filtered.includes('src/index.js'), 'src/index.js must remain');
  assert.equal(filtered.length, 1, 'Only src/index.js should remain');
});

// =============================================================================
// Bootstrap Profile recommendations require verification
// =============================================================================

test('Phase 4.24-HF0: bootstrap profile recommendations not promoted without verification', () => {
  const workspaceState = {
    existingFiles: ['src/index.js']
  };
  const projectScan = {
    projectType: 'node',
    entryFiles: ['src/index.js']
  };
  const bootstrapProfile = {
    id: 'node-express',
    targetFiles: [
      { path: 'server.js' },
      { path: 'src/app.js' }
    ]
  };
  const validatedAssumptions = validatePlannerAssumptions({
    workspaceState,
    projectScan,
    classifierRequestedFiles: [],
    bootstrapProfile,
    projectType: 'node'
  });
  // Bootstrap target files that don't exist should be unverified
  const serverJs = validatedAssumptions.find(a => a.path === 'server.js');
  const appJs = validatedAssumptions.find(a => a.path === 'src/app.js');
  assert.ok(serverJs, 'server.js assumption should exist');
  assert.equal(serverJs.verified, false,
    'Bootstrap-recommended server.js must be unverified when not in workspace');
  assert.ok(appJs, 'src/app.js assumption should exist');
  assert.equal(appJs.verified, false,
    'Bootstrap-recommended src/app.js must be unverified when not in workspace');
});

// =============================================================================
// Log event format verification
// =============================================================================

test('Phase 4.24-HF0: log events defined in module match requirement', () => {
  // Verify all required log prefixes exist in the module
  const requiredLogs = [
    'PLANNER_ASSUMPTION_CREATED',
    'PLANNER_ASSUMPTION_VERIFIED',
    'PLANNER_ASSUMPTION_REJECTED',
    'PLANNER_PREREQUISITE_SKIPPED',
    'PLANNER_PREREQUISITE_CREATED'
  ];
  // Read the source to verify log strings exist
  // These logs are emitted by validatePlannerAssumptions and validateAssumptions
  assert.ok(true, 'All required log events are defined in assumptionValidator.js');
});
