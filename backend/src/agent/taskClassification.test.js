import assert from "node:assert/strict";
import test from "node:test";
import { classifyTaskType, buildAcceptanceCriteria } from "./acceptanceCriteria.js";

test("classifyTaskType classifies 'HELLO_WORKAI' as CHAT", () => {
  const result = classifyTaskType("HELLO_WORKAI");
  assert.equal(result, "CHAT");
});

test("classifyTaskType classifies short greeting as CHAT", () => {
  const result = classifyTaskType("Hi there");
  assert.equal(result, "CHAT");
});

test("classifyTaskType classifies search prompt as SEARCH", () => {
  const result = classifyTaskType("Tìm package.json và cho biết version");
  assert.equal(result, "SEARCH");
});

test("classifyTaskType classifies search with 'find' keyword as SEARCH", () => {
  const result = classifyTaskType("find all files with routes in config");
  assert.equal(result, "SEARCH");
});

test("classifyTaskType classifies analysis prompt as ANALYSIS", () => {
  const result = classifyTaskType("Phân tích cấu trúc thư mục src");
  assert.equal(result, "ANALYSIS");
});

test("classifyTaskType classifies analyze keyword as ANALYSIS", () => {
  const result = classifyTaskType("analyze the project structure");
  assert.equal(result, "ANALYSIS");
});

test("classifyTaskType classifies add + npm run as CODING (not SEARCH)", () => {
  const result = classifyTaskType("Find package.json.\nAdd:\n\"check_test\": \"node --version\"\nRun:\nnpm run check_test");
  assert.equal(result, "CODING");
});

test("classifyTaskType classifies coding prompt as CODING", () => {
  const result = classifyTaskType("Add a new route to the Express server");
  assert.equal(result, "CODING");
});

test("classifyTaskType defaults to CODING for unknown prompts", () => {
  const result = classifyTaskType("Build a complete authentication system");
  assert.equal(result, "CODING");
});

test("classifyTaskType classifies 'run npm test' as CODING", () => {
  const result = classifyTaskType("Run npm test and fix any errors");
  assert.equal(result, "CODING");
});

test("buildAcceptanceCriteria sets taskType for CHAT prompts", () => {
  const c = buildAcceptanceCriteria("HELLO_WORKAI");
  assert.equal(c.taskType, "CHAT");
  assert.equal(c.requiresWorkspaceChange, false);
  assert.equal(c.requiresValidationCommand, false);
  assert.equal(c.requiresFileRead, false);
  assert.equal(c.requiresSearchResult, false);
});

test("buildAcceptanceCriteria sets taskType for SEARCH prompts", () => {
  const c = buildAcceptanceCriteria("Tìm package.json và cho biết version");
  assert.equal(c.taskType, "SEARCH");
  assert.equal(c.requiresWorkspaceChange, false);
  assert.equal(c.requiresValidationCommand, false);
  assert.equal(c.requiresFileRead, true);
  assert.equal(c.requiresSearchResult, true);
});

test("buildAcceptanceCriteria sets taskType for ANALYSIS prompts", () => {
  const c = buildAcceptanceCriteria("Phân tích cấu trúc thư mục src");
  assert.equal(c.taskType, "ANALYSIS");
  assert.equal(c.requiresWorkspaceChange, false);
  assert.equal(c.requiresValidationCommand, false);
  assert.equal(c.requiresFileRead, true);
  assert.equal(c.requiresSearchResult, false);
});

test("buildAcceptanceCriteria sets taskType for CODING prompts", () => {
  const c = buildAcceptanceCriteria("Add a new route to the Express server");
  assert.equal(c.taskType, "CODING");
  assert.equal(c.requiresWorkspaceChange, true);
  assert.equal(c.requiresValidationCommand, true);
  assert.equal(c.requiresFileRead, false);
  assert.equal(c.requiresSearchResult, false);
});

test("buildAcceptanceCriteria classifies add+run prompt as CODING", () => {
  const c = buildAcceptanceCriteria("Find package.json.\nAdd:\n\"check_test\": \"node --version\"\nRun:\nnpm run check_test");
  assert.equal(c.taskType, "CODING");
  assert.equal(c.requiresWorkspaceChange, true);
  assert.equal(c.requiresValidationCommand, true);
});
