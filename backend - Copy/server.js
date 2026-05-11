import "dotenv/config";
import app from "./src/app.js";
import connectDB from "./src/config/db.js";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://app.workaivn.com"
  ],
  credentials: true
}));

const PORT = process.env.PORT || 5000;

// ✅ CHỈ DÙNG 1 SERVER DUY NHẤT
const server = http.createServer(app);

export const io = new Server(server, {
  cors: {
    origin: [
      "https://app.workaivn.com",
      "http://localhost:5173"
    ],
    methods: ["GET", "POST"]
  }
});

// map userId -> socket
const userSockets = new Map();

io.on("connection", (socket) => {
  socket.on("auth", (userId) => {
    userSockets.set(String(userId), socket.id);
  });

  socket.on("disconnect", () => {
    for (const [uid, sid] of userSockets.entries()) {
      if (sid === socket.id) {
        userSockets.delete(uid);
      }
    }
  });
});

export function emitPaymentSuccess(userId) {
  const sid = userSockets.get(String(userId));
  if (sid) {
    io.to(sid).emit("payment_success");
  }
}

async function start() {
  try {
    await connectDB();

    // ✅ CHỈ LISTEN Ở ĐÂY
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🌐 http://localhost:${PORT}`);
    });

  } catch (err) {
    console.error("SERVER START ERROR:", err);
    process.exit(1);
  }
}

start();