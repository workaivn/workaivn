import mongoose from "mongoose";

const AgentTaskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      index: true
    },
    inputPrompt: {
      type: String,
      required: true
    },
    normalizedPrompt: {
      type: String
    },
    taskType: {
      type: String,
      enum: ["build_feature", "fix_bug", "refactor", "review", "documentation", "phase_plan", "analysis", "search", "chat"],
      required: true,
      index: true
    },
    status: {
      type: String,
      enum: ["draft", "submitted", "running", "completed", "needs_revision", "error"],
      default: "draft",
      index: true
    },
    selectedAgentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AiAgent"
    },
    workspaceId: {
      type: String,
      index: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.model("AgentTask", AgentTaskSchema);
