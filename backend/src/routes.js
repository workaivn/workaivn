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
import {
  chunkText,
  summarizeFile
} from "./services/chunker.js";
import {
  detectIntent
} from "./services/detectIntent.js";
import {
  buildSymbolIndex
} from "./services/buildSymbolIndex.js";
import {
  buildImportGraph
} from "./services/buildImportGraph.js";
import {
  buildCallGraph
} from "./services/buildCallGraph.js";
import {
  parsePatches
} from "./services/parsePatches.js";
import {
  applyPatch
} from "./services/applyPatch.js";
import {
  buildFileMeta
} from "./services/buildFileMeta.js";
import {
  buildFunctionMeta
} from "./services/buildFunctionMeta.js";
import {
  buildFlowMap
} from "./services/buildFlowMap.js";
import {
  retrieveCodeContext
} from "./services/retrieveCodeContext.js";
import {
  runAgentLoop
} from "./agent/runAgentLoop.js";

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
  chatId,
  activeFiles = null
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
	  messages: [],
	  activeFiles:
		activeFiles || []
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
	if (activeFiles) {
	  doc.activeFiles =
		activeFiles;
	}
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

const {prompt,chatId}=req.body;

const existingChat =
  chatId
    ? await Chat.findById(chatId)
    : null;

const hasExistingFiles =

  existingChat?.activeFiles
    ?.length > 0;

if (

  !files.length &&

  !hasExistingFiles

) {

  return res.status(400).json({
    error:"No file"
  });

}

let mergedText = "";
let activeFiles = [];

if (

  existingChat?.activeFiles
    ?.length

) {

  activeFiles =
    existingChat.activeFiles;

}

for (const file of activeFiles) {

  mergedText += `

===== FILE: ${file.name} =====

SUMMARY:
${file.summary || ""}

FULL SOURCE:

${file.content?.slice(0, 12000)}

`;

}
let symbolIndex = [];
let importGraph = {};
let callGraph = {};
let fileMeta = [];
let functionMeta = [];
let flowMap = [];
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
	  .slice(0, 40000);

	/* =====================
	   CHUNK FILE
	===================== */

	const chunks =
	  chunkText(
		text,
		file.originalname
	  );

	/* =====================
	   SAVE ACTIVE FILE
	===================== */

	const existingIndex =
	  activeFiles.findIndex(
		x =>
		  x.name ===
		  file.originalname
	  );

	const newFile = {

	  name:
		file.originalname,

	  path:
		file.originalname,

	  type: ext,

	  content: text,

	  summary:
		summarizeFile(
		  file.originalname,
		  text
		),

	  chunks

	};

	if (
	  existingIndex >= 0
	) {

	  activeFiles[
		existingIndex
	  ] = newFile;

	} else {

	  activeFiles.push(
		newFile
	  );

	}

	/* =====================
	   RETRIEVAL
	===================== */

	const latestUserMsg =

	  (
		prompt ||
		""
	  )
	  .toLowerCase();

	const matchedChunks =

	  chunks.filter(c => {

		const haystack = `

	${c.name || ""}
	${c.type || ""}
	${c.content || ""}

	`
		  .toLowerCase();

		return latestUserMsg
		  .split(/\s+/)
		  .some(k =>

			k.length > 2 &&

			haystack.includes(k)

		  );

	  });

	/* =====================
	   BUILD PROMPT TEXT
	===================== */

	mergedText += `

	===== FILE: ${file.originalname} =====

	SUMMARY:
	${summarizeFile(
	  file.originalname,
	  text
	)}

	FULL SOURCE:

	${file.content?.slice(0, 12000)}

	`;
}

symbolIndex =
  buildSymbolIndex(
    activeFiles
  );
  
importGraph =
  buildImportGraph(
    activeFiles
  );
  
  console.log(
  "IMPORT GRAPH:",
  JSON.stringify(
    importGraph,
    null,
    2
  )
);
  
callGraph =
  buildCallGraph(
    activeFiles
  );
fileMeta =
  buildFileMeta(
    activeFiles
  );
functionMeta =
  buildFunctionMeta(
    activeFiles
  );
flowMap =
  buildFlowMap(
    activeFiles
  );
const codeContext =
  retrieveCodeContext({
    query:
      prompt || "",
    symbolIndex,
    callGraph,
    activeFiles
  });  

 console.log(
  "CALL GRAPH:",
  JSON.stringify(
    callGraph,
    null,
    2
  )
);
/* =====================
PROMPT AI
===================== */
const totalFiles =
  activeFiles.length;

const fileNames =
  activeFiles
    .map(f => f.name)
    .join(", ");

const finalPrompt =
  prompt?.trim() ||
  [
    "Phân tích project",
    "Tìm bug",
    "Giải thích kiến trúc",
    "Đề xuất cải thiện"
  ].join("\n");
	
let responseFormat = `

KHI PHÂN TÍCH CODE:

Ưu tiên source code thật.

Không trả lời generic.

Không trả lời lý thuyết.

Nếu xác định được vị trí:

Trả lời theo format:

# ROOT CAUSE

...

# FILE LIÊN QUAN

- file A
- file B

# FUNCTION LIÊN QUAN

- fnA()
- fnB()

# CẦN SỬA

File:
...

Tìm:

\`\`\`
...
\`\`\`

Thay bằng:

\`\`\`
...
\`\`\`

Nếu cần tạo file mới:

# FILE MỚI

path/file.js

Nội dung:

\`\`\`
...
\`\`\`

Nếu cần import:

# IMPORT

File:

...

Thêm:

\`\`\`
import ...
\`\`\`

KHÔNG ĐƯỢC:

- nói chung chung
- nói "có thể"
- nói "hãy thử"
- nói giáo trình

`;

let ask = `

Bạn là senior software engineer và technical architect.
LUÔN trả lời bằng tiếng Việt.
Chỉ dùng tiếng Anh cho code, function name hoặc technical keyword cần thiết.
Không được trả lời full English.

Bạn đang đọc nhiều files trong cùng một project thật.

USER UPLOADED ${totalFiles} FILES.

FILES:
${fileNames}

Bạn là senior software engineer.

MATCHED FUNCTIONS:

${JSON.stringify(
  symbolIndex
    .filter(s => {

      const q =
        finalPrompt.toLowerCase();

      return (

        q.includes(
          s.symbol?.toLowerCase?.() || ""
        )

        ||

        s.symbol
          ?.toLowerCase?.()
          ?.includes(q)

      );

    })
    .slice(0, 100),
  null,
  2
)}

Bạn đang đọc source code thật do user upload.

Nguyên tắc:

- Chỉ dùng thông tin có trong source code
- Không đoán nếu chưa thấy code
- Ưu tiên root cause
- Ưu tiên câu trả lời trực tiếp
- Nếu tìm thấy function:
  nói rõ file và function
- Nếu user yêu cầu sửa:
  đề xuất cách sửa phù hợp
- Nếu chưa đủ dữ liệu:
  nói rõ file cần thêm

Trả lời tự nhiên như một senior engineer.

${responseFormat}

YÊU CẦU USER:

${finalPrompt}

TOP MATCHED SYMBOLS:

${JSON.stringify(
  symbolIndex
    .filter(s => {
      const q =
        finalPrompt.toLowerCase();

      return (
        s.symbol?.toLowerCase()?.includes(q) ||
        q.includes(
          s.symbol?.toLowerCase?.() || ""
        )
      );
    })
    .slice(0, 50),
  null,
  2
)}

MATCHED SYMBOLS:

${JSON.stringify(
  codeContext
    .matchedSymbols
    .slice(0,20),
  null,
  2
)}

MATCHED FUNCTIONS:

${JSON.stringify(
  codeContext
    .matchedFunctions
    .slice(0,20),
  null,
  2
)}

RELATED FUNCTIONS:

${JSON.stringify(
  codeContext
    .relatedFunctions,
  null,
  2
)}

FILES:

${mergedText}

`;

/* LIMIT PROMPT */

if (ask.length > 60000) {

  ask =
    ask.slice(0, 60000);

}

console.log(
  "PROMPT LENGTH:",
  ask.length
);

/* =====================
ASK AI
===================== */

const userId =
  getUserId(req);

const user =
  await User.findById(
    userId
  );

let answer = "";

try {

  console.log(
    "PROMPT LENGTH:",
    ask.length
  );
const lowerPrompt =
  finalPrompt
    .toLowerCase();

res.writeHead(200, {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive"
});

const sendEvent = (data) => {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};

try {
  let completeAnswer = "";

  // Gọi askAI với tham số truyền vào là callback onToken
  answer = await askAI({
    messages: [
      {
        role: "user",
        content: ask
      }
    ],
    mode: "file",
    plan: user?.plan || "free",
    onToken: (token) => {
      completeAnswer += token;
      // Phát sự kiện token đơn lẻ về frontend ngay khi nhận được
      sendEvent({
        type: "token",
        content: token
      });
    }
  });

  // Gán lại câu trả lời cuối cùng để lưu DB phía dưới
  answer = completeAnswer;

  // Gửi duy nhất một event báo done
  const uploadedFilesText =
  files
    .map(f => f.originalname)
    .join(", ");

const userMessageText =
  prompt?.trim()

    ? `${prompt.trim()}

📎 ${uploadedFilesText}`

    : `📎 ${uploadedFilesText}`;

const mergedMap =
  new Map();

(existingChat?.activeFiles || [])
.forEach((f) => {
  mergedMap.set(f.name, f);
});

activeFiles.forEach((f) => {
  mergedMap.set(f.name, f);
});

const newId =
  await saveChat(

    req,

    userMessageText,

    answer,

    chatId,

    Array.from(
      mergedMap.values()
    ).slice(-30)

  );

sendEvent({
  type: "done",
  final: answer,
  chatId: newId
});

} catch (err) {
  console.log("STREAM ERROR:", err);
  sendEvent({
    type: "error",
    error: err.message || "Stream fail"
  });
} finally {
  if (!res.writableEnded) {
    res.end();
  }
}

return;

  /* =========================
     VALIDATE ANSWER
  ========================= */

  if (
    typeof answer !== "string"
  ) {

    console.log(
      "INVALID ANSWER:",
      answer
    );

    answer =
      JSON.stringify(
        answer,
        null,
        2
      );

  }

  if (
    !answer ||
    !String(answer).trim()
  ) {

    answer =
      "AI không trả về nội dung.";

  }

  /* =========================
     PARSE PATCHES
  ========================= */

  const patches =
    parsePatches(
      answer
    );
	
	console.log(
    "PATCHES:",
    JSON.stringify(
      patches,
      null,
      2
    )
  );

} catch (err) {

  console.log(
    "ASK AI ERROR:",
    err
  );

  answer =
    "AI đọc file quá tải. Hãy thử ít file hơn hoặc file nhỏ hơn.";

}
}catch(err){

console.log(
"UPLOAD FILE ERROR:",
err
);

if (!res.writableEnded) {

  res.write(
    `data: ${JSON.stringify({
      type: "error",
      error:
        err.message ||
        "Upload fail"
    })}\n\n`
  );

  res.end();
}

return;

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
          .slice(0, 50);

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

/* =========================
   APPLY PATCH
========================= */

router.post(
  "/apply-patches",
  async (req, res) => {

    try {

      const {
        patches = []
      } = req.body;

      if (
        !Array.isArray(
          patches
        )
      ) {

        return res
          .status(400)
          .json({
            error:
              "Invalid patches"
          });

      }

      const results = [];

      for (const p of patches) {

        const result =
          applyPatch(

            p.file,

            p.find,

            p.replace

          );

        results.push({

          file:
            p.file,

          ...result

        });

      }

      return res.json({

        ok: true,

        results

      });

    } catch (err) {

      console.log(
        "APPLY PATCH ERROR:",
        err
      );

      return res
        .status(500)
        .json({
          error:
            "Apply patch fail"
        });

    }

  }
);

export default router;
