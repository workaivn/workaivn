// backend/modules/auth/auth.model.js

import mongoose from "mongoose";

const schema = new mongoose.Schema(
{
  fullName: {
    type: String,
    default: ""
  },

  username: {
    type: String,
    unique: true,
    sparse: true
  },

  email: {
    type: String,
    required: true,
    unique: true
  },

  password: {
    type: String,
    required: true
  },

  avatar: {
    type: String,
    default: ""
  },

  phone: {
    type: String,
    default: ""
  },

  role: {
    type: String,
    default: "user"
  },

  status: {
    type: String,
    default: "active"
  },

  emailVerified: {
    type: Boolean,
    default: false
  },

  loginProviders: {
    type: [String],
    default: ["local"]
  },

  lastLoginAt: {
    type: Date,
    default: null
  },

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
  timestamps: true
}
);

export default mongoose.model(
  "User",
  schema
);