const LOCAL_PROVIDER_IDS = new Set(['llamacpp', 'koboldcpp', 'ollama']);

export function isLocalProviderId(providerId = '') {
  return LOCAL_PROVIDER_IDS.has(String(providerId || '').toLowerCase());
}

export function buildProviderCapabilities({
  id = 'unknown',
  type = 'cloud',
  model = '',
  baseUrl = '',
  apiKeyAvailable = false,
  enabled = true,
  supportsChat = true,
  supportsJsonMode = true,
  supportsToolCalls = false,
  supportsStreaming = true,
  supportsStop = true,
  supportsSystemPrompt = true,
  supportsTemperature = true,
  maxContextTokens = 0,
  maxOutputTokens = 0,
  recommendedOutputTokens = 0,
  timeoutMs = 90000,
  isLocal = false,
  requiresApiKey = false
} = {}) {
  const local = isLocal || String(type || '').toLowerCase() === 'local' || isLocalProviderId(id);
  return {
    supportsChat,
    supportsJsonMode,
    supportsToolCalls,
    supportsStreaming,
    supportsStop,
    supportsSystemPrompt,
    supportsTemperature,
    maxContextTokens,
    maxOutputTokens,
    recommendedOutputTokens,
    timeoutMs,
    isLocal: local,
    requiresApiKey: requiresApiKey || (!local && Boolean(baseUrl) && !apiKeyAvailable),
    enabled
  };
}

export function isLocalProvider(provider = {}) {
  return Boolean(provider?.capabilities?.isLocal || provider?.isLocal || isLocalProviderId(provider?.id || provider?.providerId || provider?.code));
}
