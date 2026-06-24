import { AiProviderAdapter } from "./AiProviderAdapter.js";
import axios from "axios";

const PROVIDER_CONFIGS = {
  koboldcpp: {
    name: "KoboldCPP",
    baseUrl: process.env.KOBOLDCPP_BASE_URL || "http://127.0.0.1:5001/v1",
    apiKeyEnv: null
  },
  llamacpp: {
    name: "llama.cpp",
    baseUrl: process.env.LLAMACPP_BASE_URL || "http://127.0.0.1:8080/v1",
    apiKeyEnv: null
  },
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
    this.apiKey = config.apiKeyEnv ? (process.env[config.apiKeyEnv] || null) : null;
    this.baseUrl = config.baseUrl;
  }

  async isConfigured() {
    if (this.code === "openai_compatible" && !this.baseUrl) {
      return false;
    }
    // Local providers (koboldcpp/llamacpp) do not require API keys
    if (this.code === "koboldcpp" || this.code === "llamacpp") {
      return !!this.baseUrl;
    }
    // Providers with explicit apiKeyEnv must have a key
    if (this.providerConfig.apiKeyEnv) {
      return !!this.apiKey;
    }
    // Fallback: require baseUrl only
    return !!this.baseUrl;
  }

  getConfigError() {
    if (this.code === "openai_compatible" && !this.baseUrl) {
      return "CUSTOM_OPENAI_BASE_URL is not set in environment variables";
    }
    if ((this.code !== "koboldcpp" && this.code !== "llamacpp") && !this.apiKey) {
      return `${this.providerConfig.apiKeyEnv} is not set in environment variables`;
    }
    return "";
  }

  async run(params) {
    try {
      // Only require API key for providers that specify an apiKeyEnv
      if (this.providerConfig.apiKeyEnv && !this.apiKey) {
        const reason = this.getConfigError();
        console.error("[ADAPTER_FAIL_SOURCE]", { reason });
        console.error("[LOCAL_PROVIDER_FAILURE]", { reason, responseData: undefined, content: undefined });
        return { success: false, error: reason };
      }
      if (this.code === "openai_compatible" && !this.baseUrl) {
        const reason = "CUSTOM_OPENAI_BASE_URL is not set";
        console.error("[ADAPTER_FAIL_SOURCE]", { reason });
        console.error("[LOCAL_PROVIDER_FAILURE]", { reason, responseData: undefined, content: undefined });
        return { success: false, error: reason };
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
          // Build payload; local providers (koboldcpp/llamacpp) often reject unsupported fields like max_tokens
          const isLocal = (this.code === "koboldcpp" || this.code === "llamacpp");
          const payload = isLocal
            ? { model, messages, temperature }
            : { model, messages, temperature, max_tokens: maxTokens };

          const modelTimeout = Number(params?.modelCallTimeout || process.env.WORKAI_MODEL_CALL_TIMEOUT_MS || 90000);
          const response = await axios.post(`${this.baseUrl}/chat/completions`, payload, {
            headers: Object.assign(
              { "Content-Type": "application/json" },
              this.apiKey ? { "Authorization": `Bearer ${this.apiKey}` } : {}
            ),
            timeout: modelTimeout,
            validateStatus: () => true
          });

          // Accept 2xx
          if (response.status >= 200 && response.status < 300) {
            // Normalize assistant text content for OpenAI-compatible servers
            const data = response.data || {};
            const choice = Array.isArray(data.choices) ? data.choices[0] : undefined;
            const msg = choice?.message;
            const contentRaw = msg?.content;
            const content = (typeof contentRaw === "string") ? contentRaw : String(contentRaw ?? "");

            if (content && content.trim()) {
              // Return exact normalized contract
              return {
                success: true,
                output: content,
                content: content,
                text: content,
                raw: data
              };
            }

            // Explain why this is considered a failure
            let reason = "";
            if (!choice) reason = "missing choices";
            else if (!msg) reason = "missing message";
            else reason = "empty content";
            console.error("[ADAPTER_FAIL_SOURCE]", { reason, data, status: response.status });
            console.error("[LOCAL_PROVIDER_FAILURE]", {
              reason,
              responseData: data,
              content: undefined,
              choices: data?.choices,
              message: data?.choices?.[0]?.message
            });
            return { success: false, error: reason || `HTTP ${response.status}`, errorDetails: { response } };
          }

          const status = response.status;
          const bodyMsg = response.data?.error?.message || response.data?.message || "";
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
          console.error("[ADAPTER_FAIL_SOURCE]", { reason: bodyMsg || `HTTP ${status}`, data: response.data, status });
          console.error("[LOCAL_PROVIDER_FAILURE]", {
            reason: bodyMsg || `HTTP ${status}`,
            responseData: response.data,
            content: undefined,
            choices: response.data?.choices,
            message: response.data?.choices?.[0]?.message
          });
          return { success: false, error: bodyMsg || `HTTP ${status}`, errorDetails: { response } };
        } catch (error) {
          const msg = (error?.response?.data)
            ? (typeof error.response.data === "string" ? error.response.data : JSON.stringify(error.response.data))
            : (error?.response?.status || error.message || `${this.providerConfig.name} API error`);
          const lower = String(msg).toLowerCase();
          const transient = /timeout|timed out|etimedout|econn|reset|refused|unavailable|busy|overload/i.test(lower);
          if (this.code === "groq") {
            console.log(`[GroqAdapter] model=%s exception: %s`, model, msg);
          }
          if (transient && i < candidates.length - 1) {
            lastError = msg;
            continue;
          }
          console.error("[ADAPTER_FAIL_SOURCE]", { reason: msg });
          console.error("[LOCAL_PROVIDER_FAILURE]", { reason: msg, responseData: error?.response?.data, content: undefined });
          return { success: false, error: msg, errorDetails: error };
        }
      }
      console.error("[ADAPTER_FAIL_SOURCE]", { reason: lastError || "unsupported response format" });
      console.error("[LOCAL_PROVIDER_FAILURE]", { reason: lastError || "unsupported response format", responseData: undefined, content: undefined });
      return { success: false, error: lastError || `${this.providerConfig.name} API error` };
    } catch (error) {
      const details = error?.response?.data || error?.response?.status || error?.message || error;
      console.error("[ADAPTER_FAIL_SOURCE]", { reason: details });
      console.error("[LOCAL_PROVIDER_FAILURE]", { reason: details, responseData: error?.response?.data, content: undefined });
      return { success: false, error: error.message || `${this.providerConfig.name} API error`, errorDetails: error };
    }
  }
}
