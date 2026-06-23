import { AiProviderAdapter } from "./AiProviderAdapter.js";
import OpenAI from "openai";

export class OllamaProviderAdapter extends AiProviderAdapter {
  constructor() {
    super({
      code: "ollama",
      name: "Ollama Local",
      type: "api"
    });
    this.client = null;
    this.initialize();
  }

  initialize() {
    const baseURL = process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";
    const apiKey = process.env.OLLAMA_API_KEY || "ollama";
    try {
      this.client = new OpenAI({ apiKey, baseURL });
      this.baseUrl = baseURL;
    } catch {
      this.client = null;
    }
  }

  async isConfigured() {
    return this.client !== null;
  }

  getConfigError() {
    if (!this.client) {
      return "Failed to initialize Ollama client. Check OLLAMA_BASE_URL.";
    }
    return "";
  }

  async run(params) {
    try {
      if (!this.client) {
        return { success: false, error: this.getConfigError() };
      }

      const { modelName, messages, temperature = 0.7, maxTokens = 4096 } = params;

      for (const msg of messages) {
        if (Array.isArray(msg.content)) {
          const hasImage = msg.content.some(block => block.type === "image_url" || block.type === "image");
          if (hasImage) {
            return {
              success: false,
              error: "This Ollama model does not support image input. Use a vision-capable model (llava, bakllava) or switch to a cloud provider."
            };
          }
        }
      }
      const model = modelName || process.env.OLLAMA_MODEL || "qwen2.5-coder:7b";

      const response = await this.client.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens: maxTokens
      });

      const outputText = response.choices?.[0]?.message?.content || "";

      return { success: true, outputText, rawResponse: response };
    } catch (error) {
      console.error("Ollama error:", error.message);

      if (error.status === 404 && error.message?.includes("model")) {
        const model = params?.modelName || process.env.OLLAMA_MODEL || "qwen2.5-coder:7b";
        return {
          success: false,
          error: `Model "${model}" not found. Run: ollama pull ${model}`
        };
      }

      if (error.code === "ECONNREFUSED" || error.message?.includes("connect")) {
        return {
          success: false,
          error: `Ollama is not running at ${this.baseUrl}. Start it with: ollama serve`
        };
      }

      return { success: false, error: error.message || "Ollama API error" };
    }
  }
}
