import mongoose from "mongoose";

const schema =
new mongoose.Schema(
{
  email: String,
  password: String,

  plan: {
    type: String,
    default: "free"
  },

  planExpireAt: {
    type: Date,
    default: null
  }
},
{
  timestamps:true
}
);

export default mongoose.model(
  "User",
  schema
);