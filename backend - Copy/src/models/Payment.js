import mongoose from "mongoose";

const PaymentSchema = new mongoose.Schema({
  userId: String,
  email: String,

  plan: String,
  amount: Number,

  content: String,        // nội dung chuyển khoản (unique)
  verifyHash: String,     // chống fake
  qr: String,
  transactionId: String,
  bankCode: String,
  ip: String,
  userAgent: String,

  status: {
    type: String,
    default: "pending"
  },

  paidAt: Date,

  createdAt: {
    type: Date,
    default: Date.now
  },

  expireAt: Date
});

export default mongoose.model("Payment", PaymentSchema);