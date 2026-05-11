import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

/* =========================
   INIT
========================= */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const gemini = new GoogleGenerativeAI(
  process.env.GEMINI_API_KEY
);

/* =========================
   MAIN ROUTER
========================= */

export async function askAI({
  prompt = "",
  mode = "chat",
  plan = "free"
}) {
  console.log("=== AI ROUTER ===", mode, plan);

  // 🔥 PRO USER → OpenAI trước
  if (plan !== "free") {
    try {
      const r = await askOpenAI(prompt, mode);
      if (r) return r;
    } catch (e) {
      console.log("OPENAI FAIL:", e.message);
    }
  }

  // 🔥 FREE → Gemini
  try {
    const r = await askGemini(prompt, mode);
    if (r) return r;
  } catch (e) {
    console.log("GEMINI FAIL:", e.message);
  }

  // 🔥 fallback → Groq
  try {
    const r = await askGroq(prompt, mode);
    if (r) return r;
  } catch (e) {
    console.log("GROQ FAIL:", e.message);
  }

  // 🔥 cuối cùng thử lại OpenAI
  try {
    const r = await askOpenAI(prompt, mode);
    if (r) return r;
  } catch (e) {
    console.log("OPENAI FINAL FAIL:", e.message);
  }

  return "Hệ thống AI đang bận, thử lại sau.";
}

/* =========================
   SYSTEM PROMPT
========================= */

function getSystemPrompt(mode) {
  if (mode === "code") {
    return `
Bạn là senior software engineer.

YÊU CẦU:
- Trả về FULL CODE
- Không giải thích
- Không cắt bớt
- Code chạy được ngay
`;
  }

  if (mode === "file") {
    return `
Bạn là AI phân tích tài liệu.

- Trả lời rõ ràng
- Có cấu trúc
- Không quá ngắn
`;
  }

  return `
Bạn là trợ lý AI thông minh cho người Việt.

- Trả lời rõ ràng
- Đầy đủ
- Không lan man
`;
}

/* =========================
   OPENAI (BEST)
========================= */

async function askOpenAI(prompt, mode) {
  const system = getSystemPrompt(mode);

  const r = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt }
    ],
    max_tokens: 8000,     // 🔥 FIX NGẮN
    temperature: 0.7
  });

  return r?.choices?.[0]?.message?.content || "";
}

/* =========================
   GEMINI
========================= */

async function askGemini(prompt, mode) {
  const model = gemini.getGenerativeModel({
    model: "gemini-1.5-flash"
  });

  const fullPrompt =
    getSystemPrompt(mode) + "\n\n" + prompt;

  const r = await model.generateContent(fullPrompt);

  return r?.response?.text() || "";
}

/* =========================
   GROQ
========================= */

async function askGroq(prompt, mode) {
  const models = [
    "llama-3.1-8b-instant"
  ];

  const fullPrompt =
    getSystemPrompt(mode) + "\n\n" + prompt;

  for (const model of models) {
    try {
      const r = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization:
              "Bearer " + process.env.GROQ_API_KEY
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "user",
                content: fullPrompt
              }
            ],
            max_tokens: 8000
          })
        }
      );

      const d = await r.json();

      if (d?.choices?.[0]?.message?.content) {
        return d.choices[0].message.content;
      }

    } catch {}
  }

  throw new Error("Groq failed");
}