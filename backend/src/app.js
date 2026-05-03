import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import routes from "./routes.js";
import { planGuard } from "./middleware/planGuard.js";

const app = express();

// ✅ CORS DUY NHẤT
app.use(cors({
  origin: [
    "https://workaivn.vercel.app",
    "https://workaivn.com",
    "https://www.workaivn.com",
    "https://app.workaivn.com",
    "http://localhost:5173",
    "http://127.0.0.1:5173"
  ],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization"],
  methods: ["GET","POST","PUT","DELETE","OPTIONS"]
}));

// BODY
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// TEST ROUTE (để debug)
app.get("/api/test", (req,res)=>{
  res.json({ ok:true });
});

// ROUTES
app.use("/api", planGuard);
app.use("/api", routes);

// ROOT
app.get("/", (req, res) => {
  res.json({ ok: true });
});

export default app;
