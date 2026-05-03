// backend/src/middleware/usageLimit.js

import jwt from "jsonwebtoken";
import User from "../modules/auth/auth.model.js";
import Usage from "../models/Usage.js";
import { getPlan } from "../config/plans.js";

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

/*
type:
chat
file
image
tool
*/

export function usageLimit(
  type = "chat"
) {
  return async function (
    req,
    res,
    next
  ) {
    try {
      const authHeader = req.headers.authorization || "";

	const token = authHeader.startsWith("Bearer ")
	  ? authHeader.slice(7)
	  : authHeader;

if (!token) {
  return res.status(401).json({
    error: "Unauthorized"
  });
}

const decoded = jwt.verify(token, process.env.JWT_SECRET);

const user =
  await User.findById(
    decoded.id
  );

if (!user) {
  return res.status(401).json({
    error: "Unauthorized"
  });
}

const plan =
  getPlan(
    user.plan || "free"
  );

      const dateKey =
        todayKey();

      let usage =
        await Usage.findOne(
          {
            userId:
              user._id,
            dateKey
          }
        );

      if (!usage) {
        usage =
          await Usage.create(
            {
              userId:
                user._id,
              dateKey
            }
          );
      }

      const map = {
        chat: "chat",
        file: "file",
        image: "image",
        tool: "tool"
      };

      const limitMap = {
        chat:
          "chatPerDay",
        file:
          "filePerDay",
        image:
          "imagePerDay",
        tool:
          "toolPerDay"
      };

      const key =
        map[type];

      const limitKey =
        limitMap[type];

      const used =
        usage[key] || 0;

      const limit =
        plan.limits[
          limitKey
        ];

      if (
        used >= limit
      ) {
        return res
          .status(403)
          .json({
            error:
              "LIMIT_REACHED",
            type,
            used,
            limit,
            plan:
              user.plan ||
              "free",
            upgrade:
              true
          });
      }

      req.usageDoc =
        usage;

      req.usageType =
        key;

      next();

    } catch (err) {
      res
        .status(500)
        .json({
          error:
            "Usage check failed"
        });
    }
  };
}