import mongoose from "mongoose";

const schema = new mongoose.Schema({

  userId: String,

  title: String,

  messages: Array,

 activeFiles: [
	  {

		name: String,

		type: String,

		summary: String,

		chunks: [String]

	  }
	]

}, {
  timestamps: true
});

export default mongoose.model("Chat", schema);