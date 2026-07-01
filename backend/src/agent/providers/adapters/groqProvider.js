import { createLegacyProviderAdapter } from './legacyAdapterFactory.js';

export function createGroqProviderAdapter() {
  return createLegacyProviderAdapter('groq', { name: 'Groq', type: 'cloud' });
}
