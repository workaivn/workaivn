import { createLegacyProviderAdapter } from './legacyAdapterFactory.js';

export function createOpenRouterProviderAdapter() {
  return createLegacyProviderAdapter('openrouter', { name: 'OpenRouter', type: 'cloud' });
}
