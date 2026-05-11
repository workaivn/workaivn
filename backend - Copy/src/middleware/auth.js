import jwt from "jsonwebtoken";

export function auth(req, res, next) {
  try {
    const authHeader =
      req.headers.authorization || "";

    if (!authHeader) {
      return res
        .status(401)
        .json({ error: "Unauthorized" });
    }

    // 🔥 FIX QUAN TRỌNG
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader;

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    req.userId = decoded.id;

    next();

  } catch (err) {
    console.log("AUTH ERROR:", err.message);

    res
      .status(401)
      .json({ error: "Unauthorized" });
  }
}