import { normalizeProviderError } from './ProviderError.js';

function isPresent(value) {
  return value !== undefined && value !== null;
}

function stripMarkdownJson(value = '') {
  const text = String(value || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  return text;
}

function tryParseJsonText(value = '') {
  const raw = stripMarkdownJson(value);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractTextFromObject(value) {
  if (!value || typeof value !== 'object') return '';
  if (typeof value.normalizedText === 'string') return value.normalizedText;
  if (typeof value.text === 'string') return value.text;
  if (typeof value.outputText === 'string') return value.outputText;
  if (typeof value.content === 'string') return value.content;
  if (typeof value.message?.content === 'string') return value.message.content;
  if (Array.isArray(value.choices) && value.choices.length > 0) {
    const choice = value.choices[0];
    if (typeof choice?.message?.content === 'string') return choice.message.content;
    if (typeof choice?.text === 'string') return choice.text;
  }
  if (typeof value.rawText === 'string') return value.rawText;
  if (typeof value.response === 'string') return value.response;
  return '';
}

export function normalizeProviderResponse(response = {}, request = {}) {
  const provider = request.providerId || request.provider || response.provider || null;
  const model = request.model || response.model || null;
  const latencyMs = Number.isFinite(Number(response.latencyMs)) ? Number(response.latencyMs) : null;
  const raw = isPresent(response?.raw) ? response.raw : response;
  const usage = response?.usage || response?.raw?.usage || null;
  const finishReason = response?.finishReason || response?.finish_reason || response?.raw?.finishReason || response?.raw?.finish_reason || null;

  if (response && typeof response === 'object' && response.success === false) {
    const error = normalizeProviderError(response.error || response, provider, model);
    const normalized = {
      success: false,
      text: '',
      raw,
      normalizedText: '',
      usage,
      finishReason,
      provider,
      model,
      latencyMs,
      error,
      metadata: response.metadata || {}
    };
    console.log('[PROVIDER_RESPONSE_NORMALIZED]', { provider, model, success: false, errorType: error.type });
    return normalized;
  }

  let text = '';
  if (typeof response === 'string') {
    const parsed = tryParseJsonText(response);
    if (parsed && typeof parsed === 'object') {
      text = extractTextFromObject(parsed) || String(parsed.content || parsed.text || '');
    } else {
      text = response;
    }
  } else if (response && typeof response === 'object') {
    text = extractTextFromObject(response);
    if (text) {
      const parsedText = tryParseJsonText(text);
      if (parsedText && typeof parsedText === 'object') {
        text = extractTextFromObject(parsedText) || String(parsedText.content || parsedText.text || text);
      }
    }
    if (!text) {
      const parsed = tryParseJsonText(response.text || response.content || response.outputText || response.rawText || '');
      if (parsed && typeof parsed === 'object') {
        text = extractTextFromObject(parsed) || String(parsed.content || parsed.text || '');
      }
    }
  }

  const normalizedText = String(text || '').trim();
  const success = normalizedText.length > 0;
  const error = success ? null : normalizeProviderError({
    message: 'Invalid provider response',
    raw: response
  }, provider, model);

  const normalized = {
    success,
    text: normalizedText,
    raw,
    normalizedText,
    usage,
    finishReason,
    provider,
    model,
    latencyMs,
    error,
    metadata: response?.metadata || {}
  };

  console.log('[PROVIDER_RESPONSE_NORMALIZED]', {
    provider,
    model,
    success,
    textLength: normalizedText.length,
    finishReason
  });

  return normalized;
}
