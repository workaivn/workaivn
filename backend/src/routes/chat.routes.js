import express from "express";

import * as chat from "../modules/chat/chat.controller.js";

import { usageLimit }
from "../middleware/usageLimit.js";

import { incrementUsage }
from "../middleware/incrementUsage.js";

const router = express.Router();

/* =========================
   CHAT
========================= */

router.post(
  "/chat",
  usageLimit("chat"),
  incrementUsage,
  chat.chat
);

router.get(
  "/chats",
  chat.list
);

router.get(
  "/chat/:id",
  chat.detail
);

export default router;