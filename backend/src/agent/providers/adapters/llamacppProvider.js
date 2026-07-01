import { createLegacyProviderAdapter } from './legacyAdapterFactory.js';

export function createLlamacppProviderAdapter() {
  return createLegacyProviderAdapter('llamacpp', { name: 'llama.cpp', type: 'local' });
}
