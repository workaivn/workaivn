import express from "express";
import multer from "multer";
import OpenAI from "openai";
import sharp from "sharp";
import fs from "fs";
import path from "path";

import User from "../modules/auth/auth.model.js";

import { usageLimit }
from "../middleware/usageLimit.js";

import { incrementUsage }
from "../middleware/incrementUsage.js";

import cloudinary
from "../config/cloudinary.js";

const router = express.Router();

const upload = multer({
  dest: "uploads/"
});

const openai = new OpenAI({
  apiKey:
    process.env.OPENAI_API_KEY
});

const FILE_DIR = path.join(
  process.cwd(),
  "generated"
);

function fileUrl(name, req) {

  if (
    process.env.BASE_URL
  ) {
    return `${process.env.BASE_URL}/files/${name}`;
  }

  const host =
    req.get("host");

  const isLocal =
    host.includes("localhost") ||
    host.includes("127.0.0.1");

  const protocol =
    isLocal ? "http" : "https";

  return `${protocol}://${host}/files/${name}`;
}

/* =========================
   IMAGE
========================= */

router.post(
  "/generate-image",
  usageLimit("image"),
  incrementUsage,
  upload.single("file"),

  async (req, res) => {

    try {

      const finalPrompt =
        String(
          req.body?.prompt || ""
        ).trim();

      const result =
        await openai.images.generate({
          model: "gpt-image-1",
          prompt:
            finalPrompt ||
            "Tạo ảnh đẹp",
          size: "1024x1024"
        });

      const b64 =
        result.data?.[0]?.b64_json;

      if (!b64) {
        throw new Error(
          "Create image fail"
        );
      }

      const fileName =
        `img_${Date.now()}.jpg`;

      const savePath =
        path.join(
          FILE_DIR,
          fileName
        );

      await sharp(
        Buffer.from(
          b64,
          "base64"
        )
      )
      .jpeg({
        quality: 80
      })
      .toFile(savePath);

      const uploaded =
        await cloudinary
        .uploader
        .upload(
          savePath,
          {
            folder: "workaivn"
          }
        );

      if (
        fs.existsSync(savePath)
      ) {
        fs.unlinkSync(savePath);
      }

      return res.json({
        ok: true,
        imageUrl:
          uploaded.secure_url
      });

    } catch (err) {

      console.log(
        "IMAGE ERROR:",
        err
      );

      return res
        .status(500)
        .json({
          error:
            err.message
        });

    }

  }
);

/* =========================
   AVATAR
========================= */

router.post(
  "/upload-avatar",
  upload.single("file"),

  async (req, res) => {

    try {

      const authHeader =
        req.headers.authorization || "";

      const token =
        authHeader.startsWith("Bearer ")
          ? authHeader.slice(7)
          : authHeader;

      if (!token) {
        return res.status(401).json({
          error: "Unauthorized"
        });
      }

      const jwt =
        (await import("jsonwebtoken"))
        .default;

      const decoded =
        jwt.verify(
          token,
          process.env.JWT_SECRET
        );

      const userId =
        decoded.id;

      if (!req.file) {
        return res
          .status(400)
          .json({
            error: "No file"
          });
      }

      const ext =
        path.extname(
          req.file.originalname
        ) || ".png";

      const fileName =
        `avatar_${Date.now()}${ext}`;

      const savePath =
        path.join(
          FILE_DIR,
          fileName
        );

      await sharp(req.file.path)
        .resize(300, 300)
        .jpeg({
          quality: 90
        })
        .toFile(savePath);

      fs.unlinkSync(
        req.file.path
      );

      const avatar =
        fileUrl(
          fileName,
          req
        );

      const user =
        await User.findById(
          userId
        );

      if (user) {

        user.avatar =
          avatar;

        await user.save();

      }

      return res.json({
        ok: true,
        avatar
      });

    } catch (e) {

      console.log(
        "UPLOAD AVATAR ERROR:",
        e
      );

      return res
        .status(500)
        .json({
          error:
            "upload fail"
        });

    }

  }
);

export default router;