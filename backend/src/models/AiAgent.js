import mongoose from "mongoose";

const AiAgentSchema = new mongoose.Schema(
  {
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AiProvider",
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      index: true
    },
    code: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    description: {
      type: String
    },
    modelName: {
      type: String,
      required: true
    },
    agentType: {
      type: String,
      enum: ["coding", "documentation", "testing", "refactoring", "manual"],
      required: true,
      index: true
    },
    capabilityTags: {
      type: [String],
      index: true
    },
    systemPrompt: {
      type: String,
      required: true
    },
    temperature: {
      type: Number,
      default: 0.7,
      min: 0,
      max: 2
    },
    maxTokens: {
      type: Number,
      default: 2000
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    priority: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.model("AiAgent", AiAgentSchema);
