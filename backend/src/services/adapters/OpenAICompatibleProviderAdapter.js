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
        return {
          success: false,
          error: this.getConfigError()
        };
      }
      if (this.code === "openai_compatible" && !this.baseUrl) {
        return {
          success: false,
          error: "CUSTOM_OPENAI_BASE_URL is not set"
        };
      }

      const { modelName, messages, temperature = 0.7, maxTokens = 2000 } = params;

      const response = await axios.post(`${this.baseUrl}/chat/completions`, {
        model: modelName,
        messages,
        temperature,
        max_tokens: maxTokens
      }, {
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        timeout: 30000
      });

      const outputText = response.data.choices?.[0]?.message?.content || "";

      return {
        success: true,
        outputText,
        rawResponse: response.data
      };
    } catch (error) {
      console.error(`${this.providerConfig.name} error:`, error.message);
      return {
        success: false,
        error: error.message || `${this.providerConfig.name} API error`,
        errorDetails: error
      };
    }
  }
}
