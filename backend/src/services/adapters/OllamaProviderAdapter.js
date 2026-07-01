import { AiProviderAdapter } from "./AiProviderAdapter.js";
import OpenAI from "openai";
import { resolveTokenBudget } from "./tokenBudget.js";

const DEBUG = () => process.env.DEBUG_AGENT === "true";

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
      if (DEBUG()) {
        console.log("[OllamaAdapter] initialized baseURL=%s", this.baseUrl);
      }
    } catch (initError) {
      if (DEBUG()) {
        console.log("[OllamaAdapter] initialize failed:", initError.message);
      }
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
    const model = params?.modelName || process.env.OLLAMA_MODEL || "qwen2.5-coder:7b";
    const endpoint = `${this.baseUrl}/chat/completions`;

    if (DEBUG()) {
      console.log("[OllamaAdapter] run model=%s endpoint=%s temperature=%s maxTokens=%s messages=%d",
        model, endpoint, params?.temperature ?? 0.7, params?.maxTokens ?? 4096, params?.messages?.length ?? 0);
    }

    try {
      if (!this.client) {
        if (DEBUG()) console.log("[OllamaAdapter] client not configured");
        return { success: false, error: this.getConfigError() };
      }

      const { modelName, messages, temperature = 0.7, maxTokens = 4096 } = params;
      const tokenBudget = resolveTokenBudget({
        provider: "ollama",
        model: modelName,
        requestedMaxTokens: maxTokens,
        source: 'requested'
      });
      console.log("[PROVIDER_TOKEN_BUDGET_RESOLVED]", tokenBudget);

      for (const msg of messages) {
        if (Array.isArray(msg.content)) {
          const hasImage = msg.content.some(block => block.type === "image_url" || block.type === "image");
          if (hasImage) {
            if (DEBUG()) console.log("[OllamaAdapter] rejected: image content detected");
            return {
              success: false,
              error: "This Ollama model does not support image input. Use a vision-capable model (llava, bakllava) or switch to a cloud provider."
            };
          }
        }
      }

      if (DEBUG()) console.log("[OllamaAdapter] sending request to %s ...", endpoint);

const response = await this.client.chat.completions.create({
         model,
         messages,
         temperature,
         max_tokens: tokenBudget.effectiveMaxTokens
       });

      const outputText = response.choices?.[0]?.message?.content || "";
      const finishReason = response.choices?.[0]?.finish_reason || response.choices?.[0]?.finishReason || null;
      console.log("[PROVIDER_GENERATION_LIMITS]", {
        provider: this.code,
        model,
        requestedMaxTokens: tokenBudget.requestedMaxTokens,
        effectiveMaxTokens: tokenBudget.effectiveMaxTokens,
        nPredict: params?.nPredict ?? null,
        maxTokens: tokenBudget.effectiveMaxTokens,
        maxNewTokens: params?.maxNewTokens ?? null,
        stop: params?.stop ?? null,
        outputLength: outputText.length,
        finishReason
      });

      if (DEBUG()) {
        console.log("[OllamaAdapter] response OK choices=%d outputLength=%d",
          response.choices?.length ?? 0, outputText.length);
      }

      return { success: true, outputText, rawResponse: response };
    } catch (error) {
      const status = error.status || error.code || "unknown";
      const bodyPreview = error.message ? error.message.slice(0, 500) : "(no body)";
      console.error("[OllamaAdapter] FAIL status=%s body=%s", status, bodyPreview);

      if (error.status === 404 && error.message?.includes("model")) {
        if (DEBUG()) console.log("[OllamaAdapter] model not found: %s", model);
        return {
          success: false,
          error: `Model "${model}" not found. Run: ollama pull ${model}`
        };
      }

      if (error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT" || error.message?.includes("connect")) {
        if (DEBUG()) console.log("[OllamaAdapter] connection error code=%s", error.code);
        return {
          success: false,
          error: `Ollama is not running at ${this.baseUrl}. Start it with: ollama serve`
        };
      }

      if (error.message?.includes("does not support image") || error.message?.includes("Cannot read")) {
        if (DEBUG()) console.log("[OllamaAdapter] image input rejected by model");
        return {
          success: false,
          error: "This model does not support image input. Use a vision-capable model (llava) or send text only."
        };
      }

      if (status === 500 || status === 502 || status === 503) {
        if (DEBUG()) console.log("[OllamaAdapter] server error status=%s", status);
        return {
          success: false,
          error: `Ollama server error (${status}). The model may be loading or out of memory.`
        };
      }

      return { success: false, error: error.message || "Ollama API error" };
    }
  }
}
