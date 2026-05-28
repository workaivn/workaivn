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
  messages = [],
  mode = "chat",
  plan = "free",
  onToken = null
}) {
  console.log("=== AI ROUTER ===", mode, plan, onToken ? "STREAM MODE" : "NORMAL MODE");

  // 🔥 PRO USER hoặc khi có yêu cầu STREAM -> Chạy qua OpenAI Stream để đồng bộ
  if (plan !== "free" || onToken) {
    try {
      if (onToken) {
        return await askOpenAIStream({ messages, mode, onToken });
      } else {
        const r = await askOpenAI(messages, mode);
        if (r) return r;
      }
    } catch (e) {
      console.log("OPENAI STREAM/NORMAL FAIL:", e.message);
    }
  }

  // 🔥 FREE & NORMAL MODE -> Gemini
  try {
    const r = await askGemini(messages, mode);
    if (r) return r;
  } catch (e) {
    console.log("GEMINI FAIL:", e.message);
  }

  // 🔥 Fallback -> Groq
  try {
    const r = await askGroq(messages, mode);
    if (r) return r;
  } catch (e) {
    console.log("GROQ FAIL:", e.message);
  }

  return "Hệ thống AI đang bận, thử lại sau.";
}

/* =========================
   SYSTEM PROMPT
========================= */

function getSystemPrompt(mode) {
  if (mode === "code") {
    return `Bạn là senior software engineer và code reviewer chuyên nghiệp.\n\nNHIỆM VỤ:\n- Đọc và hiểu code thật\n- Tìm root cause chính xác\n- Ưu tiên minimal patch\n- Giữ nguyên architecture hiện có\n- Ưu tiên fix production-ready\n- Không phá code cũ đang chạy\n\nQUY TẮC:\n- Không dump full file nếu không cần\n- Chỉ show phần code cần sửa\n- Ưu tiên OLD / NEW patch\n- Giải thích ngắn gọn nhưng chính xác\n- Không hallucinate\n- Không bịa lỗi không tồn tại\n- Không rewrite toàn bộ project\n\nKHI USER YÊU CẦU:\n- Nếu user muốn FULL FILE:\n  trả full file hoàn chỉnh\n- Nếu user muốn fix bug:\n  Chỉ trả minimal patch\n- Nếu user upload nhiều files:\n  phải phân tích dependency giữa files\n\nFORMAT:\n1. ROOT CAUSE\n2. IMPACT\n3. FIX\n4. PATCH`;
  }
  
  if (mode === "agent") {
    return `You are WorkAI Agent.\n\nAVAILABLE TOOLS:\n- READ_FILE\n- WRITE_FILE\n- LIST_FILES\n- SEARCH_CODE\n- RUN_TERMINAL\n\nMISSION:\n- Solve coding tasks step-by-step\n- Use tools when needed\n- Read files before editing\n- Never invent code\n- Use minimal edits\n- Reflect on errors\n- If build fails:\n  fix and retry\n\nIMPORTANT:\nReturn ONLY valid JSON.\n\nTOOL FORMAT:\n{\n  "tool": "READ_FILE",\n  "args": {\n    "path": "src/App.jsx"\n  }\n}\n\nDONE FORMAT:\n{\n  "done": true,\n  "final": "Task completed"\n}\n\nRULES:\n- No markdown\n- No explanation\n- No extra text\n- JSON only`;
  }

  if (mode === "file") {
    return `Bạn là senior software engineer và code reviewer chuyên nghiệp.\n\nNHIỆM VỤ:\n- Đọc nhiều files thật\n- Hiểu dependency giữa files\n- Tìm root cause chính xác\n- Không đoán bừa\n- Không phân tích generic\n- Không nhắc lỗi không tồn tại\n- Chỉ kết luận khi thấy code thật\n\nKHI FIX BUG:\n- Ưu tiên root cause\n- Ưu tiên minimal patch\n- Chỉ show phần code cần sửa\n- Giải thích ngắn gọn\n\nKHI REVIEW:\n- Phải đọc kỹ code upload\n- Không hallucinate\n- Không bịa lỗi giả`;
  }

  return `Bạn là WorkAI VN.\nTrợ lý AI thông minh dành cho người Việt.\n\nPHONG CÁCH:\n- Trả lời tự nhiên, hữu ích\n- Rõ ràng, thực tế\n- Ưu tiên đúng trọng tâm\n- Không lan man\n- Không trả lời giáo trình\n- Không lặp ý\n- Không dùng văn phong robot\n\nKHI GIẢI THÍCH:\n- Ưu tiên ví dụ thực tế\n- Giải thích dễ hiểu\n- Chia ý rõ ràng\n- Có thể dùng bullet points\n\nKHI HỎI KỸ THUẬT:\n- Ưu tiên root cause\n- Không đoán bừa\n- Không bịa API/thư viện\n- Ưu tiên giải pháp production-ready\n\nKHI USER HỎI NGẮN:\n- Hiểu ngữ cảnh cuộc trò chuyện\n- Follow-up thông minh\n- Không bắt user lặp lại thông tin\n\nMỤC TIÊU:\n- Giúp user làm việc nhanh hơn\n- Giống trợ lý thật sự\n- Không giống chatbot giáo trình`;
}

/* =========================
   OPENAI
========================= */

async function askOpenAI(messages, mode) {
  const system = getSystemPrompt(mode);
  const finalMessages = [{ role: "system", content: system }, ...messages];

  const r = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: finalMessages,
    max_tokens: 8000,
    temperature: 0.7
  });

  return r?.choices?.[0]?.message?.content || "";
}

export async function askOpenAIStream({
  messages = [],
  mode = "chat",
  onToken = () => {}
}) {
  const system = getSystemPrompt(mode);
  const finalMessages = [{ role: "system", content: system }, ...messages];

  const stream = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: finalMessages,
    temperature: 0.7,
    stream: true
  });

  let full = "";
  for await (const chunk of stream) {
    const token = chunk?.choices?.[0]?.delta?.content || "";
    if (!token) continue;

    full += token;
    // FIX TẬN GỐC: Chỉ bắn token đơn lẻ ra ngoài
    onToken(token); 
  }

  return full;
}

/* =========================
   GEMINI
========================= */

async function askGemini(messages, mode) {
  const model = gemini.getGenerativeModel({ model: "gemini-2.0-flash" });
  const system = getSystemPrompt(mode);

  const history = messages.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content || "" }]
  }));

  const chat = model.startChat({
    history: [{ role: "user", parts: [{ text: system }] }, ...history]
  });

  const lastMessage = messages[messages.length - 1];
  const r = await chat.sendMessage(lastMessage?.content || "");

  return r?.response?.text() || "";
}

/* =========================
   GROQ
========================= */

async function askGroq(messages, mode) {
  const models = ["llama-3.1-8b-instant"];
  const system = getSystemPrompt(mode);
  const finalMessages = [{ role: "system", content: system }, ...messages];

  for (const model of models) {
    try {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + process.env.GROQ_API_KEY
        },
        body: JSON.stringify({ model, messages: finalMessages, max_tokens: 8000 })
      });

      const d = await r.json();
      if (d?.choices?.[0]?.message?.content) {
        return d.choices[0].message.content;
      }
    } catch {}
  }
  throw new Error("Groq failed");
}