import mongoose from "mongoose";

const AgentRunSchema = new mongoose.Schema(
  {
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AgentTask",
      required: true,
      index: true
    },
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AiAgent",
      required: true,
      index: true
    },
    providerCode: {
      type: String,
      required: true
    },
    modelName: {
      type: String,
      required: true
    },
    inputPrompt: {
      type: String,
      required: true
    },
    outputText: {
      type: String
    },
    rawResponse: {
      type: mongoose.Schema.Types.Mixed
    },
    status: {
      type: String,
      enum: ["pending", "running", "completed", "error"],
      default: "pending",
      index: true
    },
    errorMessage: {
      type: String
    },
    startedAt: {
      type: Date
    },
    completedAt: {
      type: Date
    }
  },
  {
    timestamps: true
  }
);

// Auto-update completedAt when status changes to completed
AgentRunSchema.pre("save", function (next) {
  if (this.isModified("status") && this.status === "completed" && !this.completedAt) {
    this.completedAt = new Date();
  }
  next();
});

export default mongoose.model("AgentRun", AgentRunSchema);
