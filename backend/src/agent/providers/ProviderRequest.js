function normalizeMessages(messages = []) {
  return Array.isArray(messages)
    ? messages
        .map(message => ({
          role: String(message?.role || 'user'),
          content: message?.content ?? ''
        }))
        .filter(message => String(message.content ?? '').length > 0 || message.role === 'system')
    : [];
}

export function normalizeProviderRequest(input = {}) {
  const messages = normalizeMessages(input.messages);
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  const systemPrompt = typeof input.systemPrompt === 'string' ? input.systemPrompt : '';
  const metadata = input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {};

  return {
    providerId: String(input.providerId || input.provider || input.providerCode || '').trim() || null,
    model: String(input.model || input.modelName || '').trim() || null,
    messages,
    prompt,
    systemPrompt,
    taskType: String(input.taskType || input.mode || input.intent || 'CODING').trim() || 'CODING',
    purpose: String(input.purpose || 'code_generation').trim() || 'code_generation',
    responseFormat: input.responseFormat || null,
    temperature: Number.isFinite(Number(input.temperature)) ? Number(input.temperature) : 0,
    maxTokens: Number.isFinite(Number(input.maxTokens)) ? Number(input.maxTokens) : null,
    stop: input.stop ?? null,
    timeoutMs: Number.isFinite(Number(input.timeoutMs)) ? Number(input.timeoutMs) : null,
    metadata,
    providers: Array.isArray(input.providers) ? input.providers.filter(Boolean) : [],
    localPreference: input.localPreference ?? null,
    retryMetadata: input.retryMetadata || null,
    quotaState: input.quotaState || null
  };
}
