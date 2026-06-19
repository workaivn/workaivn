import mongoose from "mongoose";

const SystemSettingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true
    },
    value: {
      type: String,
      default: ""
    },
    type: {
      type: String,
      enum: ["string", "number", "boolean", "json", "secret", "url"],
      default: "string"
    },
    group: {
      type: String,
      required: true,
      index: true,
      enum: [
        "general", "branding", "auth", "database",
        "ai_providers", "agent_hub", "plans",
        "payment", "email", "storage", "security", "landing"
      ]
    },
    label: { type: String, default: "" },
    description: { type: String, default: "" },
    isSecret: { type: Boolean, default: false },
    isPublic: { type: Boolean, default: false },
    isRuntimeEditable: { type: Boolean, default: true },
    isReadOnly: { type: Boolean, default: false },
    defaultValue: { type: String, default: "" }
  },
  { timestamps: true }
);

// mask helper used in API responses
SystemSettingSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  if (obj.isSecret && obj.value) {
    obj.value = "••••••••";
  }
  return obj;
};

export default mongoose.model("SystemSetting", SystemSettingSchema);
