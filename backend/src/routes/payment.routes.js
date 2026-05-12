// routes/payment.routes.js
import express from "express";
import { sepayWebhook } from "../controllers/sepay.webhook.js";
import jwt from "jsonwebtoken";
import User from "../modules/auth/auth.model.js";
import Payment from "../models/Payment.js";

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
// 🔥 route chuẩn
router.post("/bank/webhook", sepayWebhook);


/* ============================================
MY BILLINGS
============================================ */

router.get(
  "/my/billings",

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

      const list =
        await Payment.find({
          userId
        })
        .sort({
          createdAt: -1
        })
        .lean();

      return res.json(
        list
      );

    } catch (e) {

      console.log(
        "MY BILLINGS ERROR:",
        e
      );

      return res
        .status(500)
        .json({
          error:
            "load fail"
        });

    }

  }
);

/* ============================================
UPGRADE ME
============================================ */

router.get(
  "/upgrade/me",

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

      const user =
        await User.findById(
          userId
        );

      const pending =
        await Payment.findOne({
          userId,
          status: "pending"
        })
        .sort({
          createdAt: -1
        });

      return res.json({

        ok: true,

        plan:
          user?.plan ||
          "free",

        expireAt:
          user?.planExpireAt ||
          null,

        pending:
          !!pending

      });

    } catch (err) {

      return res
        .status(500)
        .json({
          error:
            "load fail"
        });

    }

  }
);

export default router;