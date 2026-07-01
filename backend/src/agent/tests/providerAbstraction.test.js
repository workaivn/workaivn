import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ProviderRouter,
  createProviderRegistry,
  resolveProviderTokenBudget,
  applyProviderPromptPolicy,
  normalizeProviderResponse,
  normalizeProviderError
} from '../providers/index.js';

function captureConsole() {
  const logs = [];
  const original = console.log;
  console.log = (...args) => {
    logs.push(args.map(arg => {
      if (typeof arg === 'string') return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }).join(' '));
  };
  return {
    logs,
    restore() {
      console.log = original;
    }
  };
}

function createAdapter({ run, isConfigured = true, configError = 'not_configured' } = {}) {
  return {
    async isConfigured() {
      return isConfigured;
    },
    getConfigError() {
      return configError;
    },
    async run(request = {}) {
      if (typeof run === 'function') {
        return run(request);
      }
      return run;
    }
  };
}

function createRouterHarness({
  providers = [],
  adapterMap = new Map(),
  allowFallback = true,
  healthCheck = async () => ({ healthy: true, reason: null })
} = {}) {
  return new ProviderRouter({
    registry: {
      getProviders: () => providers,
      healthCheck: async (provider, adapter) => healthCheck(provider, adapter)
    },
    adapterRegistry: {
      getAdapter(providerId) {
        const adapter = adapterMap.get(providerId);
        if (!adapter) {
          throw new Error(`Missing adapter for ${providerId}`);
        }
        return adapter;
      }
    },
    allowFallback
  });
}

test('ProviderRegistry loads runtime providers', () => {
  const registry = createProviderRegistry({
    runtimeConfig: [
      { id: 'llamacpp', name: 'Local Llama', type: 'local', enabled: true, priority: 50 },
      { id: 'openai', name: 'OpenAI', type: 'cloud', enabled: true, priority: 10 }
    ],
    env: {}
  });

  assert.ok(registry.getProvider('llamacpp'));
  assert.ok(registry.getProvider('openai'));
  assert.equal(registry.getProviders().length >= 2, true);
});

test('ProviderTokenBudget respects requested local maxTokens without 512 clamp', () => {
  const logger = captureConsole();
  try {
    const budget = resolveProviderTokenBudget({
      provider: { id: 'llamacpp', type: 'local', capabilities: { isLocal: true } },
      model: 'local-coder',
      purpose: 'write_coordinator',
      requestedMaxTokens: 4096,
      source: 'test'
    });

    assert.equal(budget.requestedMaxTokens, 4096);
    assert.equal(budget.effectiveMaxTokens, 4096);
    assert.equal(budget.source, 'test');
    assert.ok(logger.logs.some(line => line.includes('[PROVIDER_TOKEN_BUDGET_RESOLVED]')));
  } finally {
    logger.restore();
  }
});

test('ProviderPromptPolicy compacts local prompts and injects JSON instruction', () => {
  const result = applyProviderPromptPolicy(
    {
      prompt: '  return structured output  ',
      messages: [{ role: 'user', content: '   keep    it    tight   ' }],
      responseFormat: { type: 'json' },
      purpose: 'write_coordinator'
    },
    { id: 'llamacpp', type: 'local', capabilities: { isLocal: true } }
  );

  assert.equal(result.prompt, 'return structured output');
  assert.equal(result.promptPolicy.compacted, true);
  assert.equal(result.messages[0].role, 'system');
  assert.match(result.messages[0].content, /Return only valid JSON/i);
  assert.equal(result.messages[1].content, 'keep it tight');
});

test('ProviderResponseNormalizer handles multiple response shapes', () => {
  const openAi = normalizeProviderResponse({
    choices: [{ message: { content: 'Hello world' } }],
    usage: { prompt_tokens: 7 }
  }, { providerId: 'openai', model: 'gpt' });

  assert.equal(openAi.success, true);
  assert.equal(openAi.normalizedText, 'Hello world');

  const fencedJson = normalizeProviderResponse({
    text: '```json\n{"content":"From fenced JSON"}\n```'
  }, { providerId: 'llamacpp', model: 'coder' });

  assert.equal(fencedJson.success, true);
  assert.equal(fencedJson.normalizedText, 'From fenced JSON');

  const invalid = normalizeProviderResponse({}, { providerId: 'mystery', model: 'bad' });
  assert.equal(invalid.success, false);
  assert.equal(invalid.error.type, 'INVALID_RESPONSE');
});

test('ProviderError normalizes timeout and rate limit failures', () => {
  const timeout = normalizeProviderError(new Error('Request timed out after 30s'), 'llamacpp', 'coder');
  const quota = normalizeProviderError({ message: '429 too many requests' }, 'openrouter', 'coder');

  assert.equal(timeout.type, 'TIMEOUT');
  assert.equal(timeout.retryable, true);
  assert.equal(quota.type, 'RATE_LIMIT');
  assert.equal(quota.retryable, true);
});

test('ProviderRouter forwards requested token budget to local providers', async () => {
  const received = [];
  const providers = [
    { id: 'llamacpp', name: 'Local', type: 'local', model: 'local-coder', priority: 10, capabilities: { isLocal: true } }
  ];
  const router = createRouterHarness({
    providers,
    adapterMap: new Map([
      ['llamacpp', createAdapter({
        run: async request => {
          received.push(request);
          return { outputText: 'ok' };
        }
      })]
    ])
  });

  const result = await router.generate({
    providerId: 'llamacpp',
    model: 'local-coder',
    providers,
    messages: [{ role: 'user', content: 'Generate code' }],
    purpose: 'write_coordinator',
    maxTokens: 4096
  });

  assert.equal(result.success, true);
  assert.equal(result.normalizedText, 'ok');
  assert.equal(received[0].maxTokens, 4096);
});

test('ProviderRouter falls back after retryable provider failure', async () => {
  const providers = [
    { id: 'llamacpp', name: 'Local', type: 'local', model: 'broken', priority: 20, capabilities: { isLocal: true } },
    { id: 'openai', name: 'Cloud', type: 'cloud', model: 'cloud-ok', priority: 10, capabilities: { isLocal: false } }
  ];
  const router = createRouterHarness({
    providers,
    adapterMap: new Map([
      ['llamacpp', createAdapter({
        run: async () => {
          const error = new Error('timeout waiting for response');
          error.response = { status: 408 };
          throw error;
        }
      })],
      ['openai', createAdapter({
        run: async () => ({ outputText: 'fallback success' })
      })]
    ])
  });

  const result = await router.generate({
    providerId: 'llamacpp',
    providers,
    messages: [{ role: 'user', content: 'Generate code' }],
    purpose: 'code_generation'
  });

  assert.equal(result.success, true);
  assert.equal(result.normalizedText, 'fallback success');
  assert.equal(result.provider, 'openai');
  assert.ok(Array.isArray(result.metadata.providerErrors));
  assert.equal(result.metadata.providerErrors.length >= 1, true);
});
