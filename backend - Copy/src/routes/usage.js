import express from "express";
import jwt from "jsonwebtoken";

import Usage from "../models/Usage.js";
import User from "../modules/auth/auth.model.js";
import { getPlan } from "../config/plans.js";


const router =
  express.Router();

function todayKey() {
  const now = new Date();

  const y =
    now.getFullYear();

  const m = String(
    now.getMonth() + 1
  ).padStart(2, "0");

  const d = String(
    now.getDate()
  ).padStart(2, "0");

  return `${y}-${m}-${d}`;
}

function getUserId(req) {
  try {
    const authHeader = req.headers.authorization || "";
	const token = authHeader.startsWith("Bearer ")
	  ? authHeader.slice(7)
	  : authHeader;

    if (!token) return null;

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    return decoded.id;
  } catch {
    return null;
  }
}

router.get(
  "/usage",
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
 await User.findById(userId);

const planName =
 user?.plan || "free";

      const plan =
        getPlan(
          planName
        );

      const usage =
        await Usage.findOne({
          userId,
          dateKey:
            todayKey()
        });

      res.json({
        plan:
          planName,

        limits:
          plan.limits,

        used: {
          chat:
            usage?.chat ||
            0,
          file:
            usage?.file ||
            0,
          image:
            usage?.image ||
            0,
          tool:
            usage?.tool ||
            0
        }
      });
    } catch {
      res
        .status(500)
        .json({
          error:
            "Cannot load usage"
        });
    }
  }
);

export default router;