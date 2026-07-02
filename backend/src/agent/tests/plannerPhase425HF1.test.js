import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { validateGeneratedWriteContent } from '../workspace.js';
import { writeFileTool } from '../tools/writeFile.js';
import { resolveWorkspacePathSafe } from '../workspace.js';
import { evaluateQualityGate } from '../qualityGate.js';

async function createWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workai-hf1-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'package.json'), '{"name":"nested"}\n', 'utf8');
  return root;
}

test('Phase 4.25-HF1: static package.json, HTML, and CSS content validate before commit', async () => {
  const root = await createWorkspace();
  try {
    const pkg = await validateGeneratedWriteContent({
      workspaceRoot: root,
      targetPath: 'package.json',
      content: JSON.stringify({ name: 'demo', scripts: { test: 'node --test' } }, null, 2),
      prompt: 'Create package.json',
      projectScan: { projectType: 'node' }
    });
    assert.equal(pkg.success, true);

    const html = await validateGeneratedWriteContent({
      workspaceRoot: root,
      targetPath: 'index.html',
      content: '<!doctype html><html><head></head><body><main>Hello</main></body></html>',
      prompt: 'Create a landing page',
      projectScan: { projectType: 'static_html' }
    });
    assert.equal(html.success, true);

    const css = await validateGeneratedWriteContent({
      workspaceRoot: root,
      targetPath: 'src/styles.css',
      content: ':root { --bg: #fff; }\n@media (min-width: 768px) { body { color: #111; } }',
      prompt: 'Create styles',
      projectScan: { projectType: 'static_html' }
    });
    assert.equal(css.success, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Phase 4.25-HF1: static files commit to disk only after successful write', async () => {
  const root = await createWorkspace();
  try {
    const result = await writeFileTool({
      path: 'package.json',
      content: JSON.stringify({ name: 'demo', scripts: { test: 'node --test' } }, null, 2),
      workspaceRoot: root,
      layout: { projectType: 'node' }
    });

    assert.equal(result.success, true);
    assert.equal(result.committed, true);
    assert.equal(result.phase, 'COMMITTED');
    assert.equal(await fs.stat(path.join(root, 'package.json')).then(stat => stat.isFile()).catch(() => false), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Phase 4.25-HF1: root package.json path is preserved and not silently rewritten to src/package.json', async () => {
  const root = await createWorkspace();
  try {
    const resolved = await resolveWorkspacePathSafe(root, 'package.json', {
      allowMissing: true,
      layout: { existingTopLevelDirs: ['src'] }
    });
    assert.equal(resolved.relativePath, 'package.json');
    assert.equal(path.normalize(resolved.absolutePath), path.normalize(path.join(root, 'package.json')));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Phase 4.25-HF1: QualityGate accepts verified existing files and committedFiles on repeated runs', async () => {
  const root = await createWorkspace();
  try {
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'demo', scripts: { test: 'node --test' } }, null, 2), 'utf8');
    await fs.writeFile(path.join(root, 'src', 'app.js'), 'export const app = true;\n', 'utf8');
    await fs.writeFile(path.join(root, 'src', 'app.test.js'), 'console.log("ok");\n', 'utf8');

    const gate = await evaluateQualityGate({
      acceptanceCriteria: {
        taskType: 'CODING',
        taskMode: 'coding',
        objective: 'Create an app',
        requestedFiles: ['src/app.js', 'src/app.test.js']
      },
      changedFiles: [],
      committedFiles: ['src/app.js', 'src/app.test.js'],
      requestedWriteFiles: ['src/app.js', 'src/app.test.js'],
      verifiedExistingFiles: ['src/app.js', 'src/app.test.js'],
      toolCalls: [
        { tool: 'WRITE_FILE', success: true, args: { path: 'src/app.js' }, result: { file: 'src/app.js', changed: false, alreadyUpToDate: true } },
        { tool: 'WRITE_FILE', success: true, args: { path: 'src/app.test.js' }, result: { file: 'src/app.test.js', changed: false, alreadyUpToDate: true } },
        { tool: 'RUN_TERMINAL', success: true, args: { command: 'node --test' }, result: { exitCode: 0, stdout: 'ok' } }
      ],
      workspaceRoot: root,
      requiredCommands: ['node --test'],
      finalText: 'Repeated run completed with verified files.'
    });

    assert.equal(gate.passed, true, JSON.stringify(gate.failures));
    assert.ok(gate.evidence.committedFiles.includes('src/app.js'));
    assert.ok(gate.evidence.verifiedExistingFiles.includes('src/app.test.js'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
