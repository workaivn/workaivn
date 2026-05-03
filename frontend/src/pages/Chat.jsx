// src/pages/Chat.jsx

import React, { useEffect, useRef, useState } from "react";
import { quickCards } from "../data/quickCards";
import Tools from "./Tools.jsx";
import Sidebar from "../components/Sidebar";
import Composer from "../components/Composer";
import MessageList from "../components/MessageList";

import { apiGet, apiPost } from "../services/api";

export default function Chat({ tab, setTab }) {
const [usage, setUsage] =
  useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState(false);

  const [chats, setChats] = useState([]);
  const [chatId, setChatId] = useState(null);

  const [mode, setMode] = useState("normal");

  const [smartFile, setSmartFile] = useState(null);
  const [pendingFileAction, setPendingFileAction] = useState(null);

  const endRef = useRef(null);
  const chatIdRef = useRef(null);
  const fileInputRef = useRef(null);
  const [
  showPaywall,
  setShowPaywall
] = useState(false);

  const [loadingType, setLoadingType] =
  useState("chat");

  useEffect(() => {
    loadChats();
	loadUsage();
  }, []);

  useEffect(() => {
    chatIdRef.current = chatId;
  }, [chatId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: "smooth"
    });
  }, [messages]);
  
  useEffect(() => {
  if (!usage) return;

  const used =
    usage?.used?.chat || 0;

  const limit =
    usage?.limits
      ?.chatPerDay || 0;

  if (
    usage.plan ===
      "free" &&
    limit > 0 &&
    used >= limit
  ) {
    setShowPaywall(
      true
    );
  }
}, [usage]);

  /* ==================================================
     API
  ================================================== */

  async function loadChats() {
    try {
      const r = await apiGet("/chats");
      const d = await r.json();

      setChats(Array.isArray(d) ? d : []);
    } catch {
      setChats([]);
    }
  }
  
  async function loadUsage() {
  try {
    const r =
      await apiGet("/usage");

    const d =
      await r.json();

    if (
      d.error
    ) {
      setUsage(null);
      return;
    }

    setUsage(d);

  } catch {
    setUsage(null);
  }
}

  async function openChat(id) {
    try {
      const r = await apiGet("/chat/" + id);
      const d = await r.json();

      setChatId(id);
      setMessages(d.messages || []);
    } catch {}
  }

  function newChat() {
    setMessages([]);
    setText("");
    setChatId(null);
    setMode("normal");
    setSmartFile(null);
    setPendingFileAction(null);
  }

  function logout() {
    localStorage.removeItem("token");
    location.reload();
  }

  /* ==================================================
     IMAGE MODE DETECT
  ================================================== */

  function detectImageIntent(prompt = "") {
    const t = prompt.toLowerCase().trim();

    if (t.includes("xóa nền")) return "removebg";

    if (
      t.includes("4x6") ||
      t.includes("ảnh thẻ")
    ) {
      return "passport";
    }

    if (
      t.includes("nâng nét") ||
      t.includes("làm nét")
    ) {
      return "upscale";
    }

    if (
      t.includes("tạo ảnh") ||
      t.includes("vẽ ảnh") ||
      t.includes("ảnh ")
    ) {
      return "create";
    }

    return null;
  }

  /* ==================================================
     CHAT TEXT
  ================================================== */

  async function sendText(
  prompt,
  aiMode = "normal"
) {
  if (!prompt.trim()) return;

  /* PAYWALL CHECK */
  if (
    usage?.plan ===
      "free" &&
    (usage?.used?.chat ||
      0) >=
      (usage?.limits
        ?.chatPerDay ||
        0)
  ) {
    setShowPaywall(
      true
    );
    return;
  }

  const imgTool =
    detectImageIntent(
      prompt
    );

  if (imgTool) {
    await generateImageInChat(
      prompt,
      imgTool
    );

    setText("");
    return;
  }

  const next = [
    ...messages,
    {
      role: "user",
      content: prompt
    }
  ];

  setMessages(next);
  setText("");
  setLoadingType("chat");
  setLoading(true);

  try {
    const r =
      await apiPost(
        "/chat",
        {
          messages: next,
          search,
          mode: aiMode,
          chatId:
            chatIdRef.current
        }
      );

    const reader =
      r.body.getReader();

    const decoder =
      new TextDecoder();

    let ai = "";

    while (true) {
      const {
        done,
        value
      } =
        await reader.read();

      if (done) break;

      ai +=
        decoder.decode(
          value,
          {
            stream:
              true
          }
        );

      setMessages(
        (prev) => {
          const copy = [
            ...prev
          ];

          if (
            copy.at(-1)
              ?.role ===
            "assistant"
          ) {
            copy[
              copy.length -
                1
            ] = {
              role:
                "assistant",
              content:
                ai
            };
          } else {
            copy.push({
              role:
                "assistant",
              content:
                ai
            });
          }

          return copy;
        }
      );
    }

    await loadChats();

  } catch {
    setMessages(
      (prev) => [
        ...prev,
        {
          role:
            "assistant",
          content:
            "Lỗi phản hồi AI."
        }
      ]
    );

  } finally {
    setLoading(false);
    setLoadingType(
      "none"
    );
    await loadUsage();
  }
}

  /* ==================================================
     FILE
  ================================================== */

  function askUpload() {
    fileInputRef.current?.click();
  }

  function pickFile(e) {
    const file = e.target.files?.[0];

    if (!file) return;

    setSmartFile(file);

    if (
      pendingFileAction?.type ===
      "image-chat"
    ) {
      generateImageInChat(
        pendingFileAction.prompt,
        pendingFileAction.tool,
        file
      );

      setPendingFileAction(null);
      return;
    }

    if (
      pendingFileAction?.type ===
      "file-chat"
    ) {
      sendRealFile(
        pendingFileAction.prompt,
        pendingFileAction.mode,
        file
      );

      setPendingFileAction(null);
      return;
    }
  }

  // PATCH FULL function sendRealFile()
// src/pages/Chat.jsx
// THAY TOÀN BỘ function sendRealFile(...) hiện tại bằng bản này

async function sendRealFile(
  prompt,
  fileMode = "file_summary",
  fileObj = null
) {
  const useFile =
    fileObj || smartFile;

  if (!useFile) return;

  setTab("chat");

  const name =
    useFile.name || "file";

  const ext =
    name
      .split(".")
      .pop()
      ?.toLowerCase() || "";

  function getSteps() {
    if (
      ["pdf"].includes(ext)
    ) {
      return [
        "Đang tải file PDF...",
        "Đang đọc cấu trúc tài liệu...",
        "Đang quét trang 1/x...",
        "Đang OCR nội dung scan nếu có...",
        "Đang trích xuất ý chính...",
        "Đang tạo bản tóm tắt..."
      ];
    }

    if (
      [
        "xls",
        "xlsx",
        "csv"
      ].includes(ext)
    ) {
      return [
        "Đang tải file Excel...",
        "Đang đọc workbook...",
        "Đang quét sheet dữ liệu...",
        "Đang phân tích số liệu...",
        "Đang tìm bất thường...",
        "Đang tạo báo cáo..."
      ];
    }

    if (
      [
        "doc",
        "docx"
      ].includes(ext)
    ) {
      return [
        "Đang tải file Word...",
        "Đang đọc nội dung văn bản...",
        "Đang phân tích bố cục...",
        "Đang trích xuất thông tin...",
        "Đang soạn kết quả..."
      ];
    }

    if (
      [
        "js","jsx","ts","tsx",
        "py","java","php",
        "cpp","c","cs","go",
        "html","css","json"
      ].includes(ext)
    ) {
      return [
        "Đang tải source code...",
        "Đang đọc cấu trúc project...",
        "Đang phân tích logic...",
        "Đang tìm lỗi tiềm năng...",
        "Đang tạo giải thích..."
      ];
    }

    return [
      "Đang tải file...",
      "Đang đọc nội dung...",
      "Đang phân tích dữ liệu...",
      "Đang tạo kết quả..."
    ];
  }

  const steps =
    getSteps();

  setMessages((prev) => [
    ...prev,
    {
      role: "user",
      content: `📎 ${name}`
    },
    {
      role: "assistant",
      content: steps[0]
    }
  ]);

  setLoadingType("file");
  setLoading(true);

  let stepIndex = 0;

  const timer =
    setInterval(() => {
      stepIndex++;

      setMessages(
        (prev) => {
          const copy = [
            ...prev
          ];

          if (
            copy.length &&
            copy.at(-1)
              ?.role ===
              "assistant"
          ) {
            copy[
              copy.length - 1
            ] = {
              role:
                "assistant",
              content:
                steps[
                  Math.min(
                    stepIndex,
                    steps.length -
                      1
                  )
                ]
            };
          }

          return copy;
        }
      );
    }, 1300);

  try {
    const fd =
      new FormData();

    fd.append(
      "file",
      useFile
    );

    fd.append(
      "prompt",
      prompt
    );

    fd.append(
      "mode",
      fileMode
    );

    fd.append(
      "chatId",
      chatIdRef.current ||
        ""
    );

    const token =
      localStorage.getItem(
        "token"
      ) || "";

    const API =
      import.meta.env
        .VITE_API_URL ||
      "https://api.workaivn.com/api";

    const r =
      await fetch(
        `${API}/upload-file`,
        {
          method:
            "POST",
          headers: {
            authorization:
              token
          },
          body: fd
        }
      );

    const d =
      await r.json();

    clearInterval(
      timer
    );

    setMessages(
      (prev) => {
        const copy = [
          ...prev
        ];

        copy[
          copy.length - 1
        ] = {
          role:
            "assistant",
          content:
            d.answer ||
            "Không đọc được file."
        };

        return copy;
      }
    );

    if (d.chatId) {
      setChatId(
        d.chatId
      );
    }

    await loadChats();

  } catch {

    clearInterval(
      timer
    );

    setMessages(
      (prev) => {
        const copy = [
          ...prev
        ];

        copy[
          copy.length - 1
        ] = {
          role:
            "assistant",
          content:
            "Lỗi đọc file."
        };

        return copy;
      }
    );

  } finally {
    setLoading(false);
	setLoadingType("none");
	setSmartFile(null);
setPendingFileAction(null);

if (fileInputRef.current) {
  fileInputRef.current.value = "";
}
  }
}
  /* ==================================================
     IMAGE
  ================================================== */

  async function generateImageInChat(
    prompt,
    tool = "create",
    fileObj = null
  ) {
    const useFile =
      fileObj || smartFile || null;

    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: prompt
      },
      {
        role: "assistant",
        content: "Đang tạo ảnh..."
      }
    ]);

    setLoadingType("image");
	setLoading(true);

    try {
      const fd = new FormData();

      fd.append("prompt", prompt);
      fd.append("tool", tool);
      fd.append(
        "chatId",
        chatIdRef.current || ""
      );

      if (useFile) {
        fd.append("file", useFile);
      }

      const token =
        localStorage.getItem(
          "token"
        ) || "";

      const API =
        import.meta.env.VITE_API_URL ||
        "https://api.workaivn.com/api";

      const r = await fetch(
        `${API}/generate-image`,
        {
          method: "POST",
          headers: {
            authorization: token
          },
          body: fd
        }
      );

      const d = await r.json();

      setMessages((prev) => {
        const copy = [...prev];

        copy[copy.length - 1] = {
          role: "assistant",
          content:
            d.imageUrl ||
            "Lỗi tạo ảnh."
        };

        return copy;
      });

      if (d.chatId) {
        setChatId(d.chatId);
      }

      await loadChats();
    } catch {
      setMessages((prev) => {
        const copy = [...prev];

        copy[copy.length - 1] = {
          role: "assistant",
          content: "Lỗi tạo ảnh."
        };

        return copy;
      });
    } finally {
      setLoading(false);
	  setLoadingType("none");
    }
  }

  /* ==================================================
     QUICK ACTIONS
  ================================================== */

  function quickAsk(
    prompt,
    aiMode = "normal"
  ) {
    setMode(aiMode);
    setText(prompt);
  }

  async function runFileCard(
    prompt,
    fileMode = "file_summary"
  ) {
    if (!smartFile) {
      setPendingFileAction({
        type: "file-chat",
        prompt,
        mode: fileMode
      });

      askUpload();
      return;
    }

    await sendRealFile(
      prompt,
      fileMode,
      smartFile
    );
  }

  async function runImageCard(
    prompt
  ) {
    const tool =
      detectImageIntent(prompt) ||
      "create";

    if (
      ["removebg", "upscale", "passport"].includes(
        tool
      ) &&
      !smartFile
    ) {
      setPendingFileAction({
        type: "image-chat",
        prompt,
        tool
      });

      askUpload();
      return;
    }

    await generateImageInChat(
      prompt,
      tool
    );
  }
  

async function runTool(item) {
  const mode =
    item.mode || "normal";

  /* FILE TOOL */
  if (
    mode.startsWith("file")
  ) {
    if (!smartFile) {

  setTab("chat");

  setPendingFileAction({
    type: "file-chat",
    prompt: item.prompt,
    mode
  });

  askUpload();

  return;
}

    await sendRealFile(
      item.prompt,
      mode,
      smartFile
    );

    return;
  }

  /* IMAGE TOOL */
  const imgTool =
    detectImageIntent(
      item.prompt
    );

  if (imgTool) {
    await runImageCard(
      item.prompt
    );
    return;
  }

  /* TEXT TOOL */
  setTab("chat");

  await sendText(
    item.prompt,
    mode
  );
}


  function renderQuickCard(card) {
    const cls =
      card.file ||
      card.mode?.includes("cv")
        ? "quickCard proCard"
        : "quickCard";

    return (
      <button
        key={card.label}
        className={cls}
        onClick={() => {
          if (card.file) {
            runFileCard(
              card.prompt,
              card.mode
            );
            return;
          }

          quickAsk(
            card.prompt,
            card.mode
          );
        }}
      >
        {card.label}
      </button>
    );
  }

  /* ==================================================
     UI
  ================================================== */

  const isEmpty =
    messages.length === 0;

  return (
    <div className="app">
      <input
        hidden
        ref={fileInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.txt"
        onChange={pickFile}
      />

     <Sidebar
  chats={chats}
  openChat={openChat}
  newChat={newChat}
  logout={logout}
  tab={tab}
  setTab={setTab}

  usage={usage}
  refreshUsage={loadUsage}

  refreshChats={loadChats}
  setChats={setChats}
  activeChatId={chatId}
/>

      <main className="main">

  {tab === "tools" ? (

    <Tools
      runTool={runTool}
    />

  ) : isEmpty ? (

    <section className="emptyWrap">

      <div className="heroTitle">
        Bạn muốn làm gì hôm nay?
      </div>

      <div
        style={{
          textAlign:
            "center",
          marginTop:
            "12px",
          color:
            "#64748b"
        }}
      >
        Vào Tool Center để dùng
        các công cụ AI cho
        doanh nghiệp.
      </div>

    </section>

  ) : (

    <>
      <MessageList
  messages={messages}
  loading={
    loading &&
    loadingType === "chat"
  }
/>
{loading &&
 loadingType === "image" && (
  <div className="chatArea">
    <div className="row assistant">
      <div className="bubble assistant typingBubble">
        <div className="msgRole">
          WorkAI
        </div>

        <div>
          Đang tạo ảnh...
        </div>
      </div>
    </div>
  </div>
)}

      <div
        ref={endRef}
      ></div>
    </>

  )}

  {tab !== "tools" && (
    <Composer
      text={text}
      setText={setText}
      search={search}
      setSearch={setSearch}
      loading={loading}
      send={async (
        file
      ) => {
        if (file) {
          await sendRealFile(
            text ||
              "Xem file và hỗ trợ giúp mình",
            "file_summary",
            file
          );

          setText("");

          return true;
        }

        await sendText(
          text,
          mode
        );

        return true;
      }}
    />
  )}

</main>

{showPaywall && (
<div className="paywallWrap">

  <div className="paywallBox">

    <div className="paywallBadge">
      FREE LIMIT REACHED
    </div>

    <h2>
      Bạn đã dùng hết
      lượt chat hôm nay
    </h2>

    <p>
      Nâng cấp Pro để
      tiếp tục dùng AI
      không gián đoạn.
    </p>

    <div className="paywallPrice">
      Chỉ 99.000đ/tháng
    </div>

    <div className="paywallList">
      ✔ 200 chat/ngày<br/>
      ✔ Upload file nhiều hơn<br/>
      ✔ Tạo ảnh nhiều hơn<br/>
      ✔ Ưu tiên AI mạnh hơn
    </div>

   <div className="paywallActions">
  <button
    className="paywallBtn"
    onClick={() => {
      setShowPaywall(false);
      setTab("chat");
      document
        .querySelector(".upgradeBtn")
        ?.click();
    }}
  >
    Nâng cấp ngay
  </button>

  <button
    className="paywallClose"
    onClick={() => setShowPaywall(false)}
  >
    Để sau
  </button>
</div>

  </div>

</div>
)}

    </div>
  );
}
