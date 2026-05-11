import mongoose from "mongoose";

const schema = new mongoose.Schema({
  userId: String,
  title: String,
  messages: Array
}, { timestamps: true });

export default mongoose.model("Chat", schema);