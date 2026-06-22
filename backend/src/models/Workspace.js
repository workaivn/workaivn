import crypto from "crypto";
import mongoose from "mongoose";

const WorkspaceSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: () => crypto.randomUUID(),
      unique: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    rootPath: {
      type: String,
      required: true,
      unique: true
    },
    sourceType: {
      type: String,
      enum: ["local", "zip", "git"],
      default: "local"
    },
    status: {
      type: String,
      enum: ["creating", "ready", "error"],
      default: "ready",
      index: true
    },
    repository: {
      repoUrl: String,
      branch: String
    }
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.__v;
        return ret;
      }
    }
  }
);

export default mongoose.model("Workspace", WorkspaceSchema);
