import { AiProviderAdapter } from "./AiProviderAdapter.js";
import OpenAI from "openai";

export class OpenAIProviderAdapter extends AiProviderAdapter {
  constructor() {
    super({
      code: "openai",
      name: "OpenAI",
      type: "api"
    });
    this.client = null;
    this.initialize();
  }

  initialize() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      this.client = new OpenAI({ apiKey });
    }
  }

  async isConfigured() {
    return !!this.client;
  }

  getConfigError() {
    if (!this.client) {
      return "OPENAI_API_KEY is not set in environment variables";
    }
    return "";
  }

  async run(params) {
    try {
      if (!this.client) {
        return {
          success: false,
          error: this.getConfigError()
        };
      }

      const { modelName, messages, temperature = 0.7, maxTokens = 2000 } = params;

      const response = await this.client.chat.completions.create({
        model: modelName || process.env.OPENAI_DEFAULT_MODEL || "gpt-4o-mini",
        messages,
        temperature,
        max_tokens: maxTokens
      });

      const outputText = response.choices?.[0]?.message?.content || "";

      return {
        success: true,
        outputText,
        rawResponse: response
      };
    } catch (error) {
      console.error("OpenAI error:", error.message);
      return {
        success: false,
        error: error.message || "OpenAI API error",
        errorDetails: error
      };
    }
  }
}
