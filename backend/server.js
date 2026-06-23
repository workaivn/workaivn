import "dotenv/config";
import app from "./src/app.js";
import connectDB from "./src/config/db.js";
import http from "http";
import { Server } from "socket.io";
import healthRoute from "./src/routes/health.js";
import { configureRealtime, emitPaymentSuccess } from "./src/services/realtime.js";
import { ensureManagedWorkspaceRoot } from "./src/agent/workspace.js";
healthRoute(app);

// ✅ FIX CORS FULL
const allowedOrigins = [
  "http://localhost:5173",
  "https://workaivn.vercel.app",
  "https://workaivn.com",
  "https://app.workaivn.com"
];
app.set("trust proxy", 1);

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

configureRealtime(io);
export { emitPaymentSuccess };

async function start() {
  try {
    await ensureManagedWorkspaceRoot();
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
