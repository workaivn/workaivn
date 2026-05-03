import "dotenv/config";
import app from "./src/app.js";
import connectDB from "./src/config/db.js";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

// ✅ FIX CORS FULL
const allowedOrigins = [
  "http://localhost:5173",
  "https://workaivn.vercel.app",
  "https://workaivn.com",
  "https://app.workaivn.com"
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("CORS not allowed: " + origin));
  },
  credentials: true
}));

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

// ✅ FIX SOCKET.IO CORS
export const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
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

    server.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });

  } catch (err) {
    console.error("SERVER START ERROR:", err);
    process.exit(1);
  }
}

start();
