import Payment from "../../models/Payment.js";
import User from "../auth/auth.model.js";
import { emitPaymentSuccess } from "../../../server.js";

export async function bankWebhook(req, res) {
  try {
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


    const payment = await Payment.findOne({
      content: data.description
    });

    if (!payment) {
      console.log("❌ NOT FOUND:", data);
      return res.send("NOT FOUND");
    }

    // ✅ idempotent
    if (payment.status === "approved") {
      return res.send("OK");
    }

    // ❗ expired
    if (payment.expireAt && payment.expireAt < new Date()) {
      return res.send("EXPIRED");
    }

    // ❗ check amount
    if (Number(data.amount) !== Number(payment.amount)) {
      console.log("❌ AMOUNT MISMATCH:", data.amount, payment.amount);
      return res.send("INVALID AMOUNT");
    }

    // ❗ check content
    if (data.description !== payment.content) {
      console.log("❌ CONTENT MISMATCH:", data.description, payment.content);
      return res.send("INVALID CONTENT");
    }

    // ❗ chống replay
    const existedTx = await Payment.findOne({
      transactionId: data.transactionId
    });

    if (existedTx) {
      return res.send("DUPLICATE TX");
    }

    // ✅ update payment
    payment.status = "approved";
    payment.transactionId = data.transactionId;
    payment.bankCode = data.bank;
    payment.paidAt = new Date();

    await payment.save();

    // 🔥 update user theo plan đã mua
    await User.findByIdAndUpdate(payment.userId, {
      plan: payment.plan,
      planExpireAt: new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000
      )
    });

    // 🔥 realtime update (nếu có socket)
    emitPaymentSuccess(payment.userId);

    console.log("✅ VERIFIED:", payment.userId, payment.plan);

    return res.send("OK");

  } catch (err) {
    console.log("WEBHOOK ERROR:", err);
    return res.status(500).send("ERROR");
  }
}