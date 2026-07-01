import { providerRegistry as legacyAdapterRegistry } from '../../services/adapters/index.js';
import { buildProviderCapabilities, isLocalProvider } from './ProviderCapabilities.js';
import { checkProviderHealth } from './ProviderHealthCheck.js';

const KNOWN_PROVIDER_IDS = [
  'llamacpp',
  'koboldcpp',
  'ollama',
  'openai',
  'openrouter',
  'gemini',
  'groq',
  'deepseek',
  'mistral',
  'together',
  'fireworks',
  'manual_external',
  'anthropic',
  'cerebras',
  'perplexity',
  'xai',
  'openai_compatible'
];

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null) return false;
  return !['false', '0', 'no', 'off', 'disabled'].includes(String(value).toLowerCase());
}

function buildEnvProviderConfig(providerId, env = process.env) {
  const upper = providerId.toUpperCase();
  const baseUrl = env[`${upper}_BASE_URL`] || env[`${upper}_URL`] || '';
  const apiKeyEnv = `${upper}_API_KEY`;
  const apiKeyAvailable = Boolean(env[apiKeyEnv]);
  const enabled = providerId === 'manual_external' ? false : true;
  return {
    id: providerId,
    name: providerId.replace(/_/g, ' '),
    type: isLocalProvider({ id: providerId }) ? 'local' : 'cloud',
    model: env[`${upper}_MODEL`] || env[`${upper}_MODEL_NAME`] || '',
    baseUrl,
    apiKeyEnv,
    apiKeyAvailable,
    enabled,
    priority: Number(env[`${upper}_PRIORITY`] || 0) || 0,
    local: isLocalProvider({ id: providerId })
  };
}

function normalizeDescriptor(raw = {}, env = process.env) {
  const providerId = String(raw.id || raw.code || raw.providerId || raw.name || '').trim().toLowerCase();
  const local = Boolean(
    (raw.local ?? raw.isLocal ?? isLocalProvider({ id: providerId })) ||
    String(raw.type || '').toLowerCase() === 'local'
  );
  const name = String(raw.name || raw.label || providerId || 'unknown').trim();
  const apiKeyAvailable = Boolean(raw.apiKeyAvailable ?? raw.apiKey ?? env[raw.apiKeyEnv || '']);
  const model = String(raw.model || raw.modelName || '').trim();
  const baseUrl = String(raw.baseUrl || '').trim();
  const enabled = raw.enabled !== undefined ? toBoolean(raw.enabled) : raw.isActive !== undefined ? toBoolean(raw.isActive) : true;
  const type = local ? 'local' : (String(raw.type || 'cloud').toLowerCase() === 'local' ? 'local' : 'cloud');
  const capabilities = buildProviderCapabilities({
    id: providerId,
    type,
    model,
    baseUrl,
    apiKeyAvailable,
    enabled,
    requiresApiKey: Boolean(raw.requiresApiKey || raw.apiKeyEnv),
    timeoutMs: Number(raw.timeoutMs) || 90000,
    isLocal: local
  });

  return {
    id: providerId,
    code: providerId,
    name,
    label: String(raw.label || name),
    type,
    model,
    baseUrl,
    apiKeyEnv: raw.apiKeyEnv || null,
    apiKeyAvailable,
    enabled,
    priority: Number(raw.priority || raw.weight || 0) || 0,
    local,
    capabilities,
    adapter: raw.adapter || null,
    source: raw.source || 'runtime',
    raw
  };
}

function sortByPriorityAndHealth(left, right) {
  const priorityDelta = (Number(right.priority || 0) - Number(left.priority || 0));
  if (priorityDelta !== 0) return priorityDelta;
  if (left.local !== right.local) return left.local ? -1 : 1;
  return String(left.id).localeCompare(String(right.id));
}

export class ProviderRegistry {
  constructor({
    runtimeConfig = [],
    dbConfig = [],
    env = process.env,
    adapterRegistry = legacyAdapterRegistry
  } = {}) {
    this.env = env;
    this.adapterRegistry = adapterRegistry;
    this.providers = new Map();
    this.load({ runtimeConfig, dbConfig, env });
  }

  load({ runtimeConfig = [], dbConfig = [], env = process.env } = {}) {
    this.providers.clear();
    const seen = new Set();
    const add = (descriptor) => {
      if (!descriptor?.id || seen.has(descriptor.id)) return;
      seen.add(descriptor.id);
      this.providers.set(descriptor.id, descriptor);
    };

    for (const entry of Array.isArray(runtimeConfig) ? runtimeConfig : []) {
      add(normalizeDescriptor(entry, env));
    }

    for (const entry of Array.isArray(dbConfig) ? dbConfig : []) {
      add(normalizeDescriptor({
        id: entry.code || entry.id,
        name: entry.name || entry.code,
        type: String(entry.type || '').toLowerCase() === 'manual' ? 'cloud' : (entry.code && ['llamacpp', 'koboldcpp', 'ollama'].includes(String(entry.code).toLowerCase()) ? 'local' : 'cloud'),
        model: entry.modelName || entry.model || '',
        baseUrl: entry.baseUrl || '',
        apiKeyEnv: entry.apiKeyEnv || null,
        apiKeyAvailable: Boolean(entry.apiKey || entry.apiKeyAvailable),
        enabled: entry.isActive !== false,
        priority: Number(entry.priority || 0) || 0,
        source: 'db'
      }, env));
    }

    for (const providerId of KNOWN_PROVIDER_IDS) {
      if (seen.has(providerId)) continue;
      add(normalizeDescriptor(buildEnvProviderConfig(providerId, env), env));
    }
  }

  getProviders({ includeDisabled = false } = {}) {
    return [...this.providers.values()]
      .filter(provider => includeDisabled || provider.enabled !== false)
      .sort(sortByPriorityAndHealth);
  }

  getProvider(providerId = '') {
    const key = String(providerId || '').toLowerCase();
    return this.providers.get(key) || null;
  }

  hasProvider(providerId = '') {
    return Boolean(this.getProvider(providerId));
  }

  async healthCheck(providerId = '', adapter = null) {
    const provider = typeof providerId === 'string' ? this.getProvider(providerId) : providerId;
    if (!provider) {
      return { healthy: false, provider: providerId || null, model: null, reason: 'provider_not_found' };
    }
    return checkProviderHealth(provider, adapter);
  }
}

export function createProviderRegistry(options = {}) {
  return new ProviderRegistry(options);
}
