const DEFAULT_STRING_LIMIT = 12000;
const DEFAULT_ARRAY_LIMIT = 200;
const DEFAULT_DEPTH_LIMIT = 8;

function logTruncation(field, originalLength, cappedLength) {
  console.log('[RUN_PAYLOAD_TRUNCATED]', {
    field,
    originalLength,
    cappedLength
  });
}

function truncateString(value, field, stringLimit) {
  const text = String(value ?? '');
  if (text.length <= stringLimit) return text;
  logTruncation(field, text.length, stringLimit);
  return `${text.slice(0, stringLimit)}...`;
}

export function sanitizeRunPayload(value, {
  field = 'payload',
  stringLimit = DEFAULT_STRING_LIMIT,
  arrayLimit = DEFAULT_ARRAY_LIMIT,
  depthLimit = DEFAULT_DEPTH_LIMIT
} = {}) {
  const seen = new WeakSet();

  function walk(input, currentField, depth) {
    if (input == null) return input;
    if (typeof input === 'string') return truncateString(input, currentField, stringLimit);
    if (typeof input === 'number' || typeof input === 'boolean') return input;
    if (typeof input === 'bigint') return String(input);
    if (typeof input === 'function' || typeof input === 'symbol') return undefined;

    if (depth >= depthLimit) {
      const length = Array.isArray(input)
        ? input.length
        : (typeof input === 'object' ? Object.keys(input).length : 0);
      logTruncation(currentField, length, depthLimit);
      return Array.isArray(input) ? [] : '[TRUNCATED]';
    }

    if (typeof input !== 'object') return input;
    if (seen.has(input)) return '[Circular]';
    seen.add(input);

    if (Array.isArray(input)) {
      if (input.length > arrayLimit) {
        logTruncation(currentField, input.length, arrayLimit);
      }
      return input.slice(0, arrayLimit).map((item, index) => walk(item, `${currentField}[${index}]`, depth + 1));
    }

    const output = {};
    for (const [key, valueEntry] of Object.entries(input)) {
      const nextField = currentField ? `${currentField}.${key}` : key;
      const sanitized = walk(valueEntry, nextField, depth + 1);
      if (sanitized !== undefined) {
        output[key] = sanitized;
      }
    }
    return output;
  }

  return walk(value, field, 0);
}

export function truncateRunText(value, field, stringLimit = DEFAULT_STRING_LIMIT) {
  return truncateString(value, field, stringLimit);
}
