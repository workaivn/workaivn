import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildKnowledgeGraph,
  loadKnowledgeGraph,
  updateKnowledgeGraph,
  queryKnowledgeGraph,
  findEntity,
  findRelations,
  findFeatureLocation,
  findImpacts,
  findTestsForChange,
  findCommandsForValidation,
  findFailurePattern,
  summarizeProjectKnowledge,
  serializeKnowledgeGraph,
  validateKnowledgeGraph
} from "./knowledgeGraph/index.js";

async function createTempWorkspace(structure = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kg-"));
  for (const [file, content] of Object.entries(structure)) {
    const abs = path.join(root, file);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
  }
  return root;
}

test("knowledge graph infers workspace entities from evidence", async () => {
  const root = await createTempWorkspace({
    "package.json": JSON.stringify({
      name: "kg-sample",
      scripts: { test: "node --test", build: "node build.js" },
      dependencies: { express: "^4.19.2" }
    }, null, 2),
    "src/server.js": [
      'import express from "express";',
      'import { User } from "./models/user.js";',
      'app.get("/users", (_req, res) => res.json({ ok: true }));',
      'export default app;'
    ].join("\n"),
    "src/models/user.js": [
      'export class User {',
      '  static schema = { name: String };',
      '}'
    ].join("\n"),
    "src/server.test.js": [
      'import test from "node:test";',
      'import assert from "node:assert/strict";',
      'test("server boots", () => assert.ok(true));'
    ].join("\n"),
    "README.md": "# Knowledge graph sample",
    ".env": "SECRET_TOKEN=top-secret"
  });

  const graph = await buildKnowledgeGraph(root, { save: false });

  assert.ok(Array.isArray(graph.nodes), "graph.nodes must be an array");
  assert.ok(Array.isArray(graph.edges), "graph.edges must be an array");
  assert.ok(graph.nodes.some(node => node.path === "src/server.js"), "server file node must exist");
  assert.ok(graph.nodes.some(node => node.type === "api"), "API node must be inferred");
  assert.ok(graph.nodes.some(node => node.type === "data"), "data node must be inferred");
  assert.ok(graph.nodes.some(node => node.type === "test"), "test node must be inferred");
  assert.ok(graph.nodes.some(node => node.type === "command"), "command node must be inferred");
  assert.ok(graph.summary.nodeCount >= 4, "summary must count nodes");
  assert.ok(graph.validation.valid, "graph should validate");
});

test("knowledge graph query helpers work against the inferred graph", async () => {
  const root = await createTempWorkspace({
    "package.json": JSON.stringify({ scripts: { test: "npm test", build: "npm run build" } }, null, 2),
    "src/app.js": 'export function App() { return "app"; }\n'
  });

  const graph = await buildKnowledgeGraph(root, { save: false });

  assert.ok(findEntity(graph, "src/app.js"), "findEntity should locate files");
  assert.ok(Array.isArray(findRelations(graph, "src/app.js")), "findRelations should return an array");
  assert.ok(Array.isArray(findFeatureLocation(graph, "app")), "findFeatureLocation should return matches");
  assert.ok(Array.isArray(findImpacts(graph, "src/app.js")), "findImpacts should return impacts");
  assert.ok(Array.isArray(findTestsForChange(graph, "src/app.js")), "findTestsForChange should return tests");
  assert.ok(Array.isArray(findCommandsForValidation(graph, "build")), "findCommandsForValidation should return commands");
  assert.equal(findFailurePattern(graph, "missing module"), null, "findFailurePattern should return null when absent");
  assert.ok(queryKnowledgeGraph(graph, "app").length >= 1, "queryKnowledgeGraph should return matches");
  assert.ok(summarizeProjectKnowledge(graph).nodeCount >= 1, "summary should be populated");
  assert.ok(validateKnowledgeGraph(graph).valid, "graph should validate");
  assert.ok(serializeKnowledgeGraph(graph).includes("\"graphVersion\""), "graph should serialize");
});

test("knowledge graph update marks stale nodes when files change", async () => {
  const root = await createTempWorkspace({
    "package.json": JSON.stringify({ scripts: { test: "npm test" } }, null, 2),
    "src/index.js": 'export const value = 1;\n'
  });

  const first = await buildKnowledgeGraph(root, { save: true });
  await fs.writeFile(path.join(root, "src/index.js"), 'export const value = 2;\n', "utf8");
  const second = await updateKnowledgeGraph(root, { save: false });
  assert.ok(second, "updated graph should exist");
  assert.ok(first.nodes.length >= 1, "first graph should have nodes");
  assert.ok(Array.isArray(second.staleNodes), "stale nodes should be reported");
  assert.ok(second.staleNodes.length >= 1, "changed file should invalidate stale nodes");
});

test("knowledge graph does not leak secret values", async () => {
  const root = await createTempWorkspace({
    ".env": "API_KEY=super-secret-value\nPUBLIC_FLAG=true\n",
    "package.json": JSON.stringify({ name: "secret-check" }, null, 2)
  });

  const graph = await buildKnowledgeGraph(root, { save: false });
  const envNodes = graph.nodes.filter(node => node.type === "config" && Array.isArray(node.evidence));
  const serialized = JSON.stringify(graph);

  assert.ok(!serialized.includes("super-secret-value"), "secret values must not appear in the graph");
  assert.ok(envNodes.every(node => !JSON.stringify(node).includes("super-secret-value")), "config nodes must not include secret values");
});
