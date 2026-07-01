import { createLegacyProviderAdapter } from './legacyAdapterFactory.js';

export function createMistralProviderAdapter() {
  return createLegacyProviderAdapter('mistral', { name: 'Mistral AI', type: 'cloud' });
}
