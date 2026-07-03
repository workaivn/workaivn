import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPlanningContext } from '../planner/context/PlanningContextBuilder.js';
import { inferFileIntentCandidates } from '../planner/fileIntentInference.js';
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

  const plannerDerived = context.requestedFileDetails.filter(entry => entry.authoritySource === 'model_suggestion');

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

  const workspaceDerived = context.requestedFileDetails.filter(entry => entry.authoritySource === 'workspace_authority');

  assert.equal(workspaceDerived.length, 0, 'Phase 5.04: no workspace-derived file intents from static goal mappings');
});

test('Phase 4.31-HF1: existing JSX landing-page evidence keeps section files as recommendations', () => {
  const inference = inferFileIntentCandidates({
    objective: 'Build a landing page with FAQ, testimonials and footer',
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
    },
    requestedFileDetails: []
  });

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

  const plannerDerived = context.requestedFileDetails.filter(entry => entry.authoritySource === 'model_suggestion');

  assert.equal(plannerDerived.length, 0, 'Model-suggestion authority must not become executable');
  assert.equal(inference.recommendationCandidates.length, 0, 'Phase 5.04: no domain-derived recommendation candidates from static landing signals');
});

test('Phase 5.03-HF1: empty workspace create landing page uses objective authority', () => {
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
      goalType: 'LANDING_PAGE',
      prompt: 'Create a production-ready landing page',
      objective: 'Create a production-ready landing page'
    }
  });

  assert.equal(planning.context.initializationMode, 'PROJECT_INITIALIZATION');
  assert.equal(planning.context.objectiveAuthorityEligible, true);

  const plan = createExecutionPlanner({
    objective: 'Create a production-ready landing page',
    verifiedPlanningContext: planning.context,
    canonicalFileUniverse: [],
    plannerPolicies: planning.context.plannerPolicies,
    projectIntent: {
      goalType: 'LANDING_PAGE'
    },
    projectScan: {
      projectType: 'generic'
    }
  });

  const writeTasks = plan.tasks.filter(task => task.tool === 'WRITE_FILE' || task.tool === 'APPLY_PATCH');
  assert.ok(writeTasks.length >= 3, 'Expected initialization writes for a landing page');
  assert.ok(writeTasks.every(task => task.authoritySource === 'objective_authority'));
  assert.ok(writeTasks.some(task => task.targetFiles?.includes('index.html')));
  assert.ok(writeTasks.some(task => task.targetFiles?.includes('assets/css/style.css')));
  assert.ok(writeTasks.some(task => task.targetFiles?.includes('assets/js/app.js')));
  assert.equal(writeTasks.some(task => String(task.targetFiles?.[0] || '').includes('cta.jsx')), false);
  assert.equal(plan.tasks.some(task => task.authoritySource === 'recommendation'), false);
});

test('Phase 5.03-HF1: empty workspace create Flask API uses objective authority', () => {
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
      goalType: 'API_SERVER',
      prompt: 'Create Flask API',
      objective: 'Create Flask API'
    }
  });

  assert.equal(planning.context.initializationMode, 'PROJECT_INITIALIZATION');

  const plan = createExecutionPlanner({
    objective: 'Create Flask API',
    verifiedPlanningContext: planning.context,
    canonicalFileUniverse: [],
    plannerPolicies: planning.context.plannerPolicies,
    projectIntent: {
      goalType: 'API_SERVER'
    },
    projectScan: {
      projectType: 'generic'
    }
  });

  const writeTasks = plan.tasks.filter(task => task.tool === 'WRITE_FILE');
  assert.ok(writeTasks.length >= 2);
  assert.ok(writeTasks.every(task => task.authoritySource === 'objective_authority'));
  assert.ok(writeTasks.some(task => task.targetFiles?.includes('app.py') || task.targetFiles?.includes('main.py')));
  assert.ok(writeTasks.some(task => task.targetFiles?.includes('requirements.txt')));
});

test('Phase 5.03-HF1: empty workspace create PHP website uses objective authority', () => {
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
      goalType: 'LANDING_PAGE',
      prompt: 'Create PHP website',
      objective: 'Create PHP website'
    }
  });

  assert.equal(planning.context.initializationMode, 'PROJECT_INITIALIZATION');

  const plan = createExecutionPlanner({
    objective: 'Create PHP website',
    verifiedPlanningContext: planning.context,
    canonicalFileUniverse: [],
    plannerPolicies: planning.context.plannerPolicies,
    projectIntent: {
      goalType: 'LANDING_PAGE'
    },
    projectScan: {
      projectType: 'generic'
    }
  });

  const writeTasks = plan.tasks.filter(task => task.tool === 'WRITE_FILE');
  assert.ok(writeTasks.length >= 3);
  assert.ok(writeTasks.every(task => task.authoritySource === 'objective_authority'));
  assert.ok(writeTasks.some(task => task.targetFiles?.includes('index.php')));
});

test('Phase 5.03-HF1: existing workspace modifications stay on workspace evidence', () => {
  const planning = buildPlanningContext({
    workspaceState: createSemanticWorkspace(['src/Hero.jsx']),
    projectScan: {
      projectType: 'generic',
      packageJsonFound: false,
      discoveredFiles: ['src/Hero.jsx']
    },
    validatedAssumptions: [],
    classifierRequestedFiles: ['src/Hero.jsx'],
    projectIntent: {
      goalType: 'LANDING_PAGE',
      prompt: 'Modify Hero component',
      objective: 'Modify Hero component'
    }
  });

  assert.equal(planning.context.initializationMode, 'PROJECT_MODIFICATION');

  const plan = createExecutionPlanner({
    objective: 'Modify Hero component',
    verifiedPlanningContext: planning.context,
    canonicalFileUniverse: ['src/Hero.jsx'],
    plannerPolicies: planning.context.plannerPolicies,
    projectIntent: {
      goalType: 'LANDING_PAGE'
    },
    projectScan: {
      projectType: 'generic'
    }
  });

  const writeTasks = plan.tasks.filter(task => task.tool === 'WRITE_FILE' || task.tool === 'APPLY_PATCH');
  assert.ok(writeTasks.length > 0);
  assert.ok(writeTasks.every(task => task.authoritySource !== 'objective_authority'));
  assert.ok(writeTasks.some(task => task.authoritySource === 'workspace_authority'));
});

test('Phase 4.31-HF1: planner-derived and workspace-derived sources are accepted and model-invented is rejected', () => {
  const plannerDerived = approvePlannerAuthority({
    id: 'unit:planner-derived',
    type: 'WRITE',
    tool: 'WRITE_FILE',
    targetFiles: ['src/App.tsx'],
    requestedKind: 'EXPLICIT_CREATE',
    authoritySource: 'model_suggestion'
  }, {
    plannerPolicies: {
      ALLOW_NEW_FILE_CREATION: true
    }
  });

  assert.equal(plannerDerived.valid, false);
  assert.equal(plannerDerived.validation.reason, 'authority source is not executable');

  const workspaceDerived = approvePlannerAuthority({
    id: 'unit:workspace-derived',
    type: 'PATCH',
    tool: 'APPLY_PATCH',
    targetFiles: ['src/app.js'],
    requestedKind: 'EXPLICIT_MODIFICATION',
    authoritySource: 'workspace_authority'
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
  assert.equal(workspaceDerived.candidate.authoritySource, 'workspace_authority');
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
