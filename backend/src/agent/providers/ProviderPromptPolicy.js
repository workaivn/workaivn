function compactWhitespace(text = '') {
  return String(text || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function addStrictJsonInstruction(messages = []) {
  const hasJsonInstruction = messages.some(message => /valid json|json only|return only json/i.test(String(message?.content || '')));
  if (hasJsonInstruction) return messages;
  return [
    { role: 'system', content: 'Return only valid JSON. No markdown. No extra text.' },
    ...messages
  ];
}

export function applyProviderPromptPolicy(request = {}, provider = {}) {
  const providerId = String(provider?.id || provider?.providerId || provider?.code || request.providerId || '').toLowerCase();
  const isLocal = Boolean(provider?.capabilities?.isLocal || provider?.isLocal || provider?.type === 'local' || ['llamacpp', 'koboldcpp', 'ollama'].includes(providerId));
  const purpose = String(request.purpose || 'code_generation').toLowerCase();
  const responseFormat = request.responseFormat || null;

  let prompt = String(request.prompt || '').trim();
  let messages = Array.isArray(request.messages) ? request.messages.map(message => ({
    role: String(message?.role || 'user'),
    content: compactWhitespace(message?.content || '')
  })) : [];

  const compacted = isLocal || purpose === 'write_coordinator' || purpose === 'delta_retry';
  if (compacted) {
    prompt = compactWhitespace(prompt);
    messages = messages.map(message => ({
      role: message.role,
      content: compactWhitespace(message.content)
    }));
  }

  if (responseFormat && String(responseFormat?.type || responseFormat).toLowerCase() === 'json') {
    messages = addStrictJsonInstruction(messages);
    if (!prompt) {
      prompt = 'Return only valid JSON. No markdown. No extra text.';
    }
  }

  const result = {
    ...request,
    prompt,
    messages,
    promptPolicy: {
      provider: providerId || request.providerId || null,
      isLocal,
      purpose,
      compacted,
      responseFormat: responseFormat ? (responseFormat.type || responseFormat) : null,
      promptLengthBefore: String(request.prompt || '').length,
      promptLengthAfter: prompt.length,
      messageCount: messages.length
    }
  };

  console.log('[PROVIDER_PROMPT_POLICY_APPLIED]', result.promptPolicy);
  return result;
}
