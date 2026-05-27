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
  plan = "free"
}) {
  console.log("=== AI ROUTER ===", mode, plan);

  // 🔥 PRO USER → OpenAI trước
  if (plan !== "free") {
    try {
      const r =
		  await askOpenAI(
			messages,
			mode
		  );
      if (r) return r;
    } catch (e) {
      console.log("OPENAI FAIL:", e.message);
    }
  }

  // 🔥 FREE → Gemini
  try {
    const r =
	  await askGemini(
		messages,
		mode
	  );
    if (r) return r;
  } catch (e) {
    console.log("GEMINI FAIL:", e.message);
  }

  // 🔥 fallback → Groq
  try {
    const r =
	  await askGroq(
		messages,
		mode
	  );
    if (r) return r;
  } catch (e) {
    console.log("GROQ FAIL:", e.message);
  }

  // 🔥 cuối cùng thử lại OpenAI
  try {
    const r =
	  await askOpenAI(
		messages,
		mode
	  );
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
Bạn là senior software engineer
và code reviewer chuyên nghiệp.

NHIỆM VỤ:
- Đọc và hiểu code thật
- Tìm root cause chính xác
- Ưu tiên minimal patch
- Giữ nguyên architecture hiện có
- Ưu tiên fix production-ready
- Không phá code cũ đang chạy

QUY TẮC:
- Không dump full file nếu không cần
- Chỉ show phần code cần sửa
- Ưu tiên OLD / NEW patch
- Giải thích ngắn gọn nhưng chính xác
- Không hallucinate
- Không bịa lỗi không tồn tại
- Không rewrite toàn bộ project

KHI USER YÊU CẦU:
- Nếu user muốn FULL FILE:
  trả full file hoàn chỉnh
- Nếu user muốn fix bug:
  chỉ trả minimal patch
- Nếu user upload nhiều files:
  phải phân tích dependency giữa files

FORMAT:
1. ROOT CAUSE
2. IMPACT
3. FIX
4. PATCH
`;
  }
  
  if (mode === "agent") {
  return `
You are WorkAI Agent.

AVAILABLE TOOLS:

- READ_FILE
- WRITE_FILE
- LIST_FILES
- SEARCH_CODE
- RUN_TERMINAL

MISSION:

- Solve coding tasks step-by-step
- Use tools when needed
- Read files before editing
- Never invent code
- Use minimal edits
- Reflect on errors
- If build fails:
  fix and retry

IMPORTANT:

Return ONLY valid JSON.

TOOL FORMAT:

{
  "tool": "READ_FILE",
  "args": {
    "path": "src/App.jsx"
  }
}

DONE FORMAT:

{
  "done": true,
  "final": "Task completed"
}

RULES:

- No markdown
- No explanation
- No extra text
- JSON only
`;
}

  if (mode === "file") {
    return `
Bạn là senior software engineer
và code reviewer chuyên nghiệp.

NHIỆM VỤ:
- Đọc nhiều files thật
- Hiểu dependency giữa files
- Tìm root cause chính xác
- Không đoán bừa
- Không phân tích generic
- Không nhắc lỗi không tồn tại
- Chỉ kết luận khi thấy code thật

KHI FIX BUG:
- Ưu tiên root cause
- Ưu tiên minimal patch
- Chỉ show phần code cần sửa
- Giải thích ngắn gọn

KHI REVIEW:
- Phải đọc kỹ code upload
- Không hallucinate
- Không bịa lỗi giả
`;
  }

  return `
Bạn là WorkAI VN.

Trợ lý AI thông minh dành cho người Việt.

PHONG CÁCH:
- Trả lời tự nhiên, hữu ích
- Rõ ràng, thực tế
- Ưu tiên đúng trọng tâm
- Không lan man
- Không trả lời giáo trình
- Không lặp ý
- Không dùng văn phong robot

KHI GIẢI THÍCH:
- Ưu tiên ví dụ thực tế
- Giải thích dễ hiểu
- Chia ý rõ ràng
- Có thể dùng bullet points

KHI HỎI KỸ THUẬT:
- Ưu tiên root cause
- Không đoán bừa
- Không bịa API/thư viện
- Ưu tiên giải pháp production-ready

KHI USER HỎI NGẮN:
- Hiểu ngữ cảnh cuộc trò chuyện
- Follow-up thông minh
- Không bắt user lặp lại thông tin

MỤC TIÊU:
- Giúp user làm việc nhanh hơn
- Giống trợ lý thật sự
- Không giống chatbot giáo trình
`;
}

/* =========================
   OPENAI (BEST)
========================= */

async function askOpenAI(messages, mode) {
  const system = getSystemPrompt(mode);

  const finalMessages = [
    {
      role: "system",
      content: system
    },

    ...messages
  ];

  const r =
	  await openai.chat.completions.create({
		model: "gpt-4o-mini",

		messages: finalMessages,

		max_tokens: 8000,
		temperature: 0.7
	  });

  return (
    r?.choices?.[0]
      ?.message?.content || ""
  );
}


export async function askOpenAIStream({
  messages = [],
  mode = "chat",
  onToken = () => {}
}) {

  const system =
    getSystemPrompt(mode);

  const finalMessages = [
    {
      role: "system",
      content: system
    },
    ...messages
  ];

  const stream =
    await openai.chat.completions.create({

      model: "gpt-4o-mini",

      messages: finalMessages,

      temperature: 0.7,

      stream: true

    });

  let full = "";

  for await (const chunk of stream) {

    const token =
      chunk
        ?.choices?.[0]
        ?.delta?.content || "";

    if (!token) {
      continue;
    }

    full += token;

    onToken(full);
  }

  return full;
}


/* =========================
   GEMINI
========================= */

async function askGemini(
  messages,
  mode
) {

  const model =
    gemini.getGenerativeModel({
      model: "gemini-2.0-flash"
    });

  const system =
    getSystemPrompt(mode);

  const history =
    messages
      .slice(0, -1)
      .map((m) => ({

        role:
          m.role === "assistant"
            ? "model"
            : "user",

        parts: [
          {
            text:
              m.content || ""
          }
        ]

      }));

  const chat =
    model.startChat({

      history: [

        {
          role: "user",

          parts: [
            {
              text: system
            }
          ]
        },

        ...history

      ]

    });

  const lastMessage =
    messages[
      messages.length - 1
    ];

  const r =
    await chat.sendMessage(
      lastMessage?.content || ""
    );

  return (
    r?.response?.text() || ""
  );
}

/* =========================
   GROQ
========================= */

async function askGroq(
	  messages,
	  mode
	) {
  const models = [
    "llama-3.1-8b-instant"
  ];

  const system =
	  getSystemPrompt(mode);

	const finalMessages = [

	  {
		role: "system",
		content: system
	  },

	  ...messages

	];

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
            messages: finalMessages,
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
