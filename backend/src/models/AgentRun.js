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
    workspaceRoot: {
      type: String
    },
    workspaceId: {
      type: String,
      index: true
    },
    currentStep: {
      type: Number,
      default: 0
    },
    currentTool: {
      type: String,
      default: ""
    },
    changedFiles: {
      type: [String],
      default: []
    },
    validatedFiles: {
      type: [String],
      default: []
    },
    toolCalls: {
      type: [mongoose.Schema.Types.Mixed],
      default: []
    },
    executionEvents: {
      type: [mongoose.Schema.Types.Mixed],
      default: []
    },
    diffSummary: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    executionSummary: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    plannerMetrics: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    qualityGate: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    acceptanceCriteria: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    autoFailover: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    status: {
      type: String,
      enum: ["pending", "running", "completed", "needs_revision", "error", "cancelled"],
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

// Auto-update completedAt when a run reaches a terminal status.
AgentRunSchema.pre("save", function (next) {
  if (
    this.isModified("status") &&
    ["completed", "needs_revision", "error"].includes(this.status) &&
    !this.completedAt
  ) {
    this.completedAt = new Date();
  }
  next();
});

export default mongoose.model("AgentRun", AgentRunSchema);
