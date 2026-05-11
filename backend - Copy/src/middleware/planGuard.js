import User from "../modules/auth/auth.model.js";

export async function planGuard(req, res, next) {
  try {

    // ✅ PUBLIC ROUTES (đặt đúng trong function)
    const publicPaths = [
      "/api/register",
      "/api/login"
    ];

    if (publicPaths.includes(req.path)) {
      return next();
    }

    const authHeader = req.headers.authorization || "";

    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader;

    if (!token) {
      return next();
    }

    const jwt = (await import("jsonwebtoken")).default;

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    const user = await User.findById(decoded.id);

    if (!user) {
      return next();
    }

    if (
      user.plan === "pro" &&
      user.planExpireAt &&
      new Date() > new Date(user.planExpireAt)
    ) {
      user.plan = "free";
      user.planExpireAt = null;
      await user.save();
    }

    next();

  } catch (err) {
    console.log("planGuard error:", err);
    next();
  }
}