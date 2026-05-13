// src/pages/Chat.jsx

import React, { useEffect, useRef, useState } from "react";
import { quickCards } from "../data/quickCards";
import Tools from "./Tools.jsx";
import Sidebar from "../components/Sidebar";
import Composer from "../components/Composer";
import MessageList from "../components/MessageList";
import { apiGet, apiPost } from "../services/api";

export default function Chat({ tab, setTab }) {

  const [paywallDismissed, setPaywallDismissed] = useState(false);
  const [usage, setUsage] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState(false);

  const [chats, setChats] = useState([]);
  const [chatId, setChatId] = useState(null);

  const [mode, setMode] = useState("normal");

  const [smartFiles, setSmartFiles] = useState([]);
  const [pendingFileAction, setPendingFileAction] = useState(null);

  const endRef = useRef(null);
  const chatIdRef = useRef(null);
  const fileInputRef = useRef(null);

  const [showPaywall, setShowPaywall] = useState(false);
  const [loadingType, setLoadingType] = useState("chat");

  useEffect(() => {
    loadChats();
    loadUsage();
  }, []);

  useEffect(() => {
    chatIdRef.current = chatId;
  }, [chatId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!usage || paywallDismissed) return;

    const used = usage?.used?.chat || 0;
    const limit = usage?.limits?.chatPerDay || 0;

    if (usage.plan === "free" && limit > 0 && used >= limit) {
      setShowPaywall(true);
    }
  }, [usage, paywallDismissed]);

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
      const r = await apiGet("/usage");
      const d = await r.json();
      if (d.error) return setUsage(null);
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
    setSmartFiles([]);
    setPendingFileAction(null);
  }

  function logout() {
    localStorage.removeItem("token");
    location.reload();
  }

/* CODE MODE */

 function detectMode(text = "") {
    const t = text.toLowerCase();

    if (
      t.includes("code") ||
      t.includes("fix") ||
      t.includes("lỗi") ||
      t.includes("bug") ||
      t.includes("debug") ||
      t.includes("function") ||
      t.includes("api") ||
      t.includes("react") ||
      t.includes("node") ||
      t.includes("javascript") ||
      t.includes("python")
    ) {
      return "code";
    }

    return "normal";
  }

  function detectImageIntent(prompt = "") {
    const t = prompt.toLowerCase().trim();

    if (t.includes("xóa nền")) return "removebg";
    if (t.includes("4x6") || t.includes("ảnh thẻ")) return "passport";
    if (t.includes("nâng nét") || t.includes("làm nét")) return "upscale";
    if (t.includes("tạo ảnh") || t.includes("vẽ ảnh") || t.includes("ảnh "))
      return "create";

    return null;
  }

  /* ==================================================
     CHAT TEXT
  ================================================== */

  async function sendText(prompt) {

	  const cleanPrompt =
		String(prompt || "").trim();

	  if (!cleanPrompt) return;

	  if (
		usage?.plan === "free" &&
		(usage?.used?.chat || 0) >=
		(usage?.limits?.chatPerDay || 0)
	  ) {
		if (!paywallDismissed) {
		  setShowPaywall(true);
		}

		return;
	  }

	  /* =====================================
		 CLEAR INPUT NGAY
	  ===================================== */

	  setText("");

	  const userMessage = {
		role: "user",
		content: cleanPrompt
	  };

	  /* render ngay bubble user */

	  setMessages(prev => [
		...prev,
		userMessage
	  ]);

	  setLoading(true);
	  setLoadingType("chat");

	  try {

		const autoMode =
		  detectMode(cleanPrompt);

		/* IMPORTANT:
		   dùng latest messages
		*/

		const nextMessages = [
		  ...messages,
		  userMessage
		];

		const r =
		  await apiPost(
			"/chat",
			{
			  messages:
				nextMessages,
			  search,
			  mode: autoMode,
			  chatId:
				chatIdRef.current
			}
		  );

		const reader =
		  r.body.getReader();

		const decoder =
		  new TextDecoder();

		let buffer = "";
		let streamTimeout = null;

		function flushStream() {

		  clearTimeout(
			streamTimeout
		  );

		  streamTimeout =
			setTimeout(() => {

			  setMessages(prev => {

				const copy = [...prev];

				if (
				  copy.at(-1)?.role ===
				  "assistant"
				) {

				  copy[
					copy.length - 1
				  ] = {
					role: "assistant",
					content: buffer,
					streaming: true
				  };

				} else {

				  copy.push({
					role: "assistant",
					content: buffer,
					streaming: true
				  });

				}

				return copy;

			  });

			}, 25);

		}

		while (true) {

		  const {
			done,
			value
		  } = await reader.read();

		  if (done) {

			  setMessages(prev => {

				const copy = [...prev];

				if (
				  copy.at(-1)?.role ===
				  "assistant"
				) {

				  copy[
					copy.length - 1
				  ] = {
					...copy[
					  copy.length - 1
					],
					streaming: false
				  };

				}

				return copy;

			  });

			  break;
			}

		  const chunk =
			  decoder.decode(
				value,
				{
				  stream: true
				}
			  );

			const cleaned =
				  chunk
					.replace(/\r/g, "")
					.replace(/\t/g, "  ");

				buffer += cleaned;

				/* FIX HTML LINE BREAK */

				buffer = buffer
				  .replace(
					/(<\/style>)/g,
					"$1\n"
				  )

				  .replace(
					/(<script>)/g,
					"\n$1\n"
				  )

				  .replace(
					/(<\/script>)/g,
					"\n$1\n"
				  )

				  .replace(
					/```html/g,
					"\n```html\n"
				  );
			  
		  flushStream();

		}

		await loadChats();

	  } catch {

		setMessages(prev => [
		  ...prev,
		  {
			role: "assistant",
			content:
			  "Lỗi phản hồi AI."
		  }
		]);

	  } finally {

		setLoading(false);
		setLoadingType("none");

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

	  const files =
		Array.from(
		  e.target.files || []
		);

	  if (!files.length) return;

	  setSmartFiles(prev => [
		...prev,
		...files
	  ]);

	  /* file action pending */

	  if (
		pendingFileAction?.type ===
		"image-chat"
	  ) {

		generateImageInChat(
		  pendingFileAction.prompt,
		  pendingFileAction.tool,
		  files[0]
		);

		setPendingFileAction(null);

		return;
	  }

	  if (
		pendingFileAction?.type ===
		"file-chat"
	  ) {

		sendRealFiles(
		  pendingFileAction.prompt,
		  pendingFileAction.mode,
		  files
		);

		setPendingFileAction(null);

	  }

	}

// PATCH FULL function sendRealFile()

async function sendRealFiles(
  prompt,
  fileMode = "file_summary",
  fileList = []
) {
  const useFiles =
  fileList.length
    ? fileList
    : smartFiles;

  if (!useFiles.length) return;

  setTab("chat");

  const name =
  useFiles
    .map(f => f.name)
    .join(", ");

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

	  setMessages((prev) => {

	  const copy = [...prev];

	  copy.push({
		role: "assistant",
		content: steps[0]
	  });

	  return copy;

	});

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

          const lastAssistantIndex =
			  [...copy]
				.reverse()
				.findIndex(
				  x => x.role === "assistant"
				);

			if (lastAssistantIndex !== -1) {

			  const realIndex =
				copy.length - 1 - lastAssistantIndex;

			  copy[realIndex] = {
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

    useFiles.forEach(file => {

	  fd.append(
		"files",
		file
	  );

	});

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
	setSmartFiles([]);
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
	  fileObj ||
	  smartFiles?.[0] ||
	  null;

    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: prompt
      }
	  
	  /*
      {
        role: "assistant",
        content: "Đang tạo ảnh..."
      }
	  */
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
			  d.error ||
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

  if (!smartFiles.length) {

    setPendingFileAction({
      type: "file-chat",
      prompt,
      mode: fileMode
    });

    askUpload();

    return;
  }

  await sendRealFiles(
    prompt,
    fileMode,
    smartFiles
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
      !smartFiles.length
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
    const mode = item.mode || "normal";

    if (mode.startsWith("file")) {
      if (!smartFiles.length) {
        setTab("chat");
        setPendingFileAction({
          type: "file-chat",
          prompt: item.prompt,
          mode
        });
        fileInputRef.current?.click();
        return;
      }

      await sendRealFiles(
		  item.prompt,
		  mode,
		  smartFiles
		);
      return;
    }

    const imgTool = detectImageIntent(item.prompt);

    if (imgTool) {
      await generateImageInChat(item.prompt, imgTool);
      return;
    }

    setTab("chat");
    await sendText(item.prompt);
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
    multiple
    ref={fileInputRef}
    type="file"
    accept="
      .pdf,
      .doc,
      .docx,
      .xls,
      .xlsx,
      .png,
      .jpg,
      .jpeg,
      .webp,
      .txt,
      .js,
      .jsx,
      .ts,
      .tsx,
      .json,
      .css,
      .html
    "
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

	 {
	  tab !== "tools" && (
		<Composer
		  text={text}
		  setText={setText}
		  search={search}
		  setSearch={setSearch}
		  loading={loading}
		  send={async (files = []) => {

			if (files?.length) {

			  const currentText =
				String(text || "").trim();

			  setMessages(prev => [
				  ...prev,
				  {
					role: "user",
					content:
					  currentText
						? `${currentText}\n\n📎 ${
							files
							  .map(
								(f, i) =>
								  f?.name ||
								  `image-${i + 1}.png`
							  )
							  .join(", ")
						  }`
						: `📎 ${
							files
							  .map(
								(f, i) =>
								  f?.name ||
								  `image-${i + 1}.png`
							  )
							  .join(", ")
						  }`
				  }
				]);

				setText("");

				await sendRealFiles(
				  currentText ||
					"Xem file và hỗ trợ giúp mình",
				  "file_summary",
				  files
				);

				return true;
			}

			await sendText(text);

			return true;

		  }}
		/>
	  )
	}
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
    setPaywallDismissed(true);   // 👈 QUAN TRỌNG
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
  onClick={() => {
    setPaywallDismissed(true);   // 👈 thêm dòng này
    setShowPaywall(false);
  }}
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
