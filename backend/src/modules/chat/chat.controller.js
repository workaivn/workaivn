import * as service from "./chat.service.js";
import jwt from "jsonwebtoken";

function getUserId(req) {
  try {
    const token = req.headers.authorization;
    if (!token) return null;

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    return decoded.id;
  } catch {
    return null;
  }
}

export async function chat(req, res) {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).end("No token");
    }

    const {
      messages = [],
      search = false,
      chatId = null,
      mode = "normal"
    } = req.body;

    res.setHeader(
      "Content-Type",
      "text/plain; charset=utf-8"
    );

    res.setHeader(
      "Transfer-Encoding",
      "chunked"
    );

    await service.streamChat({
      userId,
      messages,
      res,
      search,
      chatId,
      mode
    });

  } catch (err) {
    console.log("CHAT ERROR:", err);
    res.status(500).end("Server error");
  }
}

export async function list(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.json([]);

    const data = await service.getChats(userId);
    res.json(data);

  } catch {
    res.json([]);
  }
}

export async function detail(req, res) {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.json({
        messages: []
      });
    }

    const data = await service.getChat(
      req.params.id,
      userId
    );

    res.json(data || {
      messages: []
    });

  } catch {
    res.json({
      messages: []
    });
  }
}