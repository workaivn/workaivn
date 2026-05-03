// backend/src/services/aiRouter.js
// TẠO FILE MỚI

import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

const openai =
  new OpenAI({
    apiKey:
      process.env.OPENAI_API_KEY
  });

const gemini =
  new GoogleGenerativeAI(
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
  try {
    /* FREE PLAN */
    if (plan === "free") {
      return await askGroq(
        prompt
      );
    }

    /* FILE / SUMMARY */
    if (
      mode === "summary" ||
      mode === "file"
    ) {
      return await askGemini(
        prompt
      );
    }

    /* PRO DEFAULT */
    return await askOpenAI(
      prompt
    );

  } catch (err) {
    /* fallback */
    try {
      return await askGemini(
        prompt
      );
    } catch {
      return await askOpenAI(
        prompt
      );
    }
  }
}

/* =========================
   OPENAI
========================= */

async function askOpenAI(
  prompt
) {
  const r =
    await openai.chat.completions.create(
      {
        model:
          "gpt-4o-mini",
        messages: [
          {
            role:
              "user",
            content:
              prompt
          }
        ]
      }
    );

  return (
    r.choices?.[0]
      ?.message
      ?.content ||
    "Không có phản hồi."
  );
}

/* =========================
   GEMINI
========================= */

async function askGemini(
  prompt
) {
  const model =
    gemini.getGenerativeModel(
      {
        model:
          "gemini-1.5-flash"
      }
    );

  const r =
    await model.generateContent(
      prompt
    );

  return (
    r.response.text() ||
    "Không có phản hồi."
  );
}

/* =========================
   GROQ
========================= */

async function askGroq(
  prompt
) {
  const r =
    await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method:
          "POST",
        headers: {
          "Content-Type":
            "application/json",
          Authorization:
            "Bearer " +
            process.env
              .GROQ_API_KEY
        },
        body: JSON.stringify(
          {
            model:
              "llama3-8b-8192",
            messages: [
              {
                role:
                  "user",
                content:
                  prompt
              }
            ]
          }
        )
      }
    );

  const d =
    await r.json();
console.log("GROQ RAW:", d);   // 👈 thêm dòng này
  return (
    d.choices?.[0]
      ?.message
      ?.content ||
    "Không có phản hồi."
  );
}
