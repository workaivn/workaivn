import test from 'node:test';
import assert from 'node:assert/strict';

import { Planner } from '../planner/planner.js';
import { Task } from '../planner/task.js';
import { buildPlanningContext } from '../planner/context/PlanningContextBuilder.js';
import { createPlannerAssumption } from '../planner/assumptionValidator.js';
import { buildPlannerExecutionMetadata, detectProjectIntent, resolveBootstrapProfile } from '../projectIntelligence/index.js';

test('Phase 4.26: bootstrap profile commands stay recommendation-only in planning context', () => {
  const workspaceState = {
    existingFiles: ['package.json'],
    packageJsonFound: true,
    packageJson: { name: 'demo', scripts: { test: 'vitest', build: 'vite build' } }
  };
  const projectScan = {
    packageJsonFound: true,
    projectType: 'vite',
    testCommands: ['npx vitest run'],
    buildCommands: ['npm run build'],
    runCommands: ['npm run dev']
  };
  const bootstrapProfile = {
    id: 'react-vite-ts',
    validationCommands: ['npm run validate'],
    buildCommands: ['npm run outdated-build'],
    installCommands: ['npm install']
  };

  const { context } = buildPlanningContext({
    workspaceState,
    projectScan,
    bootstrapProfile,
    validatedAssumptions: [
      createPlannerAssumption('package.json', 'classifier', { required: true, verified: true })
    ]
  });

  assert.ok(context.verifiedCommands.includes('npx vitest run'));
  assert.ok(context.verifiedCommands.includes('npm run build'));
  assert.ok(context.verifiedCommands.includes('npm run dev'));
  assert.equal(context.verifiedCommands.includes('npm run validate'), false);
  assert.equal(context.verifiedCommands.includes('npm run outdated-build'), false);
});

test('Phase 4.26: runtime terminal commands are not treated as validation evidence', () => {
  const planner = new Planner([
    new Task({
      id: 'run-dev',
      kind: 'CODING',
      tool: 'RUN_TERMINAL',
      toolArgs: { command: 'npm run dev' },
      goal: 'Run dev server'
    }),
    new Task({
      id: 'run-preview',
      kind: 'CODING',
      tool: 'RUN_TERMINAL',
      toolArgs: { command: 'npm run preview' },
      goal: 'Run preview server'
    }),
    new Task({
      id: 'run-build',
      kind: 'CODING',
      tool: 'RUN_TERMINAL',
      toolArgs: { command: 'npm run build' },
      goal: 'Run build validation'
    })
  ]);

  const metadata = buildPlannerExecutionMetadata(planner);

  assert.deepEqual(metadata.plannerRunCommands.sort(), ['npm run build', 'npm run dev', 'npm run preview']);
  assert.deepEqual(metadata.plannerValidationCommands, ['npm run build']);
});

test('Phase 4.26: planning context includes workspace files in the canonical universe', () => {
  const workspaceState = {
    existingFiles: ['package.json', 'src/App.tsx', 'src/main.tsx'],
    packageJsonFound: true
  };
  const projectScan = {
    packageJsonFound: true,
    projectType: 'vite',
    entryFiles: ['src/main.tsx'],
    discoveredFiles: ['package.json']
  };

  const { context, validation } = buildPlanningContext({
    workspaceState,
    projectScan,
    validatedAssumptions: [
      createPlannerAssumption('package.json', 'classifier', { required: true, verified: true }),
      createPlannerAssumption('src/App.tsx', 'classifier', { required: true, verified: true }),
      createPlannerAssumption('src/main.tsx', 'classifier', { required: true, verified: true })
    ]
  });

  assert.equal(validation.valid, true);
  assert.ok(context.discoveredFiles.includes('src/App.tsx'));
  assert.ok(context.fileIsVerified('src/App.tsx'));
});

