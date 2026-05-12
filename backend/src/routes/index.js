import express from "express";

import authRoutes from "./auth.routes.js";
import chatRoutes from "./chat.routes.js";
import imageRoutes from "./image.routes.js";
import adminRoutes from "./admin.routes.js";

import usageRoutes from "./usage.js";
import paymentRoutes from "./payment.routes.js";

const router = express.Router();

router.use("/", usageRoutes);
router.use("/", paymentRoutes);

router.use("/", authRoutes);
router.use("/", chatRoutes);
router.use("/", imageRoutes);
router.use("/", adminRoutes);

export default router;