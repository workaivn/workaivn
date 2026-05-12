import express from "express";

import User
from "../modules/auth/auth.model.js";

import Payment
from "../models/Payment.js";

import Usage
from "../models/Usage.js";

import { isAdmin }
from "../middleware/isAdmin.js";

import { getPlan }
from "../config/plans.js";

const router = express.Router();

/* =========================
   ADMIN USERS
========================= */

router.get(
  "/admin/users",
  isAdmin,

  async (req, res) => {

    try {

      const q =
        String(
          req.query.q || ""
        ).trim();

      const filter = {};

      if (q) {

        filter.email = {
          $regex: q,
          $options: "i"
        };

      }

      const list =
        await User.find(filter)
        .select(
          "email plan createdAt planExpireAt"
        )
        .sort({
          createdAt: -1
        })
        .limit(200);

      return res.json(list);

    } catch {

      return res
        .status(500)
        .json({
          error: "load fail"
        });

    }

  }
);

/* =========================
   ANALYTICS
========================= */

router.get(
  "/admin/analytics",
  isAdmin,

  async (req, res) => {

    try {

      const totalUsers =
        await User.countDocuments();

      const proUsers =
        await User.countDocuments({
          plan: "pro"
        });

      const businessUsers =
        await User.countDocuments({
          plan: "business"
        });

      let revenue = 0;

      try {

        const payments =
          await Payment.find({
            status: "approved"
          });

        payments.forEach((p) => {
          revenue += p.amount || 0;
        });

      } catch {}

      return res.json({
        totalUsers,
        proUsers,
        businessUsers,
        revenue
      });

    } catch (err) {

      console.log(err);

      return res
        .status(500)
        .json({
          error:
            "analytics fail"
        });

    }

  }
);

export default router;