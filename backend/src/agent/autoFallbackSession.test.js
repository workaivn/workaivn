import assert from "node:assert/strict";
import test from "node:test";
import { autoGenerateResponse } from "../modules/aiagent/aiagent.controller.js";
import { providerRegistry } from "../services/adapters/index.js";
import { AiProviderAdapter } from "../services/adapters/AiProviderAdapter.js";

const WORKING_PROVIDER = "test_working";
const OLLAMA_PROVIDER = "ollama";

class WorkingAdapter extends AiProviderAdapter {
  constructor() {
    super({ code: WORKING_PROVIDER, name: "Working", type: "api" });
  }
  async isConfigured() { return true; }
  getConfigError() { return ""; }
  async run() { return { success: true, outputText: '{"done":true,"final":"HELLO_WORKAI"}' }; }
}

class OllamaAdapter extends AiProviderAdapter {
  constructor() {
    super({ code: OLLAMA_PROVIDER, name: "Ollama", type: "local" });
  }
  async isConfigured() { return true; }
  getConfigError() { return ""; }
  async run() { return { success: true, outputText: '{"done":true,"final":"HELLO_FROM_OLLAMA"}' }; }
}

test("auto fallback resets between runs and starts from first provider", async () => {
  const working = new WorkingAdapter();
  const ollama = new OllamaAdapter();
  providerRegistry.adapters.set(WORKING_PROVIDER, working);
  providerRegistry.adapters.set(OLLAMA_PROVIDER, ollama);

  const agents = [
    { providerId: { code: WORKING_PROVIDER, isActive: true }, name: "Working", modelName: "gpt-4o-mini", maxTokens: 2000 },
    { providerId: { code: OLLAMA_PROVIDER, isActive: true }, name: "Ollama", modelName: "llama3.1", maxTokens: 2000 }
  ];

  try {
    // Run 1
    const attempts1 = [];
    const res1 = await autoGenerateResponse([
      { role: "user", content: "HELLO_WORKAI" }
    ], [...agents], attempts1);
    assert.equal(res1, '{"done":true,"final":"HELLO_WORKAI"}');
    assert.equal(attempts1[0].provider, "Working");

    // Run 2 in same session; must start from Working again
    const attempts2 = [];
    const res2 = await autoGenerateResponse([
      { role: "user", content: "HELLO_WORKAI" }
    ], [...agents], attempts2);
    assert.equal(res2, '{"done":true,"final":"HELLO_WORKAI"}');
    assert.equal(attempts2[0].provider, "Working");
  } finally {
    providerRegistry.adapters.delete(WORKING_PROVIDER);
    providerRegistry.adapters.delete(OLLAMA_PROVIDER);
  }
});
