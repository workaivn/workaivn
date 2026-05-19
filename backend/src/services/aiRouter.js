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

  return r?.choices?.[0]?.message?.content || "";
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
      model: "gemini-1.5-flash"
    });

  const system =
    getSystemPrompt(mode);

  const history =
    messages.map((m) => {

      return {

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

      };

    });

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
