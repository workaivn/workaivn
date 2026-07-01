function lower(value) {
  return String(value || '').toLowerCase();
}

export function normalizeProviderError(error = {}, provider = null, model = null) {
  const raw = error?.raw || error?.errorDetails || error?.response || error || null;
  const message = String(error?.message || error?.error || raw?.message || raw?.error || raw || 'Unknown provider error');
  const text = lower(message);
  const status = Number(error?.status || error?.response?.status || raw?.status || 0) || null;

  let type = 'UNKNOWN';
  if (status === 408 || /timeout|timed out|etimedout/i.test(text)) type = 'TIMEOUT';
  else if (status === 429 || /rate.?limit|too many requests|quota/i.test(text)) type = 'RATE_LIMIT';
  else if (status === 401 || status === 403 || /unauthoriz|forbidden|invalid api key|api key/i.test(text)) type = 'AUTH';
  else if (/quota|insufficient credits|no credit/i.test(text)) type = 'QUOTA';
  else if (/context length|maximum context|too long|token limit|prompt too large/i.test(text)) type = 'CONTEXT_LENGTH';
  else if (status === 400 || /bad request|invalid request|malformed/i.test(text)) type = 'BAD_REQUEST';
  else if (/network|fetch failed|econnrefused|econnreset|enotfound|socket hang up|unavailable/i.test(text)) type = 'NETWORK';
  else if (status >= 500 || /server error|internal server error|overload|busy/i.test(text)) type = 'SERVER_ERROR';
  else if (/invalid.*response|unsupported response|missing choices|empty content|malformed json|json parse/i.test(text)) type = 'INVALID_RESPONSE';
  else if (/json parse failed|unexpected token .* in json/i.test(text)) type = 'JSON_PARSE_FAILED';

  const retryable = ['TIMEOUT', 'RATE_LIMIT', 'NETWORK', 'SERVER_ERROR', 'CONTEXT_LENGTH', 'INVALID_RESPONSE', 'JSON_PARSE_FAILED'].includes(type);

  return {
    type,
    message,
    provider: provider || error?.provider || null,
    model: model || error?.model || null,
    retryable,
    raw
  };
}
