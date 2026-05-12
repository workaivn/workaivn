import express from "express";

import * as auth from "../modules/auth/auth.controller.js";

const router = express.Router();

/* =========================
   AUTH
========================= */

router.post(
  "/forgot-password",
  auth.forgotPassword
);

router.post(
  "/reset-password",
  auth.resetPassword
);

router.post(
  "/register",
  auth.register
);

router.post(
  "/login",
  auth.login
);

router.get(
  "/me",
  auth.me
);

router.put(
  "/me",
  auth.updateMe
);

router.put(
  "/me/password",
  auth.changePassword
);

export default router;