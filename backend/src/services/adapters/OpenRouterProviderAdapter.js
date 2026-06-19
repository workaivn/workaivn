import { AiProviderAdapter } from "./AiProviderAdapter.js";
import axios from "axios";

export class OpenRouterProviderAdapter extends AiProviderAdapter {
  constructor() {
    super({
      code: "openrouter",
      name: "OpenRouter",
      type: "api"
    });
    this.apiKey = process.env.OPENROUTER_API_KEY || null;
    this.baseUrl = "https://openrouter.ai/api/v1";
  }

  async isConfigured() {
    return !!this.apiKey;
  }

  getConfigError() {
    if (!this.apiKey) {
      return "OPENROUTER_API_KEY is not set in environment variables";
    }
    return "";
  }

  async run(params) {
    try {
      if (!this.apiKey) {
        return {
          success: false,
          error: this.getConfigError()
        };
      }

      const { modelName, messages, temperature = 0.7, maxTokens = 2000 } = params;

      const response = await axios.post(`${this.baseUrl}/chat/completions`, {
        model: modelName || "gpt-3.5-turbo",
        messages,
        temperature,
        max_tokens: maxTokens
      }, {
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "HTTP-Referer": "https://workaivn.com",
          "X-Title": "WorkAIVN"
        }
      });

      const outputText = response.data.choices?.[0]?.message?.content || "";

      return {
        success: true,
        outputText,
        rawResponse: response.data
      };
    } catch (error) {
      console.error("OpenRouter error:", error.message);
      return {
        success: false,
        error: error.message || "OpenRouter API error",
        errorDetails: error
      };
    }
  }
}
