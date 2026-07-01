export function recordProviderTelemetry(entry = {}) {
  console.log('[PROVIDER_TELEMETRY]', {
    provider: entry.provider || null,
    model: entry.model || null,
    purpose: entry.purpose || null,
    promptTokens: entry.promptTokens ?? null,
    completionTokens: entry.completionTokens ?? null,
    latencyMs: entry.latencyMs ?? null,
    errorType: entry.errorType || null,
    fallbackCount: entry.fallbackCount ?? 0
  });
}
