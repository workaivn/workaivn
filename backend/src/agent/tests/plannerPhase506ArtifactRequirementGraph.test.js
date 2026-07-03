import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectScanSnapshot } from '../context/ProjectScanSnapshot.js';
import { buildArtifactRequirementGraph } from '../planning/artifactRequirementGraph.js';
import { mapRequirementsToWorkspace, resolveRequirement } from '../planning/workspaceMapper.js';

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

function makeContext({ workspaceFiles = [], projectType = 'generic' } = {}) {
  const projectScan = createProjectScanSnapshot({
    workspaceRoot: 'G:/langtuvn/ai_local',
    projectType,
    packageJsonFound: workspaceFiles.includes('package.json'),
    discoveredFiles: [...workspaceFiles]
  });

  return {
    workspaceRoot: 'G:/langtuvn/ai_local',
    workspace: {
      workspaceRoot: 'G:/langtuvn/ai_local',
      existingFiles: [...workspaceFiles]
    },
    projectScan,
    plannedFiles: [],
    verifiedFiles: [],
    facts: {
      ...projectScan,
      discoveredFiles: [...workspaceFiles]
    }
  };
}

test('Phase 5.06: requirement graph stays capability-only before workspace mapping', () => {
  const { logs, restore } = captureLogs();
  try {
    const graph = buildArtifactRequirementGraph({
      objective: 'Create an application shell for a landing page',
      goalType: 'LANDING_PAGE',
      planningContext: makeContext({ workspaceFiles: [] }),
      projectScanSnapshot: createProjectScanSnapshot({
        workspaceRoot: 'G:/langtuvn/ai_local',
        projectType: 'generic',
        discoveredFiles: []
      }),
      projectIntent: {
        prompt: 'Create an application shell for a landing page',
        objective: 'Create an application shell for a landing page'
      }
    });

    assert.ok(Array.isArray(graph.requirements));
    assert.ok(graph.requirements.length > 0);
    assert.equal(graph.requirements.every(requirement => !('path' in requirement) && !('suggestedPath' in requirement)), true);
    assert.equal(logs.some(line => line.includes('src/App.tsx')), false);
    assert.equal(logs.some(line => line.includes('index.php')), false);
    assert.ok(logs.some(line => line.includes('[ARTIFACT_REQUIREMENT_GRAPH_START]')));
    assert.ok(logs.some(line => line.includes('[ARTIFACT_REQUIREMENT_GRAPH_COMPLETE]')));
  } finally {
    restore();
  }
});

test('Phase 5.06: React workspace maps APPLICATION_ENTRY to src/App.tsx', () => {
  const context = makeContext({
    workspaceFiles: ['package.json', 'vite.config.ts', 'src/main.tsx', 'src/styles.css'],
    projectType: 'vite'
  });

  const mapping = mapRequirementsToWorkspace({
    requirements: [
      {
        id: 'requirement:application-entry',
        capability: 'APPLICATION_ENTRY',
        artifactType: 'source',
        purpose: 'Primary application entry surface',
        required: true,
        source: 'objective',
        evidence: ['objective:react workspace']
      }
    ],
    planningContext: context,
    projectScanSnapshot: context.projectScan,
    projectIntent: {
      prompt: 'Create a React application',
      objective: 'Create a React application'
    },
    objective: 'Create a React application'
  });

  assert.equal(mapping.mappedArtifacts.length, 1);
  assert.equal(mapping.mappedArtifacts[0].path, 'src/App.tsx');
  assert.equal(mapping.unresolvedRequirements.length, 0);
});

test('Phase 5.06: Next workspace maps APPLICATION_ENTRY to app/page.tsx', () => {
  const context = makeContext({
    workspaceFiles: ['package.json', 'app/layout.tsx', 'app/globals.css', 'app/page.tsx'],
    projectType: 'next'
  });

  const resolved = resolveRequirement({
    requirement: {
      id: 'requirement:application-entry',
      capability: 'APPLICATION_ENTRY',
      artifactType: 'source',
      purpose: 'Primary application entry surface',
      required: true,
      source: 'objective'
    },
    planningContext: context,
    projectScanSnapshot: context.projectScan,
    projectIntent: {
      prompt: 'Create a Next.js site',
      objective: 'Create a Next.js site'
    },
    objective: 'Create a Next.js site'
  });

  assert.equal(resolved.unresolved, false);
  assert.equal(resolved.path, 'app/page.tsx');
});

test('Phase 5.06: PHP and Laravel workspaces map to the expected entry files', () => {
  const phpContext = makeContext({
    workspaceFiles: ['index.php', 'assets/css/style.css', 'assets/js/app.js'],
    projectType: 'php'
  });
  const laravelContext = makeContext({
    workspaceFiles: ['artisan', 'routes/web.php', 'resources/views/welcome.blade.php'],
    projectType: 'laravel'
  });

  const phpMapping = mapRequirementsToWorkspace({
    requirements: [
      {
        id: 'requirement:application-entry',
        capability: 'APPLICATION_ENTRY',
        artifactType: 'source',
        purpose: 'Primary application entry surface',
        required: true,
        source: 'objective'
      }
    ],
    planningContext: phpContext,
    projectScanSnapshot: phpContext.projectScan,
    projectIntent: {
      prompt: 'Create a PHP app',
      objective: 'Create a PHP app'
    },
    objective: 'Create a PHP app'
  });

  const laravelMapping = mapRequirementsToWorkspace({
    requirements: [
      {
        id: 'requirement:application-entry',
        capability: 'APPLICATION_ENTRY',
        artifactType: 'source',
        purpose: 'Primary application entry surface',
        required: true,
        source: 'objective'
      }
    ],
    planningContext: laravelContext,
    projectScanSnapshot: laravelContext.projectScan,
    projectIntent: {
      prompt: 'Create a Laravel app',
      objective: 'Create a Laravel app'
    },
    objective: 'Create a Laravel app'
  });

  assert.equal(phpMapping.mappedArtifacts[0].path, 'index.php');
  assert.equal(laravelMapping.mappedArtifacts[0].path, 'resources/views/welcome.blade.php');
});

test('Phase 5.06: unknown workspace leaves requirements unresolved without inventing a path', () => {
  const context = makeContext({
    workspaceFiles: ['README.md'],
    projectType: 'generic'
  });

  const mapping = mapRequirementsToWorkspace({
    requirements: [
      {
        id: 'requirement:application-entry',
        capability: 'APPLICATION_ENTRY',
        artifactType: 'source',
        purpose: 'Primary application entry surface',
        required: true,
        source: 'objective'
      }
    ],
    planningContext: context,
    projectScanSnapshot: context.projectScan,
    projectIntent: {
      prompt: 'Create an application',
      objective: 'Create an application'
    },
    objective: 'Create an application'
  });

  assert.equal(mapping.mappedArtifacts.length, 0);
  assert.equal(mapping.unresolvedRequirements.length, 1);
  assert.equal(mapping.unresolvedRequirements[0].path, null);
  assert.equal(mapping.unresolvedRequirements[0].unresolved, true);
});
