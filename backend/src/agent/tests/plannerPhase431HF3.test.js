import test from 'node:test';
import assert from 'node:assert/strict';

import { createRuntimePlan } from '../projectIntelligence/runtimePlanningIntelligence.js';
import { inferFileIntentCandidates } from '../planner/fileIntentInference.js';
import { promoteExecutionUnitToTask } from '../executionPlanner/plannerPromoter.js';
import { promoteProposalToDescriptors } from '../planner/proposals/ProposalPromotion.js';

function createWorkspace(existingFiles = []) {
  return {
    workspaceRoot: 'G:/langtuvn/ai_local',
    existingFiles: [...existingFiles]
  };
}

test('Phase 4.31-HF3: mission and deliverables outrank dashboard mockup examples', () => {
  const plan = createRuntimePlan({
    prompt: 'Build a SaaS Landing Page with a dashboard mockup example',
    projectIntent: {
      prompt: 'Build a SaaS Landing Page with a dashboard mockup example'
    }
  });

  assert.equal(plan.goalType, 'LANDING_PAGE');
  assert.ok(Array.isArray(plan.recommendationPipeline?.projectStructure?.files));
  assert.ok(Array.isArray(plan.executionPipeline?.filePlan));
  assert.ok(plan.logs.some(entry => entry.event === 'RECOMMENDATION_PIPELINE_CREATED'));
  assert.ok(plan.logs.some(entry => entry.event === 'EXECUTION_PIPELINE_CREATED'));
});

test('Phase 4.31-HF3: empty workspace with bootstrap disabled stays recommendation-only', () => {
  const inference = inferFileIntentCandidates({
    objective: 'Build a landing page',
    projectIntent: {
      goalType: 'LANDING_PAGE',
      prompt: 'Build a landing page',
      objective: 'Build a landing page'
    },
    workspaceState: createWorkspace([]),
    projectScan: {
      projectType: 'generic',
      packageJsonFound: false,
      discoveredFiles: []
    },
    bootstrapProfile: {
      id: 'generic-static-html',
      canBootstrap: false
    },
    requestedFileDetails: []
  });

  assert.ok(inference.recommendationCandidates.length > 0, 'expected planner recommendations');
  assert.equal(inference.executionCandidates.length, 0, 'bootstrap-disabled empty workspace should not create executable writes');
  assert.equal(inference.recommendationCandidates[0]?.recommendationOnly, true);
  assert.equal(inference.recommendationCandidates[0]?.executable, false);
});

test('Phase 4.31-HF3: workspace evidence still yields footer, testimonials, and faq execution candidates', () => {
  const inference = inferFileIntentCandidates({
    objective: 'Build a landing page with FAQ, testimonials, and footer',
    workspaceState: createWorkspace(['src/hero.jsx', 'src/features.jsx', 'src/pricing.jsx']),
    projectScan: {
      projectType: 'generic',
      packageJsonFound: false,
      discoveredFiles: ['src/hero.jsx', 'src/features.jsx', 'src/pricing.jsx']
    },
    validatedAssumptions: [],
    classifierRequestedFiles: [],
    bootstrapProfile: {
      id: 'react-vite-ts',
      canBootstrap: true
    },
    projectIntent: {
      goalType: 'LANDING_PAGE',
      prompt: 'Build a landing page with FAQ, testimonials, and footer',
      objective: 'Build a landing page with FAQ, testimonials, and footer'
    },
    requestedFileDetails: []
  });

  const paths = inference.executionCandidates.map(entry => entry.path);
  assert.ok(paths.includes('src/footer.jsx'));
  assert.ok(paths.includes('src/testimonials.jsx'));
  assert.ok(paths.includes('src/faq.jsx'));
  assert.ok(inference.recommendationCandidates.every(entry => entry.recommendationOnly === true));
});

test('Phase 4.31-HF3: planner promoters reject recommendation-only write units', () => {
  const task = promoteExecutionUnitToTask({
    id: 'unit:recommendation-only',
    type: 'WRITE',
    description: 'Write landing page section',
    targetFiles: ['src/HeroSection.tsx'],
    requiredWrites: ['src/HeroSection.tsx'],
    recommendationOnly: true,
    executable: false,
    authoritySource: 'planner_derived'
  }, {
    executionContract: {
      requiredContext: {
        verifiedFiles: [],
        verifiedCommands: [],
        canonicalFileUniverse: [],
        plannerPolicies: {
          ALLOW_NEW_FILE_CREATION: true
        }
      }
    }
  });

  assert.equal(task, null);
});

test('Phase 4.31-HF3: proposal promotion rejects recommendation proposals before execution', () => {
  const result = promoteProposalToDescriptors({
    proposalId: 'proposal:recommendation',
    proposalType: 'FILE',
    suggestedFiles: ['src/HeroSection.tsx'],
    source: 'runtime-plan',
    proposalSource: 'runtime-plan',
    authority: { source: 'runtime-plan' },
    verificationStatus: 'unverified',
    promotionDecision: 'recommendation',
    recommendationOnly: true,
    executable: false
  }, {
    verifiedPlanningContext: {
      verifiedFiles: [],
      verifiedCommands: []
    },
    plannerPolicies: {
      ALLOW_NEW_FILE_CREATION: true
    }
  });

  assert.equal(result.decision, 'REJECT');
  assert.equal(result.promotedDescriptors.length, 0);
});
