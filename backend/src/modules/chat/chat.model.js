import mongoose from "mongoose";

const schema = new mongoose.Schema({

  userId: String,

  title: String,

  messages: Array,

  activeFiles: [
    {
      name: String,
      content: String,
      type: String
    }
  ]

}, {
  timestamps: true
});

export default mongoose.model("Chat", schema);