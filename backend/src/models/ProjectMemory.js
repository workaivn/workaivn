import mongoose from "mongoose";

const ProjectMemorySchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true
    },
    category: {
      type: String,
      enum: [
        "project_context",
        "architecture",
        "api_docs",
        "database_schema",
        "coding_standards",
        "project_structure",
        "dependencies",
        "configuration",
        "issue_tracking",
        "other"
      ],
      default: "project_context"
    },
    content: {
      type: String,
      required: true
    },
    tags: [String],
    relatedFiles: [String],
    importance: {
      type: String,
      enum: ["critical", "important", "normal", "reference"],
      default: "normal"
    },
    linkedTasks: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "AgentTask"
      }
    ],
    linkedAgents: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "AiAgent"
      }
    ],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    isPublic: {
      type: Boolean,
      default: false
    },
    viewCount: {
      type: Number,
      default: 0
    },
    lastUsed: Date,
    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

// Indexes
ProjectMemorySchema.index({ title: 1, isActive: 1 });
ProjectMemorySchema.index({ category: 1, isActive: 1 });
ProjectMemorySchema.index({ tags: 1 });
ProjectMemorySchema.index({ importance: 1 });
ProjectMemorySchema.index({ createdBy: 1 });

// Pre-save hook to normalize tags
ProjectMemorySchema.pre("save", function (next) {
  if (this.tags) {
    this.tags = this.tags.map(tag => tag.toLowerCase().trim());
  }
  next();
});

const ProjectMemory = mongoose.model("ProjectMemory", ProjectMemorySchema);

export default ProjectMemory;
