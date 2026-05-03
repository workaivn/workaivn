import User from "./auth.model.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export async function register(email, password) {
  const exists = await User.findOne({ email });
  if (exists) throw "User already exists";

  const hash = await bcrypt.hash(password, 10);
  await User.create({
  email,
  password: hash,
  plan: "free"
});
}

export async function login(email, password) {
  const user = await User.findOne({ email });
  if (!user) throw "User not found";

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) throw "Wrong password";

  return jwt.sign({ id: user._id }, process.env.JWT_SECRET);
}