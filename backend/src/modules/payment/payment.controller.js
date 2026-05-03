import Payment from "../../models/Payment.js";
import crypto from "crypto";

function genContent(userId, plan) {
  const raw = userId + "_" + Date.now();

  return (
    "SEVQR" +
    crypto
      .createHash("md5")
      .update(raw)
      .digest("hex")
      .slice(0, 6)
      .toUpperCase()
  );
}

export async function createPayment(req, res) {
  try {
    const userId = req.userId;

    // 🔥 lấy plan từ frontend
    const plan = req.body.plan || "pro";

    let amount = 99000;
    if (plan === "business") {
      amount = 499000;
    }

    // 🔥 check payment pending cũ
    const existing = await Payment.findOne({
	  userId,
	  plan, // ✅ THÊM DÒNG NÀY
	  status: "pending",
	  expireAt: { $gt: new Date() }
	});

    const BANK_BIN = "970415"; // Vietcombank
    const ACCOUNT = "13082888";

    const qr = (amount, content) =>
      `https://img.vietqr.io/image/${BANK_BIN}-${ACCOUNT}-compact.png?amount=${amount}&addInfo=${content}&accountName=WORKAI`;

    // ✅ nếu đã có payment chưa hết hạn → reuse
    if (existing) {
      return res.json({
        ok: true,
        qr: qr(existing.amount, existing.content),
        content: existing.content,
        amount: existing.amount,
        plan: existing.plan
      });
    }

    // 🔥 tạo content theo plan
    const content = genContent(userId, plan);

    // 🔥 tạo payment mới
    const payment = await Payment.create({
      userId,
      email: "",
      plan,
      amount,
      content,
      verifyHash: content,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      expireAt: new Date(Date.now() + 15 * 60 * 1000)
    });

    return res.json({
      ok: true,
      qr: qr(payment.amount, payment.content),
      content,
      amount: payment.amount,
      plan
    });

  } catch (err) {
    console.log("CREATE PAYMENT ERROR:", err);
    res.status(500).json({ error: err.message });
  }
}