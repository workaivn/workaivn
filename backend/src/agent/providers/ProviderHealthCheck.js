export async function checkProviderHealth(provider = {}, adapter = null) {
  const providerId = provider?.id || provider?.providerId || provider?.code || 'unknown';
  try {
    if (provider?.enabled === false) {
      const result = { healthy: false, provider: providerId, model: provider?.model || null, reason: 'disabled' };
      console.log('[PROVIDER_HEALTH_FAIL]', result);
      return result;
    }
    if (provider?.capabilities?.requiresApiKey && !provider?.apiKeyAvailable) {
      const result = { healthy: false, provider: providerId, model: provider?.model || null, reason: 'missing_api_key' };
      console.log('[PROVIDER_HEALTH_FAIL]', result);
      return result;
    }
    if (provider?.type === 'local' && !provider?.baseUrl && !provider?.adapter && !adapter) {
      const result = { healthy: false, provider: providerId, model: provider?.model || null, reason: 'missing_base_url' };
      console.log('[PROVIDER_HEALTH_FAIL]', result);
      return result;
    }

    if (adapter && typeof adapter.isConfigured === 'function') {
      const configured = await adapter.isConfigured();
      if (!configured) {
        const result = { healthy: false, provider: providerId, model: provider?.model || null, reason: adapter.getConfigError?.() || 'not_configured' };
        console.log('[PROVIDER_HEALTH_FAIL]', result);
        return result;
      }
    }

    const result = { healthy: true, provider: providerId, model: provider?.model || null, reason: null };
    console.log('[PROVIDER_HEALTH_OK]', result);
    return result;
  } catch (error) {
    const result = { healthy: false, provider: providerId, model: provider?.model || null, reason: error?.message || 'health_check_failed' };
    console.log('[PROVIDER_HEALTH_FAIL]', result);
    return result;
  }
}
