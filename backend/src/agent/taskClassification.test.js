import assert from "node:assert/strict";
import test from "node:test";
import { classifyTaskType, buildAcceptanceCriteria } from "./acceptanceCriteria.js";

test("classifyTaskType classifies 'HELLO_WORKAI' as chat", () => {
  const result = classifyTaskType("HELLO_WORKAI");
  assert.equal(result, "chat");
});

test("classifyTaskType classifies short greeting as chat", () => {
  const result = classifyTaskType("Hi there");
  assert.equal(result, "chat");
});

test("classifyTaskType classifies search prompt as search", () => {
  const result = classifyTaskType("Tìm package.json và cho biết version");
  assert.equal(result, "search");
});

test("classifyTaskType classifies search with 'find' keyword as search", () => {
  const result = classifyTaskType("find all files with routes in config");
  assert.equal(result, "search");
});

test("classifyTaskType classifies analysis prompt as analysis", () => {
  const result = classifyTaskType("Phân tích cấu trúc thư mục src");
  assert.equal(result, "analysis");
});

test("classifyTaskType classifies analyze keyword as analysis", () => {
  const result = classifyTaskType("analyze the project structure");
  assert.equal(result, "analysis");
});

test("classifyTaskType classifies coding prompt as coding", () => {
  const result = classifyTaskType("Add a new route to the Express server");
  assert.equal(result, "coding");
});

test("classifyTaskType defaults to coding for unknown prompts", () => {
  const result = classifyTaskType("Build a complete authentication system");
  assert.equal(result, "coding");
});

test("buildAcceptanceCriteria sets taskType for chat prompts", () => {
  const c = buildAcceptanceCriteria("HELLO_WORKAI");
  assert.equal(c.taskType, "chat");
  assert.equal(c.requiresWorkspaceChange, false);
  assert.equal(c.requiresValidationCommand, false);
  assert.equal(c.requiresFileRead, false);
  assert.equal(c.requiresSearchResult, false);
});

test("buildAcceptanceCriteria sets taskType for search prompts", () => {
  const c = buildAcceptanceCriteria("Tìm package.json và cho biết version");
  assert.equal(c.taskType, "search");
  assert.equal(c.requiresWorkspaceChange, false);
  assert.equal(c.requiresValidationCommand, false);
  assert.equal(c.requiresFileRead, true);
  assert.equal(c.requiresSearchResult, true);
});

test("buildAcceptanceCriteria sets taskType for analysis prompts", () => {
  const c = buildAcceptanceCriteria("Phân tích cấu trúc thư mục src");
  assert.equal(c.taskType, "analysis");
  assert.equal(c.requiresWorkspaceChange, false);
  assert.equal(c.requiresValidationCommand, false);
  assert.equal(c.requiresFileRead, true);
  assert.equal(c.requiresSearchResult, false);
});

test("buildAcceptanceCriteria sets taskType for coding prompts", () => {
  const c = buildAcceptanceCriteria("Add a new route to the Express server");
  assert.equal(c.taskType, "coding");
  assert.equal(c.requiresWorkspaceChange, true);
  assert.equal(c.requiresValidationCommand, true);
  assert.equal(c.requiresFileRead, false);
  assert.equal(c.requiresSearchResult, false);
});
