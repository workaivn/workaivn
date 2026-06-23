import { AiProviderAdapter } from "./AiProviderAdapter.js";
import axios from "axios";

const PROVIDER_CONFIGS = {
  groq: {
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY"
  },
  deepseek: {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    apiKeyEnv: "DEEPSEEK_API_KEY"
  },
  together: {
    name: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    apiKeyEnv: "TOGETHER_API_KEY"
  },
  fireworks: {
    name: "Fireworks AI",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    apiKeyEnv: "FIREWORKS_API_KEY"
  },
  mistral: {
    name: "Mistral AI",
    baseUrl: "https://api.mistral.ai/v1",
    apiKeyEnv: "MISTRAL_API_KEY"
  },
  cerebras: {
    name: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    apiKeyEnv: "CEREBRAS_API_KEY"
  },
  perplexity: {
    name: "Perplexity",
    baseUrl: "https://api.perplexity.ai",
    apiKeyEnv: "PERPLEXITY_API_KEY"
  },
  xai: {
    name: "xAI",
    baseUrl: "https://api.x.ai/v1",
    apiKeyEnv: "XAI_API_KEY"
  },
  openai_compatible: {
    name: "OpenAI Compatible",
    baseUrl: process.env.CUSTOM_OPENAI_BASE_URL || "",
    apiKeyEnv: "CUSTOM_OPENAI_API_KEY"
  }
};

export class OpenAICompatibleProviderAdapter extends AiProviderAdapter {
  constructor(code) {
    const config = PROVIDER_CONFIGS[code];
    if (!config) {
      throw new Error(`Unknown OpenAI-compatible provider code: ${code}`);
    }
    super({
      code,
      name: config.name,
      type: "api"
    });
    this.providerConfig = config;
    this.apiKey = process.env[config.apiKeyEnv] || null;
    this.baseUrl = config.baseUrl;
  }

  async isConfigured() {
    if (this.code === "openai_compatible" && !this.baseUrl) {
      return false;
    }
    return !!this.apiKey;
  }

  getConfigError() {
    if (this.code === "openai_compatible" && !this.baseUrl) {
      return "CUSTOM_OPENAI_BASE_URL is not set in environment variables";
    }
    if (!this.apiKey) {
      return `${this.providerConfig.apiKeyEnv} is not set in environment variables`;
    }
    return "";
  }

  async run(params) {
    try {
      if (!this.apiKey) {
        return { success: false, error: this.getConfigError() };
      }
      if (this.code === "openai_compatible" && !this.baseUrl) {
        return { success: false, error: "CUSTOM_OPENAI_BASE_URL is not set" };
      }

      const { modelName, messages, temperature = 0.7, maxTokens = 2000 } = params;

      // Provider-specific model fallback (Groq)
      let candidates = [modelName].filter(Boolean);
      if (this.code === "groq") {
        const groqFallback = [
          "llama-3.3-70b-versatile",
          "llama-3.1-8b-instant",
		  "meta-llama/llama-prompt-guard-2-86m",
		  "openai/gpt-oss-safeguard-20b",
		  "qwen/qwen3-32b"
        ];
        for (const m of groqFallback) {
          if (!candidates.includes(m)) candidates.push(m);
        }
      }

      let lastError = null;
      for (let i = 0; i < candidates.length; i += 1) {
        const model = candidates[i];
        try {
          if (this.code === "groq") {
            console.log(`[GroqAdapter] trying model=%s (%d/%d)`, model, i + 1, candidates.length);
          }
          const response = await axios.post(`${this.baseUrl}/chat/completions`, {
            model,
            messages,
            temperature,
            max_tokens: maxTokens
          }, {
            headers: {
              "Authorization": `Bearer ${this.apiKey}`,
              "Content-Type": "application/json"
            },
            timeout: 30000,
            validateStatus: () => true
          });

          // Accept 2xx
          if (response.status >= 200 && response.status < 300) {
            const outputText = response.data.choices?.[0]?.message?.content || "";
            if (this.code === "groq") {
              console.log(`[GroqAdapter] using model=%s OK`, model);
            }
            return { success: true, outputText, rawResponse: response.data };
          }

          const status = response.status;
          const bodyMsg = response.data?.error?.message || "";
          const lowerMsg = String(bodyMsg).toLowerCase();
          const isRateLimit = status === 429 || /rate.?limit|tpm|rpm|quota|too many/i.test(lowerMsg);
          const isOverload = status >= 500 || /overload|overloaded|busy|temporar/i.test(lowerMsg);
          const modelUnknown = status === 404 || /model.*not.*found/i.test(lowerMsg);

          if (this.code === "groq") {
            console.log(`[GroqAdapter] model=%s failed status=%s msg=%s`, model, status, bodyMsg || "(no message)");
          }

          if (isRateLimit || isOverload || modelUnknown) {
            // Try next candidate
            if (this.code === "groq") {
              console.log(`[GroqAdapter] fallback to next model (rate limit/overload/not-found)`);
            }
            lastError = bodyMsg || `HTTP ${status}`;
            continue;
          }

          // Non-retryable
          return { success: false, error: bodyMsg || `HTTP ${status}` };
        } catch (error) {
          const msg = error.message || `${this.providerConfig.name} API error`;
          const lower = String(msg).toLowerCase();
          const transient = /timeout|timed out|etimedout|econn|reset|refused|unavailable|busy|overload/i.test(lower);
          if (this.code === "groq") {
            console.log(`[GroqAdapter] model=%s exception: %s`, model, msg);
          }
          if (transient && i < candidates.length - 1) {
            lastError = msg;
            continue;
          }
          return { success: false, error: msg, errorDetails: error };
        }
      }
      return { success: false, error: lastError || `${this.providerConfig.name} API error` };
    } catch (error) {
      console.error(`${this.providerConfig.name} error:`, error.message);
      return { success: false, error: error.message || `${this.providerConfig.name} API error`, errorDetails: error };
    }
  }
}
