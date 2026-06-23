import mongoose from "mongoose";

const AiProviderSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    code: {
      type: String,
      required: true,
      unique: true,
      enum: [
        "openai", "gemini", "anthropic", "openrouter", "manual_external", "ollama",
        "groq", "deepseek", "together", "fireworks", "mistral", "cerebras",
        "perplexity", "xai", "openai_compatible"
      ],
      index: true
    },
    type: {
      type: String,
      required: true,
      enum: ["api", "manual"]
    },
    baseUrl: {
      type: String
    },
    apiKeyEnv: {
      type: String,
      description: "Environment variable name storing the API key"
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.model("AiProvider", AiProviderSchema);
