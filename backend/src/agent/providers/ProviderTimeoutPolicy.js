const PURPOSE_TIMEOUTS = {
  write_coordinator: { local: 90000, cloud: 120000 },
  delta_retry: { local: 60000, cloud: 90000 },
  framework_repair: { local: 90000, cloud: 120000 },
  classification: { local: 30000, cloud: 60000 },
  summarization: { local: 30000, cloud: 60000 },
  planning_assist: { local: 60000, cloud: 90000 },
  code_generation: { local: 90000, cloud: 120000 }
};

function toPositiveNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

export function resolveProviderTimeoutPolicy({
  provider = {},
  purpose = 'code_generation',
  timeoutMs = null,
  configuredTimeoutMs = null
} = {}) {
  const local = Boolean(provider?.capabilities?.isLocal || provider?.isLocal || provider?.type === 'local');
  const purposeTimeout = PURPOSE_TIMEOUTS[purpose] || PURPOSE_TIMEOUTS.code_generation;
  const resolvedTimeout = toPositiveNumber(timeoutMs) ?? toPositiveNumber(configuredTimeoutMs) ?? (local ? purposeTimeout.local : purposeTimeout.cloud);
  const resolved = {
    provider: provider?.id || provider?.providerId || provider?.code || provider || '',
    purpose,
    timeoutMs: resolvedTimeout,
    source: timeoutMs ? 'request' : configuredTimeoutMs ? 'configured' : 'purpose_default'
  };
  console.log('[PROVIDER_TIMEOUT_POLICY]', resolved);
  return resolved;
}
