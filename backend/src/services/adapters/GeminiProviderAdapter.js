import { AiProviderAdapter } from "./AiProviderAdapter.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

export class GeminiProviderAdapter extends AiProviderAdapter {
  constructor() {
    super({
      code: "gemini",
      name: "Google Gemini",
      type: "api"
    });
    this.client = null;
    this.initialize();
  }

  initialize() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.client = new GoogleGenerativeAI(apiKey);
    }
  }

  async isConfigured() {
    return !!this.client;
  }

  getConfigError() {
    if (!this.client) {
      return "GEMINI_API_KEY is not set in environment variables";
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

      const model = this.client.getGenerativeModel({
        model: modelName || "gemini-1.5-pro"
      });

      // Convert to Gemini format
      const content = messages.map(msg => ({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.content }]
      }));

      const response = await model.generateContent({
        contents: content,
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens
        }
      });

      const outputText = response.response.text();

      return {
        success: true,
        outputText,
        rawResponse: response
      };
    } catch (error) {
      console.error("Gemini error:", error.message);
      return {
        success: false,
        error: error.message || "Gemini API error",
        errorDetails: error
      };
    }
  }
}
