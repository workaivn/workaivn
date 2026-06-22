import { AiProviderAdapter } from "./AiProviderAdapter.js";
import axios from "axios";

export class AnthropicProviderAdapter extends AiProviderAdapter {
  constructor() {
    super({
      code: "anthropic",
      name: "Anthropic Claude",
      type: "api"
    });
    this.apiKey = process.env.ANTHROPIC_API_KEY || null;
    this.baseUrl = "https://api.anthropic.com/v1";
  }

  async isConfigured() {
    return !!this.apiKey;
  }

  getConfigError() {
    if (!this.apiKey) {
      return "ANTHROPIC_API_KEY is not set in environment variables";
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
      const system = messages
        .filter(message => message.role === "system")
        .map(message => message.content)
        .join("\n\n");
      const conversation = messages
        .filter(message => message.role !== "system")
        .map(message => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: message.content
        }));

      const response = await axios.post(`${this.baseUrl}/messages`, {
        model: modelName || "claude-3-opus-20240229",
        max_tokens: maxTokens,
        temperature,
        system: system || undefined,
        messages: conversation
      }, {
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json"
        }
      });

      const outputText = response.data.content?.[0]?.text || "";

      return {
        success: true,
        outputText,
        rawResponse: response.data
      };
    } catch (error) {
      console.error("Anthropic error:", error.message);
      return {
        success: false,
        error: error.message || "Anthropic API error",
        errorDetails: error
      };
    }
  }
}
