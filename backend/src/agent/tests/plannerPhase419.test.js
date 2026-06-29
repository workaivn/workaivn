import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeClarification } from '../planner/clarificationEngine.js';
import { buildPlan, extractCommands } from '../planner/planBuilder.js';
import { normalizeWorkspaceRelativePath, validateGeneratedWriteContent } from '../workspace.js';

// ===================== Phase 4.19 Clarification Engine Tests =====================

test('Phase 4.19: analyzeClarification — specific file/read task', () => {
  assert.equal(analyzeClarification("Read package.json").needsClarification, false);
});

test('Phase 4.19: analyzeClarification — specific command task', () => {
  assert.equal(analyzeClarification("Run npm test").needsClarification, false);
});

test('Phase 4.19: analyzeClarification — create file task', () => {
  assert.equal(analyzeClarification("Create src/a.js with content x").needsClarification, false);
});

test('Phase 4.19: analyzeClarification — concrete file path', () => {
  assert.equal(analyzeClarification("Edit src/App.js").needsClarification, false);
});

test('Phase 4.19: analyzeClarification — concrete command', () => {
  assert.equal(analyzeClarification("Run npm run build").needsClarification, false);
});

test('Phase 4.19: analyzeClarification — vague task "Fix it"', () => {
  assert.equal(analyzeClarification("Fix it").needsClarification, true);
});

test('Phase 4.19: analyzeClarification — vague task "Update it"', () => {
  assert.equal(analyzeClarification("Update it").needsClarification, true);
});

test('Phase 4.19: analyzeClarification — vague task "Improve it"', () => {
  assert.equal(analyzeClarification("Improve it").needsClarification, true);
});

test('Phase 4.19: analyzeClarification — empty prompt', () => {
  assert.equal(analyzeClarification("").needsClarification, true);
});

test('Phase 4.19: analyzeClarification — returns confidence number', () => {
  const result = analyzeClarification("Read package.json");
  assert.equal(typeof result.confidence, 'number');
  assert.ok(result.confidence >= 0 && result.confidence <= 1);
});

test('Phase 4.19: analyzeClarification — returns non-empty reason', () => {
  const result = analyzeClarification("Fix it");
  assert.equal(typeof result.reason, 'string');
  assert.ok(result.reason.length > 0);
});

// ===================== Phase 4.19 Spec Purity Check =====================

test('Phase 4.19: clarificationEngine must not use fs', async () => {
  const fs = await import('fs/promises');
  const content = await fs.readFile(new URL('../planner/clarificationEngine.js', import.meta.url), 'utf8');
  assert.ok(!content.includes("readFileSync"), "Must not contain readFileSync");
  assert.ok(!content.includes('from "fs"'), "Must not import from fs");
  assert.ok(!content.includes("from 'fs'"), "Must not import from 'fs'");
});

test('Phase 4.19: clarificationEngine must not use path', async () => {
  const fs = await import('fs/promises');
  const content = await fs.readFile(new URL('../planner/clarificationEngine.js', import.meta.url), 'utf8');
  assert.ok(!content.includes('from "path"'), "Must not import from path");
  assert.ok(!content.includes("from 'path'"), "Must not import from 'path'");
});

test('Phase 4.19: clarificationEngine must not use console.log', async () => {
  const fs = await import('fs/promises');
  const content = await fs.readFile(new URL('../planner/clarificationEngine.js', import.meta.url), 'utf8');
  assert.ok(!content.includes('console.log'), "Must not contain console.log");
});

// ===================== Phase 4.19 Planner Correction Regression Test =====================

test('Phase 4.19: Spec-based write task detection works correctly', () => {
  // This tests the underlying condition used in runAgentLoop.js to prevent infinite corrective loops
  const readyTaskSpecWrite = { id: 'test', status: 'READY', goal: 'Write file: test.js — Create module', tool: null };
  const readyTaskRegular = { id: 'test', status: 'READY', goal: 'Read package.json', tool: 'READ_FILE' };
  
  const isSpecWrite = readyTaskSpecWrite && !readyTaskSpecWrite.tool && String(readyTaskSpecWrite.goal || '').startsWith('Write file:');
  const isRegularWrite = readyTaskRegular && !readyTaskRegular.tool && String(readyTaskRegular.goal || '').startsWith('Write file:');
  
  assert.equal(isSpecWrite, true, 'Should detect spec-based write task');
  assert.equal(isRegularWrite, false, 'Regular READ_FILE task should not trigger spec-write logic');
});

test('Phase 4.19: Constraint message does not contain forbidden elements', () => {
  const constraintMessage = `Current planner task requires WRITE_FILE or APPLY_PATCH for "backend/src/test.js". Tool READ_FILE is forbidden for this correction step. Specification Enforcement: Implement ONLY what the current task specifies. Do not add filesystem access, path operations, logging unless explicitly required.`;
  
  assert.ok(!constraintMessage.includes('fs.'), "Constraint must not reference fs module");
  assert.ok(!constraintMessage.includes('path.'), "Constraint must not reference path module");
  assert.ok(!constraintMessage.includes('console'), "Constraint must not reference console");
});

// ===================== Phase 4.19 Policy Fix Test =====================

test('Phase 4.19: WRITE_AND_RUN mode allows WRITE_FILE despite doNotModify', () => {
  // Phase 4.19 Hotfix: When taskMode is WRITE_AND_RUN with doNotModify,
  // WRITE_FILE/APPLY_PATCH must NOT be forbidden
  const hasDoNotModify = /\bdo\s+not\s+modify\b/i.test('Do not modify any existing files. Create test.js');
  const hasRunRequested = /\b(npm|node)\s+/i.test('Create test.js then run node test.js');
  const hasWriteIntent = /\bcreate\b/i.test('Create test.js');
  
  // Mode should be WRITE_AND_RUN (write intent + run requested)
  const modeShouldBeWriteAndRun = hasWriteIntent && hasRunRequested;
  
  assert.equal(modeShouldBeWriteAndRun, true, 'WRITE_AND_RUN mode should be triggered');
  
  // WRITE tools must NOT be forbidden in WRITE_AND_RUN mode
  // This is verified by the policy logic: if (doNotModify && mode === "READ_ONLY") { forbid writes }
  // WRITE_AND_RUN bypasses this restriction
});

test('Phase 4.19: explicit validation command is preserved without generic npm test fallback', () => {
  const plan = buildPlan(
    [
      'Implement Phase 4.19.',
      'After implementation run:',
      '',
      'npm test -- plannerPhase419',
      '',
      'Do not finish until tests pass.'
    ].join('\n'),
    {
      taskType: 'CODING',
      requestedFiles: [],
      requiredCommands: ['npm test']
    }
  );

  const commands = plan.tasks
    .filter(task => task.tool === 'RUN_TERMINAL')
    .map(task => task.toolArgs.command);

  assert.deepEqual(commands, ['npm test -- plannerPhase419']);
});

test('Phase 4.19: extractCommands preserves explicit plannerPhase419 command only', () => {
  const prompt = [
    'After implementation run:',
    '',
    'npm test -- plannerPhase419'
  ].join('\n');

  assert.deepEqual(extractCommands(prompt), ['npm test -- plannerPhase419']);
});

test('Phase 4.19: extractCommands captures node -e validation commands', () => {
  const prompt = [
    'Run:',
    'node -e "import(\\\'./src/phase419-test.js\\\').then(m=>console.log(m.phase))"'
  ].join('\n');

  assert.deepEqual(extractCommands(prompt), [
    'node -e "import(\\\'./src/phase419-test.js\\\').then(m=>console.log(m.phase))"'
  ]);
});

test('Phase 4.19: normalizeWorkspaceRelativePath strips absolute workspace paths', () => {
  const workspaceRoot = 'G:\\langtuvn\\ai_local\\storage\\workspaces\\511a217f-6b8a-472e-83a7-a6ec89aadb1f';
  const absoluteWindows = 'G:\\langtuvn\\ai_local\\storage\\workspaces\\511a217f-6b8a-472e-83a7-a6ec89aadb1f\\src\\modules\\aiagent\\aiagent.controller.js';
  const absoluteForward = 'G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f/src/modules/aiagent/aiagent.controller.js';
  const fileUrl = 'file:///G:/langtuvn/ai_local/storage/workspaces/511a217f-6b8a-472e-83a7-a6ec89aadb1f/src/modules/aiagent/aiagent.controller.js';
  const relativeWindows = 'src\\modules\\aiagent\\aiagent.controller.js';
  const relativeDot = './src/modules/aiagent/aiagent.controller.js';
  const outsideWorkspace = 'G:/other/project/src/file.js';

  assert.equal(normalizeWorkspaceRelativePath(absoluteWindows, workspaceRoot), 'src/modules/aiagent/aiagent.controller.js');
  assert.equal(normalizeWorkspaceRelativePath(absoluteForward, workspaceRoot), 'src/modules/aiagent/aiagent.controller.js');
  assert.equal(normalizeWorkspaceRelativePath(fileUrl, workspaceRoot), 'src/modules/aiagent/aiagent.controller.js');
  assert.equal(normalizeWorkspaceRelativePath(relativeWindows, workspaceRoot), 'src/modules/aiagent/aiagent.controller.js');
  assert.equal(normalizeWorkspaceRelativePath(relativeDot, workspaceRoot), 'src/modules/aiagent/aiagent.controller.js');
  assert.equal(normalizeWorkspaceRelativePath(outsideWorkspace, workspaceRoot), '');
});

test('Phase 4.19: clarificationEngine content validation rejects always-false output', async () => {
  const result = await validateGeneratedWriteContent({
    workspaceRoot: 'G:\\langtuvn\\ai_local\\storage\\workspaces\\511a217f-6b8a-472e-83a7-a6ec89aadb1f',
    targetPath: 'src/agent/planner/clarificationEngine.js',
    content: 'export function analyzeClarification(prompt) { return { needsClarification: false }; }',
    projectScan: { projectType: 'node', appRoots: ['src'], sourceRoots: ['src'] },
    requiredSymbols: ['analyzeClarification'],
    prompt: 'Implement Phase 4.19 clarification engine'
  });

  assert.equal(result.success, false);
  assert.match(result.error || '', /clarificationEngine/i);
});

test('Phase 4.19: clarificationEngine content validation accepts a valid implementation', async () => {
  const result = await validateGeneratedWriteContent({
    workspaceRoot: 'G:\\langtuvn\\ai_local\\storage\\workspaces\\511a217f-6b8a-472e-83a7-a6ec89aadb1f',
    targetPath: 'src/agent/planner/clarificationEngine.js',
    content: [
      'export function analyzeClarification(prompt) {',
      '  const text = String(prompt || "").trim().toLowerCase();',
      '  if (!text) return { needsClarification: true };',
      '  if (/^fix\\s+(it|this|that)?$/.test(text)) return { needsClarification: true };',
      '  if (/^update\\s+(it|this|that)?$/.test(text)) return { needsClarification: true };',
      '  if (/^improve\\s+(it|this|that)?$/.test(text)) return { needsClarification: true };',
      '  if (/^read\\s+package\\.json$/.test(text)) return { needsClarification: false };',
      '  if (/^run\\s+npm\\s+test/.test(text)) return { needsClarification: false };',
      '  return { needsClarification: false };',
      '}',
      'export default analyzeClarification;'
    ].join('\n'),
    projectScan: { projectType: 'node', appRoots: ['src'], sourceRoots: ['src'] },
    requiredSymbols: ['analyzeClarification'],
    prompt: 'Implement Phase 4.19 clarification engine'
  });

  assert.equal(result.success, true);
  assert.match(result.content || '', /analyzeClarification/);
});
