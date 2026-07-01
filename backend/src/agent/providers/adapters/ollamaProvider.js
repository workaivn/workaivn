import { createLegacyProviderAdapter } from './legacyAdapterFactory.js';

export function createOllamaProviderAdapter() {
  return createLegacyProviderAdapter('ollama', { name: 'Ollama Local', type: 'local' });
}
