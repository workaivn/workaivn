// backend/modules/auth/auth.controller.js

import * as service from "./auth.service.js";
import jwt from "jsonwebtoken";

/* =========================================
HELPER
========================================= */

function getUserId(req) {
  try {

    const authHeader =
      req.headers.authorization || "";

    const token =
      authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : authHeader;

    if (!token) return null;

    const decoded =
      jwt.verify(
        token,
        process.env.JWT_SECRET
      );

    return decoded.id;

  } catch {
    return null;
  }
}

/* =========================================
REGISTER
========================================= */

export async function register(req, res) {
  try {

    const user =
      await service.register(
        req.body
      );

    res.json({
      ok: true,
      userId: user._id
    });

  } catch (e) {

    res.status(400).json({
      error: String(e)
    });

  }
}

/* =========================================
LOGIN
========================================= */

export async function login(req, res) {
  try {

    const {
      account,
      password
    } = req.body;

    const result =
      await service.login(
        account,
        password
      );

    res.json(result);

  } catch (e) {

    res.status(400).json({
      error: String(e)
    });

  }
}

/* =========================================
ME
========================================= */

export async function me(req, res) {
  try {

    const userId =
      getUserId(req);

    if (!userId) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    const user =
      await service.getProfile(
        userId
      );

    res.json(user);

  } catch (e) {

    res.status(400).json({
      error: String(e)
    });

  }
}

/* =========================================
UPDATE PROFILE
========================================= */

export async function updateMe(req, res) {
  try {

    const userId =
      getUserId(req);

    if (!userId) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    const user =
      await service.updateProfile(
        userId,
        req.body
      );

    res.json({
      ok: true,
      user
    });

  } catch (e) {

    res.status(400).json({
      error: String(e)
    });

  }
}

/* =========================================
CHANGE PASSWORD
========================================= */

export async function changePassword(req, res) {
  try {

    const userId =
      getUserId(req);

    if (!userId) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    const {
      oldPassword,
      newPassword
    } = req.body;

    await service.changePassword(
      userId,
      oldPassword,
      newPassword
    );

    res.json({
      ok: true
    });

  } catch (e) {

    res.status(400).json({
      error: String(e)
    });

  }
}