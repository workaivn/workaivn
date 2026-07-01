import { createLegacyProviderAdapter } from './legacyAdapterFactory.js';

export function createGeminiProviderAdapter() {
  return createLegacyProviderAdapter('gemini', { name: 'Gemini', type: 'cloud' });
}
