// backend/src/services/aiRouter.js

import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

/* =========================
   INIT CLIENTS
========================= */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const gemini = new GoogleGenerativeAI(
  process.env.GEMINI_API_KEY
);

/* =========================
   MAIN ROUTER (PRODUCTION)
========================= */

export async function askAI({
  prompt = "",
  mode = "chat",
  plan = "free"
}) {
  console.log("=== AI ROUTER START ===");
  console.log("PLAN:", plan);

  // 🔥 1. GROQ (ưu tiên free & nhanh)
  try {
    const r = await askGroq(prompt);
    if (r) {
      console.log("✅ GROQ OK");
      return r;
    }
  } catch (e) {
    console.log("❌ GROQ FAIL:", e.message);
  }

  // 🔥 2. GEMINI
  try {
    const r = await askGemini(prompt);
    if (r) {
      console.log("✅ GEMINI OK");
      return r;
    }
  } catch (e) {
    console.log("❌ GEMINI FAIL:", e.message);
  }

  // 🔥 3. OPENAI (fallback cuối)
  try {
    const r = await askOpenAI(prompt);
    if (r) {
      console.log("✅ OPENAI OK");
      return r;
    }
  } catch (e) {
    console.log("❌ OPENAI FAIL:", e.message);
  }

  return "Hệ thống AI đang quá tải, thử lại sau.";
}

/* =========================
   OPENAI
========================= */

async function askOpenAI(prompt) {
  try {
    const r = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }]
    });

    return r?.choices?.[0]?.message?.content || "";

  } catch (err) {
    console.log("OPENAI ERROR:", err.message);
    throw err;
  }
}

/* =========================
   GEMINI
========================= */

async function askGemini(prompt) {
  try {
    const model = gemini.getGenerativeModel({
      model: "gemini-1.5-flash"
    });

    const r = await model.generateContent(prompt);

    return r?.response?.text() || "";

  } catch (err) {
    console.log("GEMINI ERROR:", err.message);
    throw err;
  }
}

/* =========================
   GROQ (MULTI MODEL SAFE)
========================= */

async function askGroq(prompt) {
  const models = [
    "llama-3.1-8b-instant",
    "llama-3.1-70b-versatile"
  ];

  for (const model of models) {
    try {
      console.log("👉 Trying Groq:", model);

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
            messages: [{ role: "user", content: prompt }]
          })
        }
      );

      const d = await r.json();

      console.log("GROQ RAW:", d);

      if (d?.choices?.[0]?.message?.content) {
        return d.choices[0].message.content;
      }

    } catch (err) {
      console.log("❌ Groq model fail:", model, err.message);
    }
  }

  throw new Error("Groq failed all models");
}
