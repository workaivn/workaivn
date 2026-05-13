import usageRouter from "./routes/usage.js";
import { usageLimit } from "./middleware/usageLimit.js";
import { incrementUsage } from "./middleware/incrementUsage.js";
import express from "express";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import multer from "multer";
import ExcelJS from "exceljs";
import axios from "axios";
import FormData from "form-data";
import archiver from "archiver";
import PDFDocument from "pdfkit";
import mammoth from "mammoth";
import * as pdfParse from "pdf-parse";
import PDFParser from "pdf2json";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import XLSX from "xlsx";
import WordExtractor from "word-extractor";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { fromPath } from "pdf2pic";
import { Poppler } from "node-poppler";
import Tesseract from "tesseract.js";
import User from "./modules/auth/auth.model.js";
import { askAI } from "./services/aiRouter.js";
import { createPayment } from "./modules/payment/payment.controller.js";
import { bankWebhook } from "./modules/payment/payment.webhook.js";
import { auth as authMiddleware } from "./middleware/auth.js";
import Payment from "./models/Payment.js";
import Usage from "./models/Usage.js";
import paymentRoutes from "./routes/payment.routes.js";
import { sepayWebhook } from "./controllers/sepay.webhook.js";
import { isAdmin }
from "./middleware/isAdmin.js";


// =====================================
// OCR PDF SCAN WINDOWS
// =====================================

async function readPdfOCR(filePath){

try{

const outDir =
"./uploads/ocr";

if(!fs.existsSync(outDir)){
fs.mkdirSync(
outDir,
{ recursive:true }
);
}

const poppler =
new Poppler();

/* convert pdf -> png */
await poppler.pdfToCairo(
filePath,
`${outDir}/page`,
{
pngFile:true
}
);

/* quét tất cả ảnh page-1.png ... */
const files =
fs.readdirSync(outDir)
.filter(x=>x.endsWith(".png"));

if(!files.length){
return "";
}

let allText = "";

for(const name of files){

const full =
`${outDir}/${name}`;

try{

const result =
await Tesseract.recognize(
full,
"vie+eng",
{
logger:m=>{}
}
);

const text =
result?.data?.text || "";

allText +=
`\n--- ${name} ---\n` +
text +
"\n";

}catch(err){

console.log(
"OCR FILE FAIL:",
name,
err
);

}

/* xóa file tạm */
try{
fs.unlinkSync(full);
}catch{}

}

return allText.trim();

}catch(err){

console.log(
"PDF OCR ERROR:",
err
);

return "";
}
}

import {
  Document,
  Packer,
  Paragraph
} from "docx";

import Chat from "./modules/chat/chat.model.js";

const router = express.Router();
router.use("/", usageRouter);
router.use("/", paymentRoutes);
const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const BACKEND_DIR = path.dirname(__filename);
const ROOT_DIR = path.resolve(BACKEND_DIR, "..");
const PY_FILE = path.join(ROOT_DIR, "passport.py");

/* =========================
   MULTER
========================= */

const upload = multer({
  dest: "uploads/"
});

/* =========================
   GENERATED DIR
========================= */

const FILE_DIR = path.join(
  BACKEND_DIR,
  "..",
  "generated"
);


if (!fs.existsSync(FILE_DIR)) {
  fs.mkdirSync(FILE_DIR, {
    recursive: true
  });
}

/* =========================
   HELPERS
========================= */

function getUserId(req) {
  try {
    const authHeader = req.headers.authorization || "";

	const token = authHeader.startsWith("Bearer ")
	  ? authHeader.slice(7)
	  : authHeader;

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

function todayKey() {
  const now = new Date();

  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");

  return `${y}-${m}-${d}`;
}

function fileUrl(name, req) {

  if (
    process.env.BASE_URL
  ) {
    return `${process.env.BASE_URL}/files/${name}`;
  }

  const host =
    req.get("host");

  const isLocal =
    host.includes(
      "localhost"
    ) ||
    host.includes(
      "127.0.0.1"
    );

  const protocol =
    isLocal
      ? "http"
      : "https";

  return `${protocol}://${host}/files/${name}`;
}

function fileMsg(icon, name, req) {
  return `${icon} **${name}**
[⬇ Download file](${fileUrl(name, req)})`;
}



async function saveChat(
  req,
  userText,
  aiText,
  chatId
) {
  const userId =
    getUserId(req);

  if (!userId) {
    throw new Error(
      "Unauthorized"
    );
  }

  let doc = null;

  if (chatId) {
    doc = await Chat.findOne({
      _id: chatId,
      userId
    });
  }

  if (!doc) {
    doc = await Chat.create({
      userId,
      title:
        userText?.slice(0, 50) ||
        "New Chat",
      messages: []
    });
  }

  doc.messages.push(
    {
      role: "user",
      content: userText
    },
    {
      role: "assistant",
      content: aiText
    }
  );

  doc.updatedAt = new Date();

  await doc.save();

  return doc._id;
}

async function readPdfText(filePath){
try{

const data =
new Uint8Array(
fs.readFileSync(filePath)
);

const pdf =
await pdfjsLib.getDocument({
data
}).promise;

let text="";

for(
let i=1;
i<=pdf.numPages;
i++
){

const page =
await pdf.getPage(i);

const content =
await page.getTextContent();

text += content.items
.map(x=>x.str)
.join(" ");

text += "\n\n";
}

return text.trim();

}catch(err){

console.log(
"PDF READ ERROR:",
err
);

return "";
}
}

/* =========================
   FILE UPLOAD
========================= */

router.post(
"/upload-file",
usageLimit("file"),
incrementUsage,
upload.array("files", 20),
async (req,res)=>{
try{

const files =
  req.files || [];

if (!files.length) {
return res.status(400).json({
error:"No file"
});
}

const {prompt,chatId}=req.body;

let mergedText = "";
let hasCodeFile = false;

for (const file of files) {

  const ext = path
    .extname(file.originalname)
    .toLowerCase();

  let text = "";

  /* =========================
     CODE FILE LIST
  ========================= */

  const codeExt = [
    ".js",".mjs",".cjs",
    ".ts",".tsx",".jsx",
    ".py",".java",".php",
    ".rb",".go",".rs",
    ".cpp",".c",".h",
    ".hpp",".cs",
    ".html",".css",
    ".scss",".sass",".less",
    ".json",".env",
    ".xml",".yml",".yaml",
    ".sql",".md",".txt",
    ".log",".sh",".bat"
  ];

  const isCodeFile =
    codeExt.includes(ext);

  if (isCodeFile) {
    hasCodeFile = true;
  }

  /* =====================
     PDF
  ===================== */

  if (ext === ".pdf") {

    text =
      await readPdfText(
        file.path
      );

    /* scan fallback */

    if (
      !text ||
      text.trim().length < 20
    ) {

      console.log(
        "PDF scan detected -> OCR"
      );

      text =
        await readPdfOCR(
          file.path
        );

    }

  }

  /* =====================
     DOCX
  ===================== */

  else if (
    ext === ".docx"
  ) {

    try {

      const data =
        await mammoth.extractRawText({
          path: file.path
        });

      text =
        data.value || "";

    } catch {

      text = "";

    }

  }

  /* =====================
     DOC
  ===================== */

  else if (
    ext === ".doc"
  ) {

    try {

      const extractor =
        new WordExtractor();

      const doc =
        await extractor.extract(
          file.path
        );

      text =
        doc.getBody() || "";

    } catch {

      text = "";

    }

  }

  /* =====================
     XLS / XLSX
  ===================== */

  else if (
    ext === ".xlsx" ||
    ext === ".xls"
  ) {

    try {

      const wb =
        XLSX.readFile(
          file.path
        );

      let rows = [];

      wb.SheetNames.forEach(
        (name) => {

          const ws =
            wb.Sheets[name];

          const data =
            XLSX.utils.sheet_to_json(
              ws,
              {
                header: 1,
                blankrows: false
              }
            );

          data.forEach(row => {

            rows.push(
              row.join(" | ")
            );

          });

        }
      );

      text =
        rows.join("\n");

    } catch {

      text = "";

    }

  }

  /* =====================
     CODE FILE
  ===================== */

  else if (
    isCodeFile
  ) {

    try {

      text =
        fs.readFileSync(
          file.path,
          "utf8"
        );

    } catch {

      text = "";

    }

  }

  /* =====================
     IMAGE
  ===================== */

  else if (
    [
      ".png",
      ".jpg",
      ".jpeg",
      ".webp"
    ].includes(ext)
  ) {

    text =
      `Hình ảnh: ${file.originalname}`;

  }

  /* =====================
     FALLBACK
  ===================== */

  if (
    !text ||
    !text.trim()
  ) {

    text =
      `Tên file: ${file.originalname}`;

  }

  text = text
    .replace(/\0/g, "")
    .trim()
    .slice(0, 50000);

  mergedText += `

===== FILE: ${file.originalname} =====

${text}

`;

}

/* =====================
PROMPT AI
===================== */
const totalFiles =
  files.length;

const fileNames =
  files
    .map(f => f.originalname)
    .join(", ");

const finalPrompt =
  prompt?.trim() ||
  [
    "Phân tích project",
    "Tìm bug",
    "Giải thích kiến trúc",
    "Đề xuất cải thiện"
  ].join("\n");

let ask = `

Bạn là senior software engineer và technical architect.

Bạn đang đọc nhiều files trong cùng một project thật.

USER UPLOADED ${totalFiles} FILES.

FILES:
${fileNames}

MỤC TIÊU:
- Hiểu project structure
- Hiểu dependency giữa files
- Tìm root cause thật sự
- Sửa bug chính xác
- Tối ưu code nếu cần
- Giải thích ngắn gọn nhưng hữu ích

NGUYÊN TẮC:
- Không đoán bừa
- Không trả lời chung chung
- Không dump full source code
- Chỉ show phần code cần sửa
- Nếu bug nằm ở file khác, phải nói rõ
- Nếu có nhiều files, phải phân tích nhiều files
- Không được bỏ qua file upload
- Ưu tiên fix thực tế production
- Không thêm emoji trong code
- Không thêm comment kiểu AI
- Không lặp OLD và NEW giống nhau

QUAN TRỌNG:
- Nếu user upload nhiều files:
  PHẢI phân tích tất cả files
- Không được chỉ trả lời 1 file
- Mỗi file phải có section riêng
- Nếu có 2 files trở lên:
  phải trả lời ít nhất 2 sections FILE:
- Không được trả lời quá ngắn

KHI PHÂN TÍCH:
1. Xác định file liên quan
2. Tìm root cause
3. Giải thích impact
4. Đưa patch tối thiểu
5. Nếu cần, đề xuất refactor ngắn

FORMAT TRẢ LỜI:

================================================

FILE: xxx.js

VẤN ĐỀ:
- lỗi gì
- vì sao xảy ra

ẢNH HƯỞNG:
- bug gây gì
- runtime/build/UI issue gì
- liên quan file nào khác

FIX:
- hướng sửa

PATCH:

OLD:
```js
...

NEW:

...

================================================

QUY TẮC PATCH:

OLD và NEW phải khác nhau thật sự
Chỉ show phần thay đổi
Không show full file trừ khi user yêu cầu
Nếu chỉ đổi 1 dòng thì chỉ show 1 dòng
Ưu tiên patch clean và production-ready

QUY TẮC MARKDOWN:

MỌI code bắt buộc phải nằm trong markdown code block
Tuyệt đối không trả raw code
Không được viết code ngoài markdown block
Tất cả snippet đều phải fenced

Ví dụ JavaScript:

const app = express();

Ví dụ HTML:

<!DOCTYPE html>
<html>
<body>
</body>
</html>

Ví dụ CSS:

.container {
  display: flex;
}

YÊU CẦU USER:

${finalPrompt}

FILES:

${mergedText}

`;

/* =====================
ASK AI
===================== */

const userId =
  getUserId(req);

const user =
  await User.findById(
    userId
  );

const answer =
  await askAI({
    prompt: ask,
    mode:
      hasCodeFile
        ? "code"
        : "file",
    plan:
      user?.plan ||
      "free"
  });


/* =====================
SAVE CHAT
===================== */

const newId =
await saveChat(
req,
`📎 ${files.map(f => f.originalname).join(", ")}`,
answer,
chatId
);

/* =====================
DELETE TEMP
===================== */

for (const file of files) {

  if (
    fs.existsSync(file.path)
  ) {

    fs.unlinkSync(file.path);

  }

}

return res.json({
ok:true,
answer,
chatId:newId
});

}catch(err){

console.log(
"UPLOAD FILE ERROR:",
err
);

return res
.status(500)
.json({
error:
err.message ||
"Upload fail"
});

}
}
);

/* =========================
   STATIC
========================= */

router.use(
  "/files",
  express.static(FILE_DIR)
);

router.put(
  "/chat/:id/rename",
  async (req, res) => {
    try {
      const userId =
        getUserId(req);

      if (!userId) {
        return res
          .status(401)
          .json({
            error:
              "Unauthorized"
          });
      }

      const title =
        String(
          req.body.title ||
            ""
        )
          .trim()
          .slice(0, 80);

      const chat =
        await Chat.findById(
          req.params.id
        );

      if (!chat) {
        return res
          .status(404)
          .json({
            error:
              "Chat not found"
          });
      }

      if (
        String(
          chat.userId
        ) !==
        String(userId)
      ) {
        return res
          .status(403)
          .json({
            error:
              "Forbidden"
          });
      }

      chat.title =
        title ||
        "New Chat";

      await chat.save();

      return res.json({
        ok: true
      });

    } catch (err) {
      console.log(
        "RENAME ERROR:",
        err
      );

      return res
        .status(500)
        .json({
          error:
            "rename fail"
        });
    }
  }
);


/* delete chat */
router.delete(
  "/chat/:id",
  async (req, res) => {
    try {
      const userId =
        getUserId(req);

      if (!userId) {
        return res
          .status(401)
          .json({
            error:
              "Unauthorized"
          });
      }

      const chat =
        await Chat.findById(
          req.params.id
        );

      if (!chat) {
        return res
          .status(404)
          .json({
            error:
              "Chat not found"
          });
      }

      if (
        String(
          chat.userId
        ) !==
        String(userId)
      ) {
        return res
          .status(403)
          .json({
            error:
              "Forbidden"
          });
      }

      await Chat.findByIdAndDelete(
        req.params.id
      );

      return res.json({
        ok: true
      });

    } catch (err) {
      console.log(
        "DELETE ERROR:",
        err
      );

      return res
        .status(500)
        .json({
          error:
            "delete fail"
        });
    }
  }
);


router.post(
  "/admin/upgrade/:id/reject",
  async (req, res) => {

    try {

      const payment =
        await Payment.findById(
          req.params.id
        );

      if (!payment) {
        return res
          .status(404)
          .json({
            error:
              "Payment not found"
          });
      }

      payment.status =
        "rejected";

      await payment.save();

      res.json({
        ok: true
      });

    } catch {

      res.status(500).json({
        error:
          "reject fail"
      });

    }

  }
);




// ADMIN APPROVE BILLING

router.post(
  "/admin/upgrade/:id/approve",
  async (req, res) => {

    try {

      const payment =
        await Payment.findById(
          req.params.id
        );

      if (!payment) {
        return res
          .status(404)
          .json({
            error:
              "Payment not found"
          });
      }

      payment.status =
        "approved";

      payment.approvedAt =
        new Date();

      await payment.save();

      const user =
        await User.findById(
          payment.userId
        );

      if (user) {

        user.plan =
          payment.plan ||
          "pro";

        const now =
          new Date();

        const expire =
          new Date(now);

        if (
          payment.plan ===
          "business"
        ) {

          expire.setFullYear(
            expire.getFullYear() + 1
          );

        } else {

          expire.setMonth(
            expire.getMonth() + 1
          );

        }

        user.planExpireAt =
          expire;

        await user.save();
      }

      res.json({
        ok: true
      });

    } catch (e) {

      console.log(e);

      res.status(500).json({
        error:
          "approve fail"
      });

    }

  }
);





router.post("/payment/create", authMiddleware, createPayment);



export default router;
