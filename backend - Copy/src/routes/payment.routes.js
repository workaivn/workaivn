// routes/payment.routes.js
import express from "express";
import { sepayWebhook } from "../controllers/sepay.webhook.js";

const router = express.Router();

// 🔥 route chuẩn
router.post("/bank/webhook", sepayWebhook);

export default router;