import { createLegacyProviderAdapter } from './legacyAdapterFactory.js';

export function createOpenAIProviderAdapter() {
  return createLegacyProviderAdapter('openai', { name: 'OpenAI', type: 'cloud' });
}
