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

/* ============================================
LIST BILLINGS
============================================ */

router.get(
  "/admin/billings",
  isAdmin,

  async (req, res) => {

    try {

      const status =
        String(
          req.query.status || ""
        ).trim();

      const filter = {};

      if (status) {
        filter.status = status;
      }

      const list =
        await Payment.find(filter)
        .sort({
          createdAt: -1
        })
        .limit(100)
        .lean();

      const userIds =
        list.map(
          p => p.userId
        );

      const users =
        await User.find({
          _id: {
            $in: userIds
          }
        }).lean();

      const userMap = {};

      users.forEach(u => {
        userMap[
          String(u._id)
        ] = u.email;
      });

      const result =
        list.map(p => ({

          _id: p._id,

          userId:
            p.userId,

          email:
            userMap[
              String(p.userId)
            ] || "",

          amount:
            p.amount || 0,

          plan:
            p.plan || "free",

          status:
            p.status || "pending",

          createdAt:
            p.createdAt

        }));

      return res.json(
        result
      );

    } catch (err) {

      console.log(
        "ADMIN BILLINGS ERROR:",
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

/* ============================================
ANALYTICS CHART
============================================ */

router.get(
  "/admin/analytics/chart",
  isAdmin,

  async (req, res) => {

    try {

      const result = [];

      for (
        let i = 6;
        i >= 0;
        i--
      ) {

        const d =
          new Date();

        d.setDate(
          d.getDate() - i
        );

        const start =
          new Date(d);

        start.setHours(
          0, 0, 0, 0
        );

        const end =
          new Date(d);

        end.setHours(
          23, 59, 59, 999
        );

        const users =
          await User.countDocuments({
            createdAt: {
              $gte: start,
              $lte: end
            }
          });

        const usage =
          await Usage.find({
            createdAt: {
              $gte: start,
              $lte: end
            }
          });

        let chat = 0;

        usage.forEach(u => {
          chat +=
            u.chat || 0;
        });

        const payments =
          await Payment.find({
            status: "approved",
            createdAt: {
              $gte: start,
              $lte: end
            }
          });

        let revenue = 0;

        payments.forEach(p => {
          revenue +=
            p.amount || 0;
        });

        result.push({

          date:
            `${String(
              d.getDate()
            ).padStart(2, "0")}/${
              String(
                d.getMonth() + 1
              ).padStart(2, "0")
            }`,

          users,
          chat,
          revenue

        });

      }

      return res.json(
        result
      );

    } catch (err) {

      console.log(
        "ANALYTICS CHART ERROR:",
        err
      );

      return res
        .status(500)
        .json({
          error:
            "chart fail"
        });

    }

  }
);

export default router;