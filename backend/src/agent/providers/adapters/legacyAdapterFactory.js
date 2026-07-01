import { providerRegistry as legacyProviderRegistry } from '../../../services/adapters/index.js';
import { buildProviderCapabilities } from '../ProviderCapabilities.js';

export function createLegacyProviderAdapter(providerId, {
  name = providerId,
  type = 'cloud'
} = {}) {
  const legacyAdapter = legacyProviderRegistry.getAdapter(providerId);
  return {
    id: providerId,
    name,
    type,
    capabilities: buildProviderCapabilities({ id: providerId, type, isLocal: type === 'local' }),
    async healthCheck() {
      const configured = await legacyAdapter.isConfigured();
      return {
        healthy: configured,
        provider: providerId,
        model: null,
        reason: configured ? null : legacyAdapter.getConfigError()
      };
    },
    async generate(request = {}) {
      return legacyAdapter.run({
        modelName: request.modelName || request.model || request.modelId || null,
        messages: request.messages || [],
        temperature: request.temperature ?? 0,
        maxTokens: request.maxTokens ?? 0,
        maxTokensCapOverride: request.maxTokensCapOverride,
        modelCallTimeout: request.timeoutMs ?? request.modelCallTimeout,
        purpose: request.purpose,
        stop: request.stop
      });
    }
  };
}
