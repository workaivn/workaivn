import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPlanningContext } from '../planner/context/PlanningContextBuilder.js';
import { createExecutionPlanner } from '../executionPlanner/executionPlanner.js';
import { approvePlannerAuthority } from '../executionPlanner/plannerAuthorityFirewall.js';

function createSemanticWorkspace(existingFiles = []) {
  return {
    workspaceRoot: 'G:/langtuvn/ai_local',
    existingFiles: [...existingFiles]
  };
}

test('Phase 4.31-HF1: planning context does not invent planner files without workspace evidence', () => {
  const { context } = buildPlanningContext({
    workspaceState: createSemanticWorkspace([]),
    projectScan: {
      projectType: 'generic',
      packageJsonFound: false,
      discoveredFiles: []
    },
    validatedAssumptions: [],
    classifierRequestedFiles: [],
    projectIntent: {
      goalType: 'SAAS_APP',
      prompt: 'Build a SaaS landing page',
      objective: 'Build a SaaS landing page'
    }
  });

  const plannerDerived = context.requestedFileDetails.filter(entry => entry.authoritySource === 'planner_derived');

  assert.equal(plannerDerived.length, 0, 'Expected no planner-derived file intents without evidence');
  assert.equal(context.explicitRequestedNewFiles.length, 0);
  assert.equal(context.plannedNewFiles.length, 0);
});

test('Phase 4.31-HF1: planning context derives workspace-derived files for matching existing workspace files', () => {
  const { context } = buildPlanningContext({
    workspaceState: createSemanticWorkspace(['index.html', 'assets/css/style.css']),
    projectScan: {
      projectType: 'generic',
      packageJsonFound: false,
      discoveredFiles: ['index.html', 'assets/css/style.css']
    },
    validatedAssumptions: [],
    classifierRequestedFiles: [],
    projectIntent: {
      goalType: 'LANDING_PAGE',
      prompt: 'Build a landing page',
      objective: 'Build a landing page'
    }
  });

  const workspaceDerived = context.requestedFileDetails.filter(entry => entry.authoritySource === 'workspace_derived');

  assert.ok(workspaceDerived.length > 0, 'Expected workspace-derived file intents');
  assert.ok(workspaceDerived.some(entry => entry.path === 'index.html'));
  assert.ok(workspaceDerived.some(entry => entry.path === 'assets/css/style.css'));
});

test('Phase 4.31-HF1: existing JSX landing-page evidence allows planner-derived section files', () => {
  const { context } = buildPlanningContext({
    workspaceState: createSemanticWorkspace(['src/hero.jsx', 'src/features.jsx', 'src/pricing.jsx']),
    projectScan: {
      projectType: 'generic',
      packageJsonFound: false,
      discoveredFiles: ['src/hero.jsx', 'src/features.jsx', 'src/pricing.jsx']
    },
    validatedAssumptions: [],
    classifierRequestedFiles: [],
    projectIntent: {
      goalType: 'LANDING_PAGE',
      prompt: 'Build a landing page with FAQ, testimonials and footer',
      objective: 'Build a landing page with FAQ, testimonials and footer'
    }
  });

  const plannerDerived = context.requestedFileDetails.filter(entry => entry.authoritySource === 'planner_derived');

  assert.ok(plannerDerived.length > 0, 'Expected planner-derived file intents from JSX evidence');
  assert.ok(plannerDerived.some(entry => entry.path === 'src/faq.jsx'));
  assert.ok(plannerDerived.some(entry => entry.path === 'src/testimonials.jsx'));
  assert.ok(plannerDerived.some(entry => entry.path === 'src/footer.jsx'));
});

test('Phase 4.31-HF1: semantic objectives keep execution empty without evidence-backed file intents', () => {
  const planning = buildPlanningContext({
    workspaceState: createSemanticWorkspace([]),
    projectScan: {
      projectType: 'generic',
      packageJsonFound: false,
      discoveredFiles: []
    },
    validatedAssumptions: [],
    classifierRequestedFiles: [],
    projectIntent: {
      goalType: 'SAAS_APP',
      prompt: 'Build a SaaS landing page',
      objective: 'Build a SaaS landing page'
    }
  });

  const plan = createExecutionPlanner({
    objective: 'Build a SaaS landing page',
    verifiedPlanningContext: planning.context,
    canonicalFileUniverse: [],
    plannerPolicies: {
      ALLOW_NEW_FILE_CREATION: true,
      ALLOW_PROJECT_BOOTSTRAP: true
    },
    projectIntent: {
      goalType: 'SAAS_APP'
    },
    projectScan: {
      projectType: 'generic'
    }
  });

  const writeTasks = plan.tasks.filter(task => task.tool === 'WRITE_FILE' || task.tool === 'APPLY_PATCH');
  assert.equal(writeTasks.length, 0, 'Expected no executable write task without evidence-backed file intents');
});

test('Phase 4.31-HF1: planner-derived and workspace-derived sources are accepted and model-invented is rejected', () => {
  const plannerDerived = approvePlannerAuthority({
    id: 'unit:planner-derived',
    type: 'WRITE',
    tool: 'WRITE_FILE',
    targetFiles: ['src/App.tsx'],
    requestedKind: 'EXPLICIT_CREATE',
    authoritySource: 'planner_derived'
  }, {
    plannerPolicies: {
      ALLOW_NEW_FILE_CREATION: true
    }
  });

  assert.equal(plannerDerived.valid, true);
  assert.equal(plannerDerived.candidate.authoritySource, 'planner_derived');
  assert.equal(plannerDerived.candidate.approvedByFirewall, true);

  const workspaceDerived = approvePlannerAuthority({
    id: 'unit:workspace-derived',
    type: 'PATCH',
    tool: 'APPLY_PATCH',
    targetFiles: ['src/app.js'],
    requestedKind: 'EXPLICIT_MODIFICATION',
    authoritySource: 'workspace_derived'
  }, {
    verifiedPlanningContext: {
      verifiedFiles: ['src/app.js'],
      verifiedCommands: ['npm test']
    },
    canonicalFileUniverse: ['src/app.js'],
    plannerPolicies: {
      ALLOW_EXISTING_PROJECT_MODIFICATION: true
    }
  });

  assert.equal(workspaceDerived.valid, true);
  assert.equal(workspaceDerived.candidate.authoritySource, 'workspace_derived');
  assert.equal(workspaceDerived.candidate.approvedByFirewall, true);

  const invented = approvePlannerAuthority({
    id: 'unit:model-invented',
    type: 'WRITE',
    tool: 'WRITE_FILE',
    targetFiles: ['src/bad.js'],
    authoritySource: 'model_invented'
  }, {
    plannerPolicies: {
      ALLOW_NEW_FILE_CREATION: true
    }
  });

  assert.equal(invented.valid, false);
});
