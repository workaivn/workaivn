import { createLegacyProviderAdapter } from './legacyAdapterFactory.js';

export function createKoboldcppProviderAdapter() {
  return createLegacyProviderAdapter('koboldcpp', { name: 'KoboldCPP', type: 'local' });
}
