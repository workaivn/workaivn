/**
 * Base class for all AI Provider Adapters
 */
export class AiProviderAdapter {
  constructor(config = {}) {
    this.code = config.code || "unknown";
    this.name = config.name || "Unknown Provider";
    this.type = config.type || "api";
  }

  /**
   * Run a prompt and return the result
   * @param {Object} params
   * @param {string} params.modelName - Model identifier
   * @param {Array} params.messages - Message array [{role, content}, ...]
   * @param {number} params.temperature - Temperature (0-2)
   * @param {number} params.maxTokens - Max tokens
   * @returns {Promise<Object>} { success, outputText, rawResponse, error }
   */
  async run(params) {
    throw new Error("run() must be implemented by subclass");
  }

  /**
   * Check if adapter is properly configured
   * @returns {Promise<boolean>}
   */
  async isConfigured() {
    return true;
  }

  /**
   * Get error message if configuration is missing
   * @returns {string}
   */
  getConfigError() {
    return "";
  }
}
