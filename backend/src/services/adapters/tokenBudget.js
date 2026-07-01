const DEFAULT_REQUESTED_MAX_TOKENS = 4096;

function toPositiveNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

export function resolveTokenBudget({
  provider = '',
  model = '',
  requestedMaxTokens,
  maxTokensCapOverride = null,
  hardLimit = null,
  source = 'requested',
  defaultRequestedMaxTokens = DEFAULT_REQUESTED_MAX_TOKENS
} = {}) {
  const normalizedRequested = toPositiveNumber(requestedMaxTokens) ?? defaultRequestedMaxTokens;
  let effectiveMaxTokens = normalizedRequested;
  let resolvedSource = source || 'requested';

  const override = toPositiveNumber(maxTokensCapOverride);
  if (override != null && override < effectiveMaxTokens) {
    effectiveMaxTokens = override;
    resolvedSource = 'maxTokensCapOverride';
  }

  const documentedHardLimit = toPositiveNumber(hardLimit);
  if (documentedHardLimit != null && effectiveMaxTokens > documentedHardLimit) {
    effectiveMaxTokens = documentedHardLimit;
    resolvedSource = `hard_limit_${documentedHardLimit}`;
  }

  return {
    provider,
    model,
    requestedMaxTokens: normalizedRequested,
    effectiveMaxTokens,
    source: resolvedSource
  };
}

