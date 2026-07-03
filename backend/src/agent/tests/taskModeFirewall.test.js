import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertPlannerEntryAllowed,
  classifyAnswerOnlyObjective,
  classifyTaskMode,
  explainTaskModeDecision,
  isAnswerOnlyTask,
  isWorkspaceTask,
  validateLegacyTargetLeak
} from '../planning/taskModeFirewall.js';

test('taskModeFirewall classifies answer-only prompts as ANSWER_ONLY', () => {
  assert.equal(classifyTaskMode('1+1=2'), 'ANSWER_ONLY');
  assert.equal(classifyTaskMode('1 + 1 = 2'), 'ANSWER_ONLY');
  assert.equal(classifyTaskMode('What is 2 + 2?'), 'ANSWER_ONLY');
  assert.equal(classifyTaskMode('Translate this sentence'), 'ANSWER_ONLY');
  assert.equal(classifyTaskMode('Summarize this paragraph'), 'ANSWER_ONLY');
  assert.equal(classifyTaskMode('Chỉ trả lời: 1+1=2'), 'ANSWER_ONLY');
  assert.equal(classifyTaskMode('Không sửa file, chỉ trả lời 1+1=2'), 'ANSWER_ONLY');
  assert.equal(classifyTaskMode('hello'), 'ANSWER_ONLY');
  assert.equal(classifyTaskMode('what is 1+1'), 'ANSWER_ONLY');
  assert.equal(classifyTaskMode('Đọc package.json, không sửa gì'), 'ANSWER_ONLY');
  assert.equal(classifyAnswerOnlyObjective('1+1=2'), true);
  assert.equal(classifyAnswerOnlyObjective('1 + 1 = 2'), true);
  assert.equal(classifyAnswerOnlyObjective('Chỉ trả lời: 1+1=2'), true);
  assert.equal(classifyAnswerOnlyObjective('Không sửa file, chỉ trả lời 1+1=2'), true);
  assert.equal(classifyAnswerOnlyObjective('hello'), true);
  assert.equal(classifyAnswerOnlyObjective('what is 1+1'), true);
  assert.equal(classifyAnswerOnlyObjective('Đọc package.json, không sửa gì'), true);
  assert.equal(isAnswerOnlyTask('General advice'), true);
  assert.equal(explainTaskModeDecision('1+1=2', 'ANSWER_ONLY'), 'Direct answer requested without workspace interaction.');
});

test('taskModeFirewall classifies workspace prompts distinctly', () => {
  assert.equal(classifyTaskMode('Create src/math.js'), 'WORKSPACE_CODING');
  assert.equal(classifyTaskMode('Build a React landing page'), 'PROJECT_INITIALIZATION');
  assert.notEqual(classifyTaskMode('Build a SaaS landing page'), 'ANSWER_ONLY');
  assert.equal(classifyTaskMode('Read package.json and explain it'), 'READ_ONLY_ANALYSIS');
  assert.equal(classifyTaskMode('Run npm test'), 'VALIDATION_ONLY');
  assert.equal(isWorkspaceTask('Create src/math.js'), true);
});

test('taskModeFirewall blocks planner entry for answer-only tasks', () => {
  const decision = assertPlannerEntryAllowed('1+1=2', 'ANSWER_ONLY');
  assert.equal(decision.allowed, false);
  assert.equal(decision.directAnswer, true);
  assert.equal(decision.taskMode, 'ANSWER_ONLY');
});

test('taskModeFirewall detects legacy target leaks without provenance', () => {
  const result = validateLegacyTargetLeak({
    stage: 'execution_planner',
    executionUnits: [
      {
        id: 'unit-1',
        path: 'src/main.js',
        targetFiles: ['src/main.js'],
        metadata: { source: 'fallback_default' }
      }
    ]
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'LEGACY_TARGET_LEAK_DETECTED');
  assert.equal(result.leaks.length, 1);
  assert.equal(result.leaks[0].path, 'src/main.js');
  assert.equal(result.leaks[0].stage, 'execution_units');
});

test('taskModeFirewall allows legacy target when provenance is present', () => {
  const result = validateLegacyTargetLeak({
    stage: 'execution_planner',
    executionUnits: [
      {
        id: 'unit-2',
        path: 'src/main.js',
        targetFiles: ['src/main.js'],
        source: 'VERIFIED_ARTIFACT_MAPPING',
        selectedImplementationId: 'selected-implementation:react_vite_ts',
        provenance: {
          selectedImplementationId: 'selected-implementation:react_vite_ts',
          selectedVariantId: 'implementation-variant:react-vite-ts',
          authoritySource: 'verified_workspace_evidence'
        }
      }
    ],
    selectedImplementation: {
      id: 'selected-implementation:react_vite_ts'
    }
  });

  assert.equal(result.valid, true);
  assert.equal(result.leaks.length, 0);
});
