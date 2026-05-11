// BUILD ADMIN SECURITY

import User from "../modules/auth/auth.model.js";
import jwt from "jsonwebtoken";

export async function isAdmin(
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
      return res
        .status(401)
        .json({
          error:
            "Unauthorized"
        });
    }

    const decoded =
      jwt.verify(
        token,
        process.env.JWT_SECRET
      );

    const user =
      await User.findById(
        decoded.id
      );

    if (!user) {
      return res
        .status(401)
        .json({
          error:
            "User not found"
        });
    }

    const adminEmail =
      String(
        process.env
          .ADMIN_EMAIL ||
          ""
      )
        .trim()
        .toLowerCase();

    const userEmail =
      String(
        user.email ||
          ""
      )
        .trim()
        .toLowerCase();

    if (
      userEmail !==
      adminEmail
    ) {
      return res
        .status(403)
        .json({
          error:
            "Forbidden"
        });
    }

    req.adminUser =
      user;

    next();

  } catch (err) {
    return res
      .status(401)
      .json({
        error:
          "Invalid token"
        });
  }
}