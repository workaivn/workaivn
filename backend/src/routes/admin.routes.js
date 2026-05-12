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

/* =========================
   SET USER PLAN
========================= */

router.post(
  "/admin/user/:id/plan",
  isAdmin,

  async (req, res) => {

    try {

      const plan =
        String(
          req.body.plan ||
          "free"
        );

      const user =
        await User.findById(
          req.params.id
        );

      if (!user) {
        return res
          .status(404)
          .json({
            error:
              "User not found"
          });
      }

      user.plan = plan;

      if (
        plan === "pro" ||
        plan === "business"
      ) {

        user.planExpireAt =
          new Date(
            Date.now() +
            30 *
            24 *
            60 *
            60 *
            1000
          );

      } else {

        user.planExpireAt =
          null;

      }

      await user.save();

      return res.json({
        ok: true
      });

    } catch {

      return res
        .status(500)
        .json({
          error:
            "save fail"
        });

    }

  }
);

/* =========================
   USER USAGE
========================= */

router.get(
  "/admin/user/:id/usage",
  isAdmin,

  async (req, res) => {

    try {

      const user =
        await User.findById(
          req.params.id
        );

      if (!user) {
        return res
          .status(404)
          .json({
            error:
              "User not found"
          });
      }

      const agg =
        await Usage.aggregate([
          {
            $match: {
              userId: user._id
            }
          },
          {
            $group: {
              _id: null,
              chat: {
                $sum: "$chat"
              },
              file: {
                $sum: "$file"
              },
              image: {
                $sum: "$image"
              },
              tool: {
                $sum: "$tool"
              }
            }
          }
        ]);

      const usage =
        agg[0] || {};

      const used =
        usage || {};

      const planName =
        String(
          user.plan || "free"
        ).toLowerCase();

      const planConfig =
        getPlan(planName);

      const limits = {
        chat:
          planConfig.limits.chatPerDay,

        file:
          planConfig.limits.filePerDay,

        image:
          planConfig.limits.imagePerDay,

        tool:
          planConfig.limits.toolPerDay
      };

      return res.json({

        ok: true,

        email: user.email,

        plan: planName,

        used: {
          chat:
            used.chat || 0,

          file:
            used.file || 0,

          image:
            used.image || 0,

          tool:
            used.tool || 0
        },

        limits

      });

    } catch (err) {

      console.log(
        "USAGE ADMIN ERROR:",
        err
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

export default router;