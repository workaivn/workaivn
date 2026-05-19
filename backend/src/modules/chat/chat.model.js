import mongoose from "mongoose";

const schema = new mongoose.Schema({

  userId: String,

  title: String,

  messages: Array,

  activeFiles: [
    new mongoose.Schema(
      {
        name: String,

        type: String,

        summary: String,

        chunks: [String]
      },
      {
        _id: false
      }
    )
  ]

}, {
  timestamps: true
});

export default mongoose.model("Chat", schema);