import assert from "node:assert/strict";
import test from "node:test";
import { isFallbackError, autoGenerateResponse } from "../modules/aiagent/aiagent.controller.js";
import { providerRegistry } from "../services/adapters/index.js";
import { AiProviderAdapter } from "../services/adapters/AiProviderAdapter.js";

const BROKEN_PROVIDER = "fail_test_broken";
const WORKING_PROVIDER = "fail_test_working";

class FailAdapter extends AiProviderAdapter {
  constructor() {
    super({ code: BROKEN_PROVIDER, name: "Broken", type: "api" });
  }
  async isConfigured() { return true; }
  getConfigError() { return ""; }
  async run() {
    return { success: false, error: "404 The model `gpt-4-turbo-wrong` does not exist or you do not have access to it." };
  }
}

class SuccessAdapter extends AiProviderAdapter {
  constructor() {
    super({ code: WORKING_PROVIDER, name: "Working", type: "api" });
  }
  async isConfigured() { return true; }
  getConfigError() { return ""; }
  async run() {
    return { success: true, outputText: '{"done":true,"final":"HELLO_WORKAI"}' };
  }
}

test("isFallbackError matches 404 model not found errors", () => {
  const err = "404 The model `gpt-4-turbo` does not exist or you do not have access to it.";
  assert.equal(isFallbackError(err), true);
});

test("isFallbackError matches 400 invalid model errors", () => {
  const err = "400 The model 'fake-model' is not valid";
  assert.equal(isFallbackError(err), true);
});

test("isFallbackError matches 401 unauthorized", () => {
  assert.equal(isFallbackError("401 Unauthorized"), true);
});

test("isFallbackError matches 403 forbidden", () => {
  assert.equal(isFallbackError("403 Forbidden"), true);
});

test("isFallbackError matches 408 timeout", () => {
  assert.equal(isFallbackError("408 Request Timeout"), true);
});

test("isFallbackError matches 409 conflict", () => {
  assert.equal(isFallbackError("409 Conflict"), true);
});

test("isFallbackError matches 429 rate limit", () => {
  assert.equal(isFallbackError("429 Too Many Requests"), true);
});

test("isFallbackError matches 500 server error", () => {
  assert.equal(isFallbackError("500 Internal Server Error"), true);
});

test("isFallbackError matches 502 bad gateway", () => {
  assert.equal(isFallbackError("502 Bad Gateway"), true);
});

test("isFallbackError matches 503 service unavailable", () => {
  assert.equal(isFallbackError("503 Service Unavailable"), true);
});

test("isFallbackError matches 504 gateway timeout", () => {
  assert.equal(isFallbackError("504 Gateway Timeout"), true);
});

test("isFallbackError matches network error", () => {
  assert.equal(isFallbackError("network error"), true);
});

test("isFallbackError matches timeout error", () => {
  assert.equal(isFallbackError("Connection timed out"), true);
});

test("isFallbackError matches API key config errors", () => {
  assert.equal(isFallbackError("GROQ_API_KEY is not set in environment variables"), true);
});

test("isFallbackError matches empty response", () => {
  assert.equal(isFallbackError("Empty response from provider"), true);
});

test("auto fallback skips broken provider and succeeds with working provider", async () => {
  // Register mock adapters
  const failAdapter = new FailAdapter();
  const successAdapter = new SuccessAdapter();
  providerRegistry.adapters.set(BROKEN_PROVIDER, failAdapter);
  providerRegistry.adapters.set(WORKING_PROVIDER, successAdapter);

  const attempts = [];
  const fallbackAgents = [
    { providerId: { code: BROKEN_PROVIDER }, name: "Broken", modelName: "gpt-4-turbo-wrong", temperature: 0.7, maxTokens: 2000 },
    { providerId: { code: WORKING_PROVIDER }, name: "Working", modelName: "gpt-4o-mini", temperature: 0.7, maxTokens: 2000 }
  ];

  try {
    const result = await autoGenerateResponse(
      [{ role: "user", content: "HELLO_WORKAI" }],
      fallbackAgents,
      attempts
    );

    assert.equal(result, '{"done":true,"final":"HELLO_WORKAI"}');
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].provider, "Broken");
    assert.equal(attempts[0].status, "failed");
    assert.match(attempts[0].error, /does not exist/i);
    assert.equal(attempts[1].provider, "Working");
    assert.equal(attempts[1].status, "success");
  } finally {
    providerRegistry.adapters.delete(BROKEN_PROVIDER);
    providerRegistry.adapters.delete(WORKING_PROVIDER);
  }
});

test("auto fallback throws with all attempts when all providers fail", async () => {
  const failAdapter1 = new FailAdapter();
  const failAdapter2 = new FailAdapter();
  providerRegistry.adapters.set(BROKEN_PROVIDER, failAdapter1);
  providerRegistry.adapters.set(WORKING_PROVIDER, failAdapter2);

  const attempts = [];
  const fallbackAgents = [
    { providerId: { code: BROKEN_PROVIDER }, name: "Broken", modelName: "gpt-4-turbo-wrong", temperature: 0.7, maxTokens: 2000 },
    { providerId: { code: WORKING_PROVIDER }, name: "Working", modelName: "gpt-4o-mini", temperature: 0.7, maxTokens: 2000 }
  ];

  try {
    await assert.rejects(
      () => autoGenerateResponse(
        [{ role: "user", content: "HELLO_WORKAI" }],
        fallbackAgents,
        attempts
      ),
      /All AI providers failed/
    );
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].status, "failed");
    assert.equal(attempts[1].status, "failed");
  } finally {
    providerRegistry.adapters.delete(BROKEN_PROVIDER);
    providerRegistry.adapters.delete(WORKING_PROVIDER);
  }
});
