import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url"; const __filename = fileURLToPath(import.meta.url); const __dirname = path.dirname(__filename);
import routes from "./routes.js";
import { planGuard } from "./middleware/planGuard.js";

const app = express(); // 👈 PHẢI ĐẶT LÊN TRƯỚC

// 👇 sau đó mới tới body parser
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

/* =========================
   CORS
========================= */
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
/* =========================
   HEALTH CHECK
========================= */
app.get("/", (req, res) => {
  res.json({
    ok: true,
    name: "WorkAI VN API",
    secure:
      req.secure,
    host:
      req.headers.host,
    time:
      new Date()
  });
});

/* =========================
   STATIC GENERATED FILES
========================= */

app.use(
  "/files",
  express.static(
    path.join(
      __dirname,
      "..",
      "generated"
    ),
    {
      setHeaders: (
        res,
        filePath
      ) => {

        if (
          filePath.endsWith(".png")
        ) {
          res.setHeader(
            "Content-Type",
            "image/png"
          );
        }

        if (
          filePath.endsWith(".jpg") ||
          filePath.endsWith(".jpeg")
        ) {
          res.setHeader(
            "Content-Type",
            "image/jpeg"
          );
        }

        res.setHeader(
          "Cross-Origin-Resource-Policy",
          "cross-origin"
        );
      }
    }
  )
);





/* =========================
   API ROUTES
========================= */
app.use(
  "/api",
  planGuard
);

app.use(
  "/api",
  routes
);

/* =========================
   404
========================= */
app.use(
  (req, res) => {
    res.status(404).json({
      error:
        "Not Found"
    });
  }
);

/* =========================
   ERROR HANDLER
========================= */
app.use(
  (
    err,
    req,
    res,
    next
  ) => {
    console.log(
      "APP ERROR:",
      err
    );

    res.status(500).json({
      error:
        err.message ||
        "Server error"
    });
  }
);

export default app;
