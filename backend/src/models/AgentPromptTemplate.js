import mongoose from "mongoose";

const AgentPromptTemplateSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      index: true
    },
    description: {
      type: String
    },
    taskType: {
      type: String,
      enum: ["build_feature", "fix_bug", "refactor", "review", "documentation", "phase_plan"],
      required: true,
      index: true
    },
    content: {
      type: String,
      required: true,
      description: "Template content with {{variable}} placeholders"
    },
    variables: {
      type: [String],
      description: "List of variable names used in template"
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

export default mongoose.model("AgentPromptTemplate", AgentPromptTemplateSchema);
