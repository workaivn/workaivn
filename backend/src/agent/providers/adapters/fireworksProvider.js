import { createLegacyProviderAdapter } from './legacyAdapterFactory.js';

export function createFireworksProviderAdapter() {
  return createLegacyProviderAdapter('fireworks', { name: 'Fireworks AI', type: 'cloud' });
}
