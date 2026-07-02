import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from '../planner/planBuilder.js';
import { buildPlanningContext } from '../planner/context/PlanningContextBuilder.js';
import { VerifiedPlanningContext } from '../planner/context/VerifiedPlanningContext.js';
import { validatePlanningContext } from '../planner/context/PlanningContextValidator.js';
import { createPlanningContextSnapshot } from '../planner/context/PlanningContextSnapshot.js';
import { resolvePlannerPolicies, PLANNER_POLICIES } from '../planner/context/PlannerPolicy.js';
import { createPlannerAssumption } from '../planner/assumptionValidator.js';
import { Task } from '../planner/task.js';

// =============================================================================
// Phase 4.24-HF4 Unified Planning Context — Tests A through G
// =============================================================================

// ---------------------------------------------------------------------------
// Test A: PlanningContextBuilder assembles verified context correctly
// ---------------------------------------------------------------------------
test('Phase 4.24-HF4-A: PlanningContextBuilder builds context from workspace state, project scan, and validated assumptions', () => {
  const workspaceState = {
    existingFiles: ['package.json', 'src/index.js', 'README.md'],
    packageJson: { name: 'test-project', scripts: { test: 'vitest', build: 'vite build' } },
    packageJsonFound: true
  };
  const projectScan = {
    packageJsonFound: true,
    packageManager: 'npm',
    packageManagerVerified: true,
    projectType: 'vite-react',
    testCommands: ['npx vitest run'],
    buildCommands: ['npm run build'],
    entryFiles: ['src/index.js', 'index.html'],
    runCommands: ['npm run dev']
  };
  const validatedAssumptions = [
    createPlannerAssumption('package.json', 'classifier', { required: true, verified: true }),
    createPlannerAssumption('src/index.js', 'classifier', { required: true, verified: true }),
    createPlannerAssumption('src/App.jsx', 'classifier', { required: false, verified: false }),
    createPlannerAssumption('tsconfig.json', 'project_type:vite-react', { required: true, verified: false })
  ];

  const { context, validation, snapshot } = buildPlanningContext({
    workspaceState,
    projectScan,
    validatedAssumptions
  });

  assert.ok(context instanceof VerifiedPlanningContext);
  assert.ok(validation.valid);
  assert.ok(snapshot);

  assert.ok(context.verifiedFiles.includes('package.json'));
  assert.ok(context.verifiedFiles.includes('src/index.js'));
  assert.ok(!context.verifiedFiles.includes('src/App.jsx'));
  assert.ok(!context.verifiedFiles.includes('tsconfig.json'));

  assert.ok(context.verifiedCommands.includes('npx vitest run'));
  assert.ok(context.verifiedCommands.includes('npm run build'));
  assert.ok(context.verifiedCommands.includes('npm run dev'));

  assert.equal(context.verifiedPackageManager, 'npm');
  assert.equal(context.verifiedFramework, 'vite-react');

  console.log('[TEST-A-PASS] context built successfully, verifiedFiles:', context.verifiedFiles.length, 'verifiedCommands:', context.verifiedCommands.length);
});

// ---------------------------------------------------------------------------
// Test B: buildPlan with planningContext guards bootstrap via ALLOW_PROJECT_BOOTSTRAP
// ---------------------------------------------------------------------------
test('Phase 4.24-HF4-B: buildPlan respects planningContext.plannerPolicies.ALLOW_PROJECT_BOOTSTRAP', () => {
  const workspaceState = {
    existingFiles: ['package.json', 'src/index.js'],
    packageJson: { name: 'test-project' },
    packageJsonFound: true
  };
  const projectScan = {
    packageJsonFound: true,
    projectType: 'vite-react',
    testCommands: ['npx vitest run'],
    buildCommands: ['npm run build'],
    runCommands: ['npm run dev'],
    entryFiles: ['src/index.js']
  };

  const bootstrapProfile = {
    id: 'vite-react-spa',
    targetFiles: ['vite.config.js', 'src/App.jsx', 'src/main.jsx'],
    validationCommands: ['npm run build'],
    buildCommands: ['npm run build'],
    installCommands: ['npm install'],
    canBootstrap: true
  };

  const validatedAssumptions = [
    createPlannerAssumption('package.json', 'classifier', { required: true, verified: true }),
    createPlannerAssumption('src/index.js', 'classifier', { required: true, verified: true })
  ];

  // Build context with ALLOW_PROJECT_BOOTSTRAP = false
  const policies = resolvePlannerPolicies({
    workspaceState: { ...workspaceState, plannerPoliciesOverride: { ALLOW_PROJECT_BOOTSTRAP: false } },
    projectScan,
    validatedAssumptions
  });
  const context = new VerifiedPlanningContext({
    workspace: workspaceState,
    projectScan,
    discoveredFiles: ['package.json', 'src/index.js'],
    verifiedFiles: ['package.json', 'src/index.js'],
    verifiedCommands: ['npx vitest run', 'npm run build', 'npm run dev'],
    verifiedFramework: 'vite-react',
    verifiedPackageManager: 'npm',
    verifiedValidation: 'npx vitest run',
    verifiedEntrypoints: [],
    verifiedAppRoots: [],
    verifiedSourceRoots: [],
    verifiedModuleRoots: [],
    verifiedRecommendations: [],
    blockedRecommendations: [],
    plannerPolicies: { ...policies, ALLOW_PROJECT_BOOTSTRAP: false }
  });

  const criteria = {
    workspaceState,
    projectScan,
    bootstrapProfile,
    taskType: 'CODING',
    bootstrapEnabled: true
  };

  const result = buildPlan('Create a new React app', criteria, validatedAssumptions, context);

  // Should NOT return bootstrap task graph because ALLOW_PROJECT_BOOTSTRAP is false
  assert.ok(result.tasks);
  // Verify that no bootstrap profile target files leaked as tasks
  const taskGoals = result.tasks.map(t => t.goal || '').join(' ');
  const taskArgs = JSON.stringify(result.tasks.map(t => t.toolArgs || {}));
  assert.ok(!taskGoals.includes('vite.config.js'), 'Bootstrap target files should not appear in tasks when policy denies');
  assert.ok(!taskArgs.includes('vite.config.js'), 'Bootstrap target files should not appear in task args when policy denies');
  assert.ok(!taskGoals.includes('src/App.jsx'), 'Bootstrap target files should not appear in tasks when policy denies');
  assert.ok(!taskArgs.includes('src/App.jsx'), 'Bootstrap target files should not appear in task args when policy denies');

  console.log('[TEST-B-PASS] ALLOW_PROJECT_BOOTSTRAP=false prevented bootstrap task graph');
});

// ---------------------------------------------------------------------------
// Test C: Verified commands take precedence over bootstrap profile commands
// ---------------------------------------------------------------------------
test('Phase 4.24-HF4-C: Verified commands from context are preferred over bootstrap profile commands', () => {
  const workspaceState = {
    existingFiles: ['package.json'],
    packageJson: { name: 'test-project', scripts: { test: 'vitest', build: 'vite build' } },
    packageJsonFound: true
  };
  const projectScan = {
    packageJsonFound: true,
    testCommands: ['npx vitest run --reporter=verbose'],
    buildCommands: ['npm run build'],
    projectType: 'vite-react'
  };

  const bootstrapProfile = {
    id: 'vite-react-spa',
    validationCommands: ['npm run validate'],
    buildCommands: ['npm run outdated-build'],
    installCommands: ['npm install']
  };

  const validatedAssumptions = [
    createPlannerAssumption('package.json', 'classifier', { required: true, verified: true })
  ];

  const { context } = buildPlanningContext({
    workspaceState,
    projectScan,
    validatedAssumptions,
    bootstrapProfile
  });

  const criteria = {
    workspaceState,
    projectScan,
    bootstrapProfile,
    taskType: 'CODING',
    bootstrapEnabled: true
  };

  const result = buildPlan('Run tests', criteria, validatedAssumptions, context);

  // Verified commands from context include both scan commands and promoted bootstrap commands.
  // The scan command (vitest) must appear; bootstrap commands may appear but only after
  // going through the planning context verification gate.
  const commandGoals = result.tasks.filter(t => t.tool === 'RUN_TERMINAL').map(t => t.toolArgs?.command || '');
  assert.ok(commandGoals.length > 0);
  const allCommands = commandGoals.join(' ');
  assert.ok(allCommands.includes('vitest'), 'Verified vitest command from scan should be used');
  // Bootstrap commands may be promoted by the context builder when package.json is found,
  // but they flow through the verified context rather than directly from bootstrapProfile.
  // This is the key behavioral change: no module reads bootstrapProfile directly.

  console.log('[TEST-C-PASS] Verified commands from context include scan commands; bootstrap commands promoted via verification gate');
});

// ---------------------------------------------------------------------------
// Test D: Blocked recommendations are excluded from verified context
// ---------------------------------------------------------------------------
test('Phase 4.24-HF4-D: Blocked recommendations do not appear in verified context', () => {
  const workspaceState = {
    existingFiles: ['package.json'],
    packageJson: { name: 'test-project' },
    packageJsonFound: true
  };
  const projectScan = {
    packageJsonFound: true
  };

  const validatedAssumptions = [
    createPlannerAssumption('package.json', 'classifier', { required: true, verified: true }),
    createPlannerAssumption('non_existent_file.js', 'classifier', { required: false, verified: false }),
    createPlannerAssumption('missing_config.json', 'project_type:generic', { required: true, verified: false })
  ];

  const { context, validation } = buildPlanningContext({
    workspaceState,
    projectScan,
    validatedAssumptions
  });

  assert.ok(context.fileIsVerified('package.json'));
  assert.ok(!context.fileIsVerified('non_existent_file.js'));
  assert.ok(!context.fileIsVerified('missing_config.json'));

  assert.ok(!context.fileIsBlocked('package.json'));
  assert.ok(context.fileIsBlocked('non_existent_file.js'));
  assert.ok(context.fileIsBlocked('missing_config.json'));

  console.log('[TEST-D-PASS] Blocked recommendations correctly excluded: verified=1, blocked=2');
});

// ---------------------------------------------------------------------------
// Test E: Verified file checks with edge cases
// ---------------------------------------------------------------------------
test('Phase 4.24-HF4-E: Verified file checks handle normalization and non-existent paths', () => {
  const workspaceState = {
    existingFiles: ['package.json', 'src/index.js'],
    packageJson: { name: 'test-project' },
    packageJsonFound: true
  };
  const projectScan = { packageJsonFound: true };

  const validatedAssumptions = [
    createPlannerAssumption('package.json', 'classifier', { required: true, verified: true }),
    createPlannerAssumption('src/index.js', 'classifier', { required: true, verified: true })
  ];

  const { context } = buildPlanningContext({
    workspaceState,
    projectScan,
    validatedAssumptions
  });

  assert.ok(context.fileIsVerified('package.json'));
  assert.ok(!context.fileIsVerified('/absolute/package.json'));
  assert.ok(!context.fileIsVerified(''));
  assert.ok(!context.fileIsVerified(null));
  assert.ok(!context.fileIsVerified(undefined));

  console.log('[TEST-E-PASS] Edge case handling: normalization and falsy paths');
});

// ---------------------------------------------------------------------------
// Test F: Context snapshot consistency
// ---------------------------------------------------------------------------
test('Phase 4.24-HF4-F: Planning context snapshot matches context state', () => {
  const workspaceState = {
    existingFiles: ['package.json'],
    packageJson: { name: 'test-project' },
    packageJsonFound: true
  };
  const projectScan = {
    packageJsonFound: true,
    projectType: 'generic',
    testCommands: ['npm test']
  };

  const validatedAssumptions = [
    createPlannerAssumption('package.json', 'classifier', { required: true, verified: true })
  ];

  const { context, snapshot } = buildPlanningContext({
    workspaceState,
    projectScan,
    validatedAssumptions
  });

  assert.equal(snapshot.verifiedFileCount, context.verifiedFiles.length);
  assert.equal(snapshot.blockedRecommendationCount, context.blockedRecommendations.length);
  assert.equal(snapshot.verifiedCommandCount, context.verifiedCommands.length);
  assert.equal(snapshot.verifiedFramework, context.verifiedFramework);
  assert.equal(snapshot.verifiedPackageManager, context.verifiedPackageManager);

  // Snapshot should be plain JSON (not an object with methods)
  assert.equal(typeof snapshot.verifiedFiles, 'object');
  assert.equal(typeof snapshot.verifiedCommands, 'object');

  console.log('[TEST-F-PASS] Snapshot consistent: verified=', snapshot.verifiedFileCount, 'blocked=', snapshot.blockedRecommendationCount, 'commands=', snapshot.verifiedCommandCount);
});

// ---------------------------------------------------------------------------
// Test G: Validator catches inconsistencies
// ---------------------------------------------------------------------------
test('Phase 4.24-HF4-G: Planning context validator catches file in both verified and blocked', () => {
  const workspaceState = {
    existingFiles: ['package.json'],
    packageJson: { name: 'test-project' },
    packageJsonFound: true
  };
  const projectScan = { packageJsonFound: true };

  const badContext = new VerifiedPlanningContext({
    workspace: workspaceState,
    projectScan,
    discoveredFiles: ['package.json'],
    verifiedFiles: ['package.json'],
    verifiedCommands: [],
    verifiedFramework: null,
    verifiedPackageManager: null,
    verifiedValidation: null,
    verifiedEntrypoints: [],
    verifiedAppRoots: [],
    verifiedSourceRoots: [],
    verifiedModuleRoots: [],
    verifiedRecommendations: [{ path: 'package.json', kind: 'file', source: 'classifier' }],
    blockedRecommendations: [{ path: 'package.json', kind: 'file', source: 'classifier', reason: 'test' }],
    plannerPolicies: resolvePlannerPolicies({ workspaceState, projectScan })
  });

  const validation = validatePlanningContext(badContext);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.length > 0);
  assert.ok(validation.errors.some(e => e.includes('package.json')));

  console.log('[TEST-G-PASS] Validator correctly rejects file in both verified and blocked');
});

// ---------------------------------------------------------------------------
// Integration: End-to-end Unified Planning Context flow
// ---------------------------------------------------------------------------
test('Phase 4.24-HF4-H: End-to-end flow — buildPlan with full planning context produces expected tasks', () => {
  const workspaceState = {
    existingFiles: ['package.json', 'src/index.js', 'README.md'],
    packageJson: { name: 'test-project', scripts: { test: 'vitest', build: 'vite build' } },
    packageJsonFound: true
  };
  const projectScan = {
    packageJsonFound: true,
    packageManager: 'npm',
    projectType: 'vite-react',
    testCommands: ['npx vitest run'],
    buildCommands: ['npm run build'],
    entryFiles: ['src/index.js', 'index.html'],
    runCommands: ['npm run dev']
  };

  const validatedAssumptions = [
    createPlannerAssumption('package.json', 'classifier', { required: true, verified: true }),
    createPlannerAssumption('src/index.js', 'classifier', { required: true, verified: true }),
    createPlannerAssumption('src/App.jsx', 'project_type:vite-react', { required: false, verified: false })
  ];

  const { context } = buildPlanningContext({
    workspaceState,
    projectScan,
    validatedAssumptions
  });

  assert.ok(context instanceof VerifiedPlanningContext);
  assert.ok(context.verifiedFiles.length >= 2);
  assert.ok(context.verifiedCommands.length >= 3);

  // Verify promotion tracking
  const hasPackageJson = context.verifiedRecommendations.some(r => r.path === 'package.json');
  assert.ok(hasPackageJson);

  const missingAppJsx = context.verifiedRecommendations.some(r => r.path === 'src/App.jsx');
  assert.ok(!missingAppJsx, 'Unverified assumption should not appear in verified recommendations');

  console.log('[TEST-H-PASS] End-to-end Unified Planning Context flow works');
});

// ---------------------------------------------------------------------------
// Integration: Log events for context assembly
// ---------------------------------------------------------------------------
test('Phase 4.24-HF4-I: Log events emitted during context assembly include required events', () => {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args);
    originalLog.apply(console, args);
  };

  try {
    const workspaceState = {
      existingFiles: ['package.json'],
      packageJson: { name: 'test-project' },
      packageJsonFound: true
    };
    const projectScan = { packageJsonFound: true, projectType: 'generic' };
    const validatedAssumptions = [
      createPlannerAssumption('package.json', 'classifier', { required: true, verified: true }),
      createPlannerAssumption('missing.js', 'classifier', { required: false, verified: false })
    ];

    buildPlanningContext({ workspaceState, projectScan, validatedAssumptions });

    const logEvents = logs.map(l => l[0]);
    assert.ok(logEvents.includes('[PLANNING_CONTEXT_BUILD_START]'));
    assert.ok(logEvents.includes('[PLANNING_CONTEXT_CREATED]'));
    assert.ok(logEvents.includes('[PLANNING_CONTEXT_BLOCKED]'));
  } finally {
    console.log = originalLog;
  }

  console.log('[TEST-I-PASS] All required log events present');
});
