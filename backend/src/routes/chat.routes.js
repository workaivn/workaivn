import express from "express";
import * as chat from "../modules/chat/chat.controller.js";
import Chat from "../modules/chat/chat.model.js";
import jwt from "jsonwebtoken";
import { usageLimit } from "../middleware/usageLimit.js";
import { incrementUsage } from "../middleware/incrementUsage.js";

const router = express.Router();

function getUserId(req) {

  try {

    const authHeader =
      req.headers.authorization || "";

    const token =
      authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : authHeader;

    if (!token) {
      return null;
    }

    const decoded =
      jwt.verify(
        token,
        process.env.JWT_SECRET
      );

    return decoded.id;

  } catch {

    return null;

  }

}


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

/* =========================
   RENAME CHAT
========================= */

router.put(
  "/chat/:id/rename",

  async (req, res) => {

    try {

      const userId =
        getUserId(req);

      if (!userId) {
        return res
          .status(401)
          .json({
            error:
              "Unauthorized"
          });
      }

      const title =
        String(
          req.body.title || ""
        )
        .trim()
        .slice(0, 80);

      const item =
        await Chat.findById(
          req.params.id
        );

      if (!item) {
        return res
          .status(404)
          .json({
            error:
              "Chat not found"
          });
      }

      if (
        String(item.userId) !==
        String(userId)
      ) {
        return res
          .status(403)
          .json({
            error:
              "Forbidden"
          });
      }

      item.title =
        title || "New Chat";

      await item.save();

      return res.json({
        ok: true
      });

    } catch (err) {

      console.log(
        "RENAME ERROR:",
        err
      );

      return res
        .status(500)
        .json({
          error:
            "rename fail"
        });

    }

  }
);

/* =========================
   DELETE CHAT
========================= */

router.delete(
  "/chat/:id",

  async (req, res) => {

    try {

      const userId =
        getUserId(req);

      if (!userId) {
        return res
          .status(401)
          .json({
            error:
              "Unauthorized"
          });
      }

      const item =
        await Chat.findById(
          req.params.id
        );

      if (!item) {
        return res
          .status(404)
          .json({
            error:
              "Chat not found"
          });
      }

      if (
        String(item.userId) !==
        String(userId)
      ) {
        return res
          .status(403)
          .json({
            error:
              "Forbidden"
          });
      }

      await Chat.findByIdAndDelete(
        req.params.id
      );

      return res.json({
        ok: true
      });

    } catch (err) {

      console.log(
        "DELETE ERROR:",
        err
      );

      return res
        .status(500)
        .json({
          error:
            "delete fail"
        });

    }

  }
);

export default router;