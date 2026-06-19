/**
 * Registry for all AI Provider Adapters
 * Provides a centralized way to get adapters by code
 */

import { OpenAIProviderAdapter } from "./OpenAIProviderAdapter.js";
import { GeminiProviderAdapter } from "./GeminiProviderAdapter.js";
import { AnthropicProviderAdapter } from "./AnthropicProviderAdapter.js";
import { OpenRouterProviderAdapter } from "./OpenRouterProviderAdapter.js";
import { ManualExternalProviderAdapter } from "./ManualExternalProviderAdapter.js";

class ProviderRegistry {
  constructor() {
    this.adapters = new Map();
    this.initialize();
  }

  initialize() {
    // Register all adapters
    const openai = new OpenAIProviderAdapter();
    const gemini = new GeminiProviderAdapter();
    const anthropic = new AnthropicProviderAdapter();
    const openrouter = new OpenRouterProviderAdapter();
    const manual = new ManualExternalProviderAdapter();

    this.adapters.set("openai", openai);
    this.adapters.set("gemini", gemini);
    this.adapters.set("anthropic", anthropic);
    this.adapters.set("openrouter", openrouter);
    this.adapters.set("manual_external", manual);
  }

  /**
   * Get adapter by provider code
   * @param {string} code - Provider code (e.g., "openai", "gemini")
   * @returns {AiProviderAdapter}
   */
  getAdapter(code) {
    const adapter = this.adapters.get(code);
    if (!adapter) {
      throw new Error(`Unknown provider code: ${code}`);
    }
    return adapter;
  }

  /**
   * Get all registered adapter codes
   * @returns {Array<string>}
   */
  getCodes() {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get all adapters
   * @returns {Map<string, AiProviderAdapter>}
   */
  getAll() {
    return this.adapters;
  }

  /**
   * Check if provider is configured
   * @param {string} code - Provider code
   * @returns {Promise<boolean>}
   */
  async isConfigured(code) {
    try {
      const adapter = this.getAdapter(code);
      return await adapter.isConfigured();
    } catch {
      return false;
    }
  }

  /**
   * Get configuration error for provider
   * @param {string} code - Provider code
   * @returns {string}
   */
  getConfigError(code) {
    try {
      const adapter = this.getAdapter(code);
      return adapter.getConfigError();
    } catch (e) {
      return e.message;
    }
  }
}

export const providerRegistry = new ProviderRegistry();
