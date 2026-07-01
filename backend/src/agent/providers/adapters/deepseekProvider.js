import { createLegacyProviderAdapter } from './legacyAdapterFactory.js';

export function createDeepseekProviderAdapter() {
  return createLegacyProviderAdapter('deepseek', { name: 'DeepSeek', type: 'cloud' });
}
