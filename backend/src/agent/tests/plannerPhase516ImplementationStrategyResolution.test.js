import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectScanSnapshot } from '../context/ProjectScanSnapshot.js';
import { buildPlanningContext } from '../planner/context/PlanningContextBuilder.js';
import { mapRequirementsToWorkspace } from '../planning/workspaceMapper.js';
import { resolveImplementationStrategy } from '../planning/implementationStrategy/implementationStrategyResolver.js';

function captureLogs() {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.map(item => {
      if (typeof item === 'string') return item;
      try {
        return JSON.stringify(item);
      } catch {
        return String(item);
      }
    }).join(' '));
  };
  return {
    logs,
    restore() {
      console.log = originalLog;
    }
  };
}

function makeScan({
  projectType = 'generic',
  files = []
} = {}) {
  return createProjectScanSnapshot({
    workspaceRoot: 'G:/langtuvn/ai_local',
    projectType,
    packageJsonFound: files.includes('package.json'),
    packageJsonPath: files.includes('package.json') ? 'package.json' : null,
    entryFiles: files.filter(file => /(^|\/)(src\/main|src\/app|app\/page)\.(tsx|jsx|ts|js)|index\.html$/i.test(file)),
    styleFiles: files.filter(file => /\.(css|scss|sass|less)$/i.test(file)),
    discoveredFiles: files
  });
}

function makeRequirement(capability = 'APPLICATION_ENTRY') {
  return {
    id: `requirement:${capability.toLowerCase()}`,
    capability,
    artifactType: 'source',
    purpose: capability,
    required: true,
    source: 'objective_semantic',
    confidence: 0.9
  };
}

test('Phase 5.16: empty React workspace creates alternatives and selects React + Custom', () => {
  const { logs, restore } = captureLogs();
  try {
    const scan = makeScan({ projectType: 'generic', files: [] });
    const planningContext = buildPlanningContext({
      workspaceState: {
        workspaceRoot: 'G:/langtuvn/ai_local',
        existingFiles: []
      },
      projectScan: scan,
      projectIntent: {
        prompt: 'Create a React landing page',
        objective: 'Create a React landing page',
        goalType: 'LANDING_PAGE'
      },
      validatedAssumptions: []
    }).context;

    assert.ok(Array.isArray(planningContext.implementationStrategies));
    assert.ok(planningContext.implementationStrategies.length > 0);
    assert.ok(Array.isArray(planningContext.implementationVariants));
    assert.ok(planningContext.implementationVariants.length > 0);
    assert.ok(planningContext.selectedImplementation);
    assert.equal(planningContext.selectedImplementation.selectedVariant.frameworkKey, 'react-custom');
    assert.ok(logs.some(line => line.includes('[IMPLEMENTATION_STRATEGY_START]')));
    assert.ok(logs.some(line => line.includes('[IMPLEMENTATION_ALTERNATIVES_CREATED]')));
    assert.ok(logs.some(line => line.includes('[IMPLEMENTATION_VARIANT_SELECTED]')));
    assert.ok(logs.some(line => line.includes('[IMPLEMENTATION_VARIANT_GRAPH_CREATED]')));
    assert.ok(logs.some(line => line.includes('[IMPLEMENTATION_STRATEGY_COMPLETE]')));
  } finally {
    restore();
  }
});

test('Phase 5.16: explicit React + Custom objective selects React + Custom', () => {
  const scan = makeScan({ projectType: 'generic', files: [] });
  const planningContext = buildPlanningContext({
    workspaceState: {
      workspaceRoot: 'G:/langtuvn/ai_local',
      existingFiles: []
    },
    projectScan: scan,
    projectIntent: {
      prompt: 'Create a React landing page with a custom implementation',
      objective: 'Create a React landing page with a custom implementation',
      goalType: 'LANDING_PAGE'
    },
    validatedAssumptions: []
  }).context;

  const resolution = resolveImplementationStrategy({
    objective: 'Create a React landing page with a custom implementation',
    requirements: [makeRequirement('APPLICATION_ENTRY')],
    objectiveConstraints: [],
    planningStrategies: [],
    initializationStrategies: [],
    planningContext,
    projectScanSnapshot: scan,
    projectIntent: {
      prompt: 'Create a React landing page with a custom implementation',
      objective: 'Create a React landing page with a custom implementation'
    }
  });

  assert.ok(resolution.validation.valid);
  assert.ok(resolution.selectedImplementation);
  assert.equal(resolution.selectedImplementation.selectedVariant.frameworkKey, 'react-custom');
});

test('Phase 5.16: existing Next.js workspace selects React + Next and maps to Next files', () => {
  const scan = makeScan({
    projectType: 'next',
    files: ['package.json', 'app/layout.tsx', 'app/page.tsx', 'next.config.js']
  });
  const planningContext = buildPlanningContext({
    workspaceState: {
      workspaceRoot: 'G:/langtuvn/ai_local',
      existingFiles: scan.discoveredFiles
    },
    projectScan: scan,
    projectIntent: {
      prompt: 'Create a React dashboard',
      objective: 'Create a React dashboard',
      goalType: 'DASHBOARD'
    },
    validatedAssumptions: []
  }).context;

  assert.equal(planningContext.selectedImplementation.selectedVariant.frameworkKey, 'nextjs-ts');

  const mapping = mapRequirementsToWorkspace({
    requirements: [makeRequirement('APPLICATION_ENTRY')],
    planningContext,
    projectScanSnapshot: scan,
    projectIntent: {
      prompt: 'Create a React dashboard',
      objective: 'Create a React dashboard'
    },
    objective: 'Create a React dashboard'
  });

  assert.equal(mapping.mappedArtifacts[0].path, 'app/page.tsx');
  assert.equal(mapping.requiredFramework, 'nextjs-ts');
  assert.equal(mapping.mappedArtifacts.some(artifact => artifact.path === 'vite.config.ts'), false);
});

test('Phase 5.16: existing Astro workspace selects Astro React Integration', () => {
  const scan = makeScan({
    projectType: 'astro',
    files: ['package.json', 'src/pages/index.astro', 'astro.config.mjs', 'src/styles/global.css']
  });
  const planningContext = buildPlanningContext({
    workspaceState: {
      workspaceRoot: 'G:/langtuvn/ai_local',
      existingFiles: scan.discoveredFiles
    },
    projectScan: scan,
    projectIntent: {
      prompt: 'Create a React landing page',
      objective: 'Create a React landing page',
      goalType: 'LANDING_PAGE'
    },
    validatedAssumptions: []
  }).context;

  assert.equal(planningContext.selectedImplementation.selectedVariant.frameworkKey, 'astro-react');

  const mapping = mapRequirementsToWorkspace({
    requirements: [makeRequirement('APPLICATION_ENTRY')],
    planningContext,
    projectScanSnapshot: scan,
    projectIntent: {
      prompt: 'Create a React landing page',
      objective: 'Create a React landing page'
    },
    objective: 'Create a React landing page'
  });

  assert.equal(mapping.mappedArtifacts[0].path, 'src/pages/index.astro');
  assert.equal(mapping.mappedArtifacts.some(artifact => artifact.path === 'vite.config.ts'), false);
});

test('Phase 5.16: existing Laravel workspace selects Laravel React Integration', () => {
  const scan = makeScan({
    projectType: 'laravel',
    files: ['artisan', 'routes/web.php', 'resources/views/welcome.blade.php', 'resources/css/app.css']
  });
  const planningContext = buildPlanningContext({
    workspaceState: {
      workspaceRoot: 'G:/langtuvn/ai_local',
      existingFiles: scan.discoveredFiles
    },
    projectScan: scan,
    projectIntent: {
      prompt: 'Create a React dashboard',
      objective: 'Create a React dashboard',
      goalType: 'DASHBOARD'
    },
    validatedAssumptions: []
  }).context;

  assert.equal(planningContext.selectedImplementation.selectedVariant.frameworkKey, 'laravel-react');

  const mapping = mapRequirementsToWorkspace({
    requirements: [makeRequirement('APPLICATION_ENTRY')],
    planningContext,
    projectScanSnapshot: scan,
    projectIntent: {
      prompt: 'Create a React dashboard',
      objective: 'Create a React dashboard'
    },
    objective: 'Create a React dashboard'
  });

  assert.equal(mapping.mappedArtifacts[0].path, 'resources/views/welcome.blade.php');
  assert.equal(mapping.mappedArtifacts.some(artifact => artifact.path === 'src/App.tsx'), false);
});

test('Phase 5.16: workspace mapping follows selected implementation variant rather than objective text', () => {
  const scan = makeScan({ projectType: 'generic', files: [] });
  const planningContext = {
    workspaceRoot: 'G:/langtuvn/ai_local',
    facts: {
      projectType: 'generic',
      packageJsonFound: false
    },
    selectedImplementation: {
      id: 'selected-implementation:nextjs-ts',
      strategy: 'Manual',
      variant: 'React + Next',
      selectedVariant: {
        id: 'implementation-variant:nextjs-ts',
        variant: 'React + Next',
        variantKey: 'nextjs-ts',
        frameworkKey: 'nextjs-ts',
        evidence: ['manual:selection'],
        confidence: 0.99
      },
      confidence: 0.99,
      evidence: ['manual:selection'],
      selectionReason: 'Manual test selection',
      plannerApproved: true
    }
  };

  const mapping = mapRequirementsToWorkspace({
    requirements: [makeRequirement('APPLICATION_ENTRY')],
    planningContext,
    projectScanSnapshot: scan,
    projectIntent: {
      prompt: 'Create a React landing page',
      objective: 'Create a React landing page'
    },
    objective: 'Create a React landing page'
  });

  assert.equal(mapping.requiredFramework, 'nextjs-ts');
  assert.equal(mapping.mappedArtifacts[0].path, 'app/page.tsx');
});

test('Phase 5.16: implementation variant graph stays reasoning-only and carries evidence', () => {
  const scan = makeScan({ projectType: 'generic', files: [] });
  const planningContext = buildPlanningContext({
    workspaceState: {
      workspaceRoot: 'G:/langtuvn/ai_local',
      existingFiles: []
    },
    projectScan: scan,
    projectIntent: {
      prompt: 'Create a React landing page',
      objective: 'Create a React landing page',
      goalType: 'LANDING_PAGE'
    },
    validatedAssumptions: []
  }).context;

  const resolution = resolveImplementationStrategy({
    objective: 'Create a React landing page',
    requirements: [makeRequirement('APPLICATION_ENTRY'), makeRequirement('GLOBAL_STYLE')],
    objectiveConstraints: Array.isArray(planningContext.objectiveConstraints) ? planningContext.objectiveConstraints : [],
    planningStrategies: Array.isArray(planningContext.planningStrategies) ? planningContext.planningStrategies : [],
    initializationStrategies: Array.isArray(planningContext.initializationStrategies) ? planningContext.initializationStrategies : [],
    planningContext,
    projectScanSnapshot: scan,
    projectIntent: {
      prompt: 'Create a React landing page',
      objective: 'Create a React landing page'
    }
  });

  const serialized = JSON.stringify(resolution.implementationVariantGraph);
  assert.ok(resolution.validation.valid);
  assert.ok(Array.isArray(resolution.implementationEvidence));
  assert.ok(resolution.implementationEvidence.length > 0);
  assert.equal(/(?:write_file|patch_file|read_file|run_terminal|execution unit|tool call)/i.test(serialized), false);
});
