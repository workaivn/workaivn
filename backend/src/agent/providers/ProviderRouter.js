import { providerRegistry as legacyAdapterRegistry } from '../../services/adapters/index.js';
import { normalizeProviderRequest } from './ProviderRequest.js';
import { ProviderRegistry, createProviderRegistry } from './ProviderRegistry.js';
import { applyProviderPromptPolicy } from './ProviderPromptPolicy.js';
import { resolveProviderTokenBudget } from './ProviderTokenBudget.js';
import { resolveProviderTimeoutPolicy } from './ProviderTimeoutPolicy.js';
import { normalizeProviderResponse } from './ProviderResponseNormalizer.js';
import { normalizeProviderError } from './ProviderError.js';
import { recordProviderTelemetry } from './ProviderTelemetry.js';

function normalizeProviderCandidate(candidate = {}, index = 0) {
  const providerId = String(candidate.providerId?.code || candidate.providerId || candidate.code || candidate.id || candidate.provider || '').trim().toLowerCase();
  const type = String(candidate.providerId?.type || candidate.type || (['llamacpp', 'koboldcpp', 'ollama'].includes(providerId) ? 'local' : 'cloud')).toLowerCase();
  const local = type === 'local' || ['llamacpp', 'koboldcpp', 'ollama'].includes(providerId);
  return {
    id: providerId,
    code: providerId,
    name: candidate.name || candidate.label || providerId,
    type,
    model: String(candidate.modelName || candidate.model || candidate.modelId || '').trim(),
    baseUrl: candidate.baseUrl || '',
    apiKeyAvailable: Boolean(candidate.apiKey || candidate.apiKeyAvailable),
    enabled: candidate.isActive !== false && candidate.enabled !== false,
    priority: Number(candidate.priority || candidate.weight || candidate.rank || 0) || (1000 - index),
    local,
    capabilities: candidate.capabilities || {
      isLocal: local,
      requiresApiKey: Boolean(candidate.apiKeyEnv && !candidate.apiKeyAvailable)
    },
    adapter: candidate.adapter || null,
    raw: candidate
  };
}

function dedupeByProviderId(providers = []) {
  const seen = new Set();
  const result = [];
  for (const provider of providers) {
    if (!provider?.id || seen.has(provider.id)) continue;
    seen.add(provider.id);
    result.push(provider);
  }
  return result;
}

function sortCandidates(providers = [], request = {}) {
  const requestedProvider = String(request.providerId || '').toLowerCase();
  const localPreference = request.localPreference;
  return [...providers].sort((left, right) => {
    if (requestedProvider) {
      if (left.id === requestedProvider && right.id !== requestedProvider) return -1;
      if (right.id === requestedProvider && left.id !== requestedProvider) return 1;
    }

    if (localPreference === true || localPreference === 'local') {
      if (left.local !== right.local) return left.local ? -1 : 1;
    } else if (localPreference === false || localPreference === 'cloud') {
      if (left.local !== right.local) return left.local ? 1 : -1;
    }

    const priorityDelta = Number(right.priority || 0) - Number(left.priority || 0);
    if (priorityDelta !== 0) return priorityDelta;
    if (left.local !== right.local) return left.local ? -1 : 1;
    return String(left.id).localeCompare(String(right.id));
  });
}

export class ProviderRouter {
  constructor({
    registry = null,
    adapterRegistry = legacyAdapterRegistry,
    allowFallback = true
  } = {}) {
    this.registry = registry || createProviderRegistry({ adapterRegistry });
    this.adapterRegistry = adapterRegistry;
    this.allowFallback = allowFallback;
  }

  resolveCandidates(request = {}) {
    const normalizedRequest = normalizeProviderRequest(request);
    const providerList = normalizedRequest.providers.length > 0
      ? normalizedRequest.providers.map((candidate, index) => normalizeProviderCandidate(candidate, index))
      : this.registry.getProviders({ includeDisabled: false });
    return sortCandidates(dedupeByProviderId(providerList), normalizedRequest);
  }

  async selectProvider(request = {}) {
    const normalizedRequest = normalizeProviderRequest(request);
    const candidates = this.resolveCandidates(normalizedRequest);
    const providerErrors = [];

    for (const provider of candidates) {
      const adapter = provider.adapter || this.adapterRegistry.getAdapter(provider.id);
      const health = await this.registry.healthCheck(provider, adapter);
      if (!health.healthy) {
        providerErrors.push({
          provider: provider.id,
          model: provider.model || normalizedRequest.model || null,
          error: health.reason || 'provider_unavailable'
        });
        console.log('[PROVIDER_UNAVAILABLE]', {
          provider: provider.id,
          model: provider.model || normalizedRequest.model || null,
          reason: health.reason || 'provider_unavailable'
        });
        continue;
      }

      console.log('[PROVIDER_SELECTED]', {
        provider: provider.id,
        model: provider.model || normalizedRequest.model || null,
        purpose: normalizedRequest.purpose
      });
      return { provider, adapter, providerErrors };
    }

    console.log('[PROVIDER_UNAVAILABLE]', {
      provider: normalizedRequest.providerId || null,
      model: normalizedRequest.model || null,
      reason: 'no_healthy_provider'
    });
    return { provider: null, adapter: null, providerErrors };
  }

  async generate(request = {}) {
    const normalizedRequest = normalizeProviderRequest(request);
    const candidates = this.resolveCandidates(normalizedRequest);
    const providerErrors = [];
    let fallbackCount = 0;

    for (const candidate of candidates) {
      const selection = await this.selectProvider({
        ...normalizedRequest,
        providers: [candidate]
      });
      if (!selection.provider || !selection.adapter) {
        providerErrors.push(...selection.providerErrors);
        continue;
      }

      const provider = selection.provider;
      const adapter = selection.adapter;
      const promptApplied = applyProviderPromptPolicy(normalizedRequest, provider);
      const tokenBudget = resolveProviderTokenBudget({
        provider,
        model: promptApplied.model || provider.model || normalizedRequest.model || null,
        purpose: promptApplied.purpose,
        requestedMaxTokens: promptApplied.maxTokens,
        promptLength: String(promptApplied.prompt || promptApplied.messages.map(message => message.content || '').join('\n')).length,
        maxTokensCapOverride: request.maxTokensCapOverride,
        configuredMax: provider.capabilities?.maxOutputTokens || null,
        source: provider.capabilities?.isLocal ? 'local_provider' : 'cloud_provider'
      });
      const timeoutPolicy = resolveProviderTimeoutPolicy({
        provider,
        purpose: promptApplied.purpose,
        timeoutMs: promptApplied.timeoutMs,
        configuredTimeoutMs: provider.capabilities?.timeoutMs || null
      });

      const providerRequest = {
        providerId: provider.id,
        model: promptApplied.model || provider.model || normalizedRequest.model || null,
        modelName: promptApplied.model || provider.model || normalizedRequest.model || null,
        messages: promptApplied.messages,
        prompt: promptApplied.prompt,
        systemPrompt: promptApplied.systemPrompt,
        taskType: promptApplied.taskType,
        purpose: promptApplied.purpose,
        responseFormat: promptApplied.responseFormat,
        temperature: promptApplied.temperature,
        maxTokens: tokenBudget.effectiveMaxTokens,
        stop: promptApplied.stop,
        timeoutMs: timeoutPolicy.timeoutMs,
        metadata: {
          ...promptApplied.metadata,
          promptPolicy: promptApplied.promptPolicy,
          tokenBudget,
          timeoutPolicy,
          providerAttempts: providerErrors,
          providerErrors
        }
      };

      const startedAt = Date.now();
      try {
        const raw = await adapter.run({
          modelName: providerRequest.modelName,
          messages: providerRequest.messages,
          prompt: providerRequest.prompt,
          systemPrompt: providerRequest.systemPrompt,
          temperature: providerRequest.temperature,
          maxTokens: providerRequest.maxTokens,
          stop: providerRequest.stop,
          modelCallTimeout: providerRequest.timeoutMs,
          purpose: providerRequest.purpose,
          maxTokensCapOverride: request.maxTokensCapOverride,
          timeoutMs: providerRequest.timeoutMs
        });

        const normalized = normalizeProviderResponse({
          ...raw,
          provider: provider.id,
          model: providerRequest.modelName,
          latencyMs: Date.now() - startedAt,
          metadata: providerRequest.metadata
        }, providerRequest);

        if (normalized.success) {
          recordProviderTelemetry({
            provider: normalized.provider,
            model: normalized.model,
            purpose: providerRequest.purpose,
            promptTokens: normalized.usage?.prompt_tokens ?? normalized.usage?.promptTokens ?? null,
            completionTokens: normalized.usage?.completion_tokens ?? normalized.usage?.completionTokens ?? null,
            latencyMs: normalized.latencyMs,
            errorType: null,
            fallbackCount
          });
          return normalized;
        }

        const error = normalized.error || normalizeProviderError({ message: 'Invalid provider response', raw }, provider.id, providerRequest.modelName);
        providerErrors.push({
          provider: provider.id,
          model: providerRequest.modelName,
          error
        });
        recordProviderTelemetry({
          provider: provider.id,
          model: providerRequest.modelName,
          purpose: providerRequest.purpose,
          latencyMs: normalized.latencyMs,
          errorType: error.type,
          fallbackCount
        });
        if (!this.allowFallback || !error.retryable) {
          return {
            ...normalized,
            success: false,
            error,
            metadata: {
              ...providerRequest.metadata,
              providerErrors
            }
          };
        }
        fallbackCount += 1;
        console.log('[PROVIDER_FALLBACK]', {
          from: provider.id,
          model: providerRequest.modelName,
          errorType: error.type,
          fallbackCount
        });
      } catch (error) {
        const normalizedError = normalizeProviderError(error, provider.id, providerRequest.modelName);
        providerErrors.push({
          provider: provider.id,
          model: providerRequest.modelName,
          error: normalizedError
        });
        recordProviderTelemetry({
          provider: provider.id,
          model: providerRequest.modelName,
          purpose: providerRequest.purpose,
          latencyMs: Date.now() - startedAt,
          errorType: normalizedError.type,
          fallbackCount
        });
        if (!this.allowFallback || !normalizedError.retryable) {
          return {
            success: false,
            text: '',
            raw: error?.response?.data || error,
            normalizedText: '',
            usage: null,
            finishReason: null,
            provider: provider.id,
            model: providerRequest.modelName,
            latencyMs: Date.now() - startedAt,
            error: normalizedError,
            metadata: {
              ...providerRequest.metadata,
              providerErrors
            }
          };
        }
        fallbackCount += 1;
        console.log('[PROVIDER_FALLBACK]', {
          from: provider.id,
          model: providerRequest.modelName,
          errorType: normalizedError.type,
          fallbackCount
        });
      }
    }

    const error = providerErrors[providerErrors.length - 1]?.error || normalizeProviderError({
      message: 'No provider available',
      raw: providerErrors
    }, normalizedRequest.providerId, normalizedRequest.model);
    return {
      success: false,
      text: '',
      raw: null,
      normalizedText: '',
      usage: null,
      finishReason: null,
      provider: normalizedRequest.providerId || null,
      model: normalizedRequest.model || null,
      latencyMs: null,
      error,
      metadata: {
        providerErrors
      }
    };
  }
}

export function createProviderRouter(options = {}) {
  return new ProviderRouter(options);
}

export function createProviderGenerateResponse({
  providerRouter = new ProviderRouter(),
  request = {}
} = {}) {
  return async function generateResponse(input = {}) {
    const response = await providerRouter.generate({
      ...request,
      ...input,
      messages: input.messages || request.messages || [],
      purpose: input.purpose || request.purpose || 'code_generation'
    });
    if (!response.success) {
      const message = response.error?.message || response.error?.message || response.error?.type || 'Provider error';
      throw new Error(message);
    }
    return response.normalizedText || response.text || '';
  };
}
