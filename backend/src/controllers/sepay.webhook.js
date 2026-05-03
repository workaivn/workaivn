// controllers/sepay.webhook.js
import Payment from "../models/Payment.js";
import User from "../modules/auth/auth.model.js";
import crypto from "crypto";

export async function sepayWebhook(req, res) {
  try {
    // =========================
    // 1. VERIFY REQUEST (SECURITY)
    // =========================

    const API_KEY = process.env.SEPAY_API_KEY;

    // nếu bạn bật API key trên SePay
    if (API_KEY) {
      const auth = req.headers["authorization"] || "";

		if (!auth.startsWith("Apikey ")) {
		  return res.status(401).send("UNAUTHORIZED");
		}

		const key = auth.replace("Apikey ", "").trim();

		if (key !== process.env.SEPAY_API_KEY) {
		  return res.status(401).send("UNAUTHORIZED");
		}
    }

    // =========================
    // 2. NORMALIZE DATA
    // =========================

    const body = req.body;

	console.log("WEBHOOK BODY:", body);

	const rawDesc = body.description || body.content || "";

	// 🔥 lấy đúng mã SEVQRxxxx
	const match = rawDesc.match(/SEVQR[A-Z0-9]+/);
	const description = match ? match[0] : "";

	// 🔥 amount đúng field SePay
	const amount = Number(body.transferAmount || 0);

	const data = {
	  amount,
	  description,
	  transactionId: body.referenceCode || body.id,
	  bank: body.gateway || "ICB"
	};

    // =========================
    // 3. BASIC VALIDATION
    // =========================

    if (!data.amount || !data.description) {
      console.log("❌ INVALID DATA");
      return res.send("INVALID DATA");
    }

    // bắt buộc prefix
    if (!data.description.startsWith("SEVQR")) {
      console.log("❌ INVALID PREFIX:", data.description);
      return res.send("IGNORE");
    }

    // =========================
    // 4. FIND PAYMENT
    // =========================

    const payment = await Payment.findOne({
      content: data.description
    });

    if (!payment) {
      console.log("❌ PAYMENT NOT FOUND:", data.description);
      return res.send("NOT FOUND");
    }

    // =========================
    // 5. IDEMPOTENT CHECK
    // =========================

    if (payment.status === "approved") {
      console.log("⚠️ ALREADY APPROVED:", payment._id);
      return res.send("OK");
    }

    // =========================
    // 6. EXPIRE CHECK
    // =========================

    const isExpired =
	  payment.expireAt &&
	  payment.expireAt < new Date();

	if (isExpired) {
	  console.log("⚠️ EXPIRED nhưng vẫn cho xử lý (dev)");
	}

    // =========================
    // 7. AMOUNT CHECK
    // =========================

    if (Number(data.amount) !== Number(payment.amount)) {
      console.log(
        "❌ AMOUNT MISMATCH:",
        data.amount,
        payment.amount
      );
      return res.send("INVALID AMOUNT");
    }

    // =========================
    // 8. DUPLICATE TX CHECK
    // =========================

    const existedTx = await Payment.findOne({
      transactionId: data.transactionId
    });

    if (existedTx) {
      console.log("⚠️ DUPLICATE TX:", data.transactionId);
      return res.send("DUPLICATE");
    }

    // =========================
    // 9. UPDATE PAYMENT
    // =========================

    payment.status = "approved";
    payment.transactionId = data.transactionId;
    payment.bankCode = data.bank;
    payment.paidAt = new Date();

    await payment.save();

    // =========================
    // 10. UPDATE USER PLAN
    // =========================

    await User.findByIdAndUpdate(payment.userId, {
      plan: payment.plan,
      planExpireAt: new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000
      )
    });

    console.log(
      "✅ PAYMENT VERIFIED:",
      payment.userId,
      payment.plan
    );

    return res.send("OK");

  } catch (err) {
    console.log("🔥 WEBHOOK ERROR:", err);
    return res.status(500).send("ERROR");
  }
}