// backend/src/models/Usage.js

import mongoose from "mongoose";

const usageSchema =
  new mongoose.Schema(
    {
      userId: {
        type:
          mongoose.Schema.Types
            .ObjectId,
        ref: "User",
        required: true
      },

      dateKey: {
        type: String,
        required: true
      },

      chat: {
        type: Number,
        default: 0
      },

      file: {
        type: Number,
        default: 0
      },

      image: {
        type: Number,
        default: 0
      },

      tool: {
        type: Number,
        default: 0
      }
    },
    {
      timestamps: true
    }
  );

usageSchema.index(
  {
    userId: 1,
    dateKey: 1
  },
  {
    unique: true
  }
);

export default mongoose.model(
  "Usage",
  usageSchema
);