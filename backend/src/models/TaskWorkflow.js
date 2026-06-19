import mongoose from "mongoose";

const WorkflowStepSchema = new mongoose.Schema(
  {
    order: {
      type: Number,
      required: true,
      default: 1
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AiAgent",
      required: true
    },
    instruction: {
      type: String,
      required: true
    },
    status: {
      type: String,
      enum: ["pending", "running", "completed", "failed"],
      default: "pending"
    },
    inputPrompt: String,
    outputText: String,
    errorMessage: String,
    startedAt: Date,
    completedAt: Date
  },
  { _id: true }
);

const TaskWorkflowSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    description: {
      type: String,
      default: ""
    },
    sourceTaskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AgentTask",
      required: true,
      index: true
    },
    steps: {
      type: [WorkflowStepSchema],
      default: []
    },
    status: {
      type: String,
      enum: ["draft", "running", "completed", "failed"],
      default: "draft",
      index: true
    },
    finalOutput: String,
    errorMessage: String,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    isActive: {
      type: Boolean,
      default: true
    },
    lastRunAt: Date
  },
  { timestamps: true }
);

TaskWorkflowSchema.index({ title: 1, isActive: 1 });
TaskWorkflowSchema.index({ sourceTaskId: 1, isActive: 1 });
TaskWorkflowSchema.index({ status: 1, isActive: 1 });

const TaskWorkflow = mongoose.model("TaskWorkflow", TaskWorkflowSchema);

export default TaskWorkflow;