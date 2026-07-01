const PURPOSE_DEFAULTS = {
  code_generation: { local: 1400, cloud: 2400 },
  write_coordinator: { local: 1400, cloud: 2200 },
  delta_retry: { local: 800, cloud: 1200 },
  framework_repair: { local: 900, cloud: 1400 },
  summarization: { local: 650, cloud: 900 },
  classification: { local: 420, cloud: 600 },
  planning_assist: { local: 800, cloud: 1200 },
  final_summary: { local: 650, cloud: 800 }
};

function toPositiveNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function estimatePromptBudget(promptLength = 0, local = false, purpose = 'code_generation') {
  const base = PURPOSE_DEFAULTS[purpose] || PURPOSE_DEFAULTS.code_generation;
  const defaultBudget = local ? base.local : base.cloud;
  if (!promptLength) return defaultBudget;
  if (local) {
    if (promptLength > 12000) return Math.max(600, Math.min(defaultBudget, 1200));
    if (promptLength > 5000) return Math.max(800, Math.min(defaultBudget, 1400));
    return defaultBudget;
  }
  if (promptLength > 20000) return Math.max(1000, Math.min(defaultBudget, 1800));
  if (promptLength > 8000) return Math.max(1200, Math.min(defaultBudget, 2000));
  return defaultBudget;
}

export function resolveProviderTokenBudget({
  provider = {},
  model = '',
  purpose = 'code_generation',
  requestedMaxTokens = null,
  promptLength = 0,
  configuredMax = null,
  hardLimit = null,
  maxTokensCapOverride = null,
  source = 'requested'
} = {}) {
  const local = Boolean(provider?.capabilities?.isLocal || provider?.isLocal || provider?.type === 'local');
  const requested = toPositiveNumber(requestedMaxTokens) ?? estimatePromptBudget(promptLength, local, purpose);
  let effectiveMaxTokens = requested;
  let resolvedSource = source || 'requested';

  const override = toPositiveNumber(maxTokensCapOverride);
  if (override != null && override < effectiveMaxTokens) {
    effectiveMaxTokens = override;
    resolvedSource = 'maxTokensCapOverride';
  }

  const configured = toPositiveNumber(configuredMax);
  if (configured != null && configured < effectiveMaxTokens) {
    effectiveMaxTokens = configured;
    resolvedSource = 'configuredMax';
  }

  const limit = toPositiveNumber(hardLimit);
  if (limit != null && limit < effectiveMaxTokens) {
    effectiveMaxTokens = limit;
    resolvedSource = `hard_limit_${limit}`;
  }

  const resolved = {
    provider: provider?.id || provider?.providerId || provider?.code || provider || '',
    model,
    purpose,
    requestedMaxTokens: requested,
    effectiveMaxTokens,
    source: resolvedSource
  };

  console.log('[PROVIDER_TOKEN_BUDGET_RESOLVED]', resolved);
  return resolved;
}
