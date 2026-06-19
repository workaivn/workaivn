// src/pages/Chat.jsx

import React, { useEffect, useRef, useState } from "react";
import { quickCards } from "../data/quickCards";
import Tools from "./Tools.jsx";
import Sidebar from "../components/Sidebar";
import Composer from "../components/Composer";
import MessageList from "../components/MessageList";
import AgentHub from "./AgentHub.jsx";
import PromptBuilder from "./PromptBuilder.jsx";
import AgentWorkspace from "./AgentWorkspace.jsx";
import ProjectMemory from "./ProjectMemory.jsx";
import FileContextManager from "./FileContextManager.jsx";
import TaskWorkflow from "./TaskWorkflow.jsx";
import CodexClineMode from "./CodexClineMode.jsx";
import OutputEvaluator from "./OutputEvaluator.jsx";
import { apiGet, apiPost } from "../services/api";

export default function Chat({ tab, setTab, mainView = null, navigateTo }) {

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
	const messagesRef =
	  useRef([]);
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
	  messagesRef.current =
		messages;
	}, [messages]);

  useEffect(() => {

	  requestAnimationFrame(() => {
		endRef.current?.scrollIntoView({
		  behavior: "smooth"
		});
	  });

	}, [messages]);

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
      if (d.error) {
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

      const cleaned = (d.messages || []).map((msg) => ({
        role: String(msg.role || "assistant"),
        content:
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content || "", null, 2),
        image: typeof msg.image === "string" ? msg.image : ""
      }));

      setChatId(id);
      setMessages(cleaned);
      setTab("chat");
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
    window.location.reload();
  }

  function detectMode(input = "") {
    const t = String(input).toLowerCase();

    if (
      t.includes("code") ||
      t.includes("fix") ||
      t.includes("bug") ||
      t.includes("debug") ||
      t.includes("function") ||
      t.includes("api") ||
      t.includes("react") ||
      t.includes("node") ||
      t.includes("javascript") ||
      t.includes("typescript") ||
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
    if (t.includes("tạo ảnh") || t.includes("vẽ ảnh") || t.includes("ảnh ")) {
      return "create";
    }

    return null;
  }

  async function sendText(prompt) {
    const cleanPrompt = String(prompt || "").trim();

    if (!cleanPrompt) return;

    if (
      usage?.plan === "free" &&
      (usage?.used?.chat || 0) >= (usage?.limits?.chatPerDay || 0)
    ) {
      if (!paywallDismissed) {
        setShowPaywall(true);
      }

      return;
    }

    setText("");

    const assistantId = Date.now() + "-assistant";
    const userMessage = {
      role: "user",
      content: cleanPrompt
    };

    setLoading(true);
    setLoadingType("chat");

    try {
      const autoMode = detectMode(cleanPrompt);
      const nextMessages = [...messagesRef.current, userMessage];
      const latestChatId = chatIdRef.current;

      setMessages((prev) => [
        ...prev,
        userMessage,
        {
          id: assistantId,
          role: "assistant",
          content: ""
        }
      ]);

      const r = await apiPost("/chat", {
        messages: nextMessages,
        search,
        mode: autoMode,
        chatId: latestChatId
      });

      if (!r.body) {
        throw new Error("Streaming not supported.");
      }

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        buffer = buffer.replace(/\r\n/g, "\n");

        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() || "";

        for (const event of events) {
          const line = event.split("\n").find((x) => x.startsWith("data:"));

          if (!line) continue;

          const raw = line.replace("data:", "").trim();

          if (!raw || raw === "[DONE]") continue;

          try {
            const json = JSON.parse(raw);

            if (json.type === "token") {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId
                    ? {
                        ...msg,
                        content: (msg.content || "") + (json.delta || "")
                      }
                    : msg
                )
              );
            }

            if (json.type === "done") {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId
                    ? {
                        ...msg,
                        content: json.final || msg.content
                      }
                    : msg
                )
              );
            }
          } catch (err) {
            console.log("SSE PARSE FAIL", err);
          }
        }
      }

      await loadChats();
    } catch {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantId
            ? {
                ...msg,
                content: "Lỗi phản hồi AI"
              }
            : msg
        )
      );
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
		
	const assistantId =
    Date.now() + "-assistant-file";
	const userMessage = {
	  role: "user",

	  content:
		prompt
		  ? `${prompt}\n\n📎 ${
			  useFiles
				.map(
				  (f, i) =>
					f?.name ||
					`file-${i + 1}`
				)
				.join(", ")
			}`
		  : `📎 ${
			  useFiles
				.map(
				  (f, i) =>
					f?.name ||
					`file-${i + 1}`
				)
				.join(", ")
			}`
	};

  if (!useFiles.length) return;

  setTab("chat");
  const nextMessages = [
	  ...messagesRef.current,
	  userMessage
	];

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

		  "Đang suy nghĩ...",
		  "Đang xử lý dữ liệu...",
		  "Đang phân tích ngữ cảnh...",
		  "Đang tổng hợp thông tin...",
		  "Đang tạo phản hồi..."

		];
    }

    if (useFiles?.length) {

		  return [
			"Đang đọc files...",
			"Đang phân tích nội dung...",
			"Đang tìm thông tin liên quan...",
			"Đang xử lý yêu cầu..."
		  ];

		}

		return [
		  "Đang suy nghĩ...",
		  "Đang xử lý yêu cầu...",
		  "Đang tạo phản hồi..."
		];
  }

  const steps =
    getSteps();
  setLoadingType("file");
  setLoading(true);
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

	setMessages(prev => [
	  ...prev,

	  userMessage,

	  {
		id: assistantId,
		role: "assistant",
		content: ""
	  }
	]);

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
	if (!r.body) {
	  throw new Error(
		"Streaming not supported."
	  );
	}
    const reader =
  r.body.getReader();

const decoder =
  new TextDecoder();

let buffer = "";

while (true) {

  const {
    done,
    value
  } = await reader.read();

  if (done) break;

  const chunk =
    decoder.decode(
      value,
      { stream: true }
    );

  buffer += chunk;
  buffer =
  buffer.replace(/\r\n/g, "\n");

  const events =
	buffer.split(/\r?\n\r?\n/);

  buffer =
    events.pop() || "";

  for (const event of events) {

    const line =
      event
        .split("\n")
        .find(x =>
          x.startsWith("data:")
        );

    if (!line)
      continue;

    const raw =
      line
        .replace("data:", "")
        .trim();

    if (
      !raw ||
      raw === "[DONE]"
    ) {
      continue;
    }

    try {

      const json =
        JSON.parse(raw);

      switch (json.type) {

        case "token":

		  setMessages(prev => {

			return prev.map(msg => {

			  if (
				msg.id === assistantId
			  ) {

				return {
				  ...msg,

				  content:
					(msg.content || "") +
					(json.delta || "")
				};

			  }

			  return msg;

			});

		  });

		  break;

        case "done":

		  if (json.chatId) {
			setChatId(json.chatId);
		  }

		  setMessages(prev => {

			return prev.map(msg => {

			  if (
				msg.id === assistantId
			  ) {

				return {
				  ...msg,
				  content:
					json.final ||
					msg.content
				};

			  }

			  return msg;

			});

		  });

		  break;

         case "error":

          console.log(
            "ERROR:",
            json.error
          );

          break;

      }

    } catch (err) {

      console.log(
        "SSE PARSE FAIL",
        err
      );

    }

  }

}
    await loadChats();

  } catch {

    setMessages(
      (prev) => {
        return prev.map(msg => {

		  if (
			msg.id === assistantId
		  ) {

			return {
			  ...msg,
			  content: "Lỗi phản hồi AI"
			};

		  }

		  return msg;

		});
      });

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
	  
	  const assistantId =
  Date.now() + "-image";
    const useFile =
	  fileObj ||
	  smartFiles?.[0] ||
	  null;

    const userMessage = {
      role: "user",
      content: prompt
    };

    const nextMessages = [
      ...messagesRef.current,
      userMessage
    ];

    setMessages((prev) => [
      ...prev,
      {
        ...userMessage
      },
      {
        id: assistantId,
        role: "assistant",
        content: ""
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
	fd.append(
	  "messages",
	  JSON.stringify(nextMessages)
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
			return prev.map(msg => {

			  if (
				msg.id === assistantId
			  ) {

				return {
				  ...msg,
				  content:
					d.imageUrl ||
					d.error ||
					"Lỗi tạo ảnh."
				};

			  }

			  return msg;

			});
		});

      if (d.chatId) {
        setChatId(d.chatId);
      }

       await loadChats();

		} catch {

		  setMessages(prev => {

			return prev.map(msg => {

			  if (
				msg.id === assistantId
			  ) {

				return {
				  ...msg,
				  content: "Lỗi phản hồi AI"
				};

			  }

			  return msg;

			});

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

  function renderShellModule() {
    switch (mainView) {
      case "workspace":
        return <AgentWorkspace />;
      case "agent-hub":
        return <AgentHub />;
      case "prompt-builder":
        return <PromptBuilder />;
      case "project-memory":
        return <ProjectMemory />;
      case "file-context":
        return <FileContextManager />;
      case "task-workflow":
        return <TaskWorkflow />;
      case "codex-cline-mode":
        return <CodexClineMode />;
      case "output-evaluator":
        return <OutputEvaluator />;
      default:
        return null;
    }
  }

  async function handleComposerSend(files = []) {
    const currentText = String(text || "").trim();

    if (files?.length) {
      const userPrompt = currentText;
      const onlyImages = files.every((file) => file.type?.startsWith("image/"));

      if (onlyImages) {
        const assistantId = Date.now() + "-vision";
        const token = localStorage.getItem("token") || "";
        const API_URL = import.meta.env.VITE_API_URL || "https://api.workaivn.com/api";

        const preview = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(files[0]);
        });

        setMessages((prev) => [
          ...prev,
          {
            role: "user",
            content: userPrompt || "📷 Ảnh",
            image: preview
          },
          {
            id: assistantId,
            role: "assistant",
            content: ""
          }
        ]);

        setText("");
        setLoading(true);
        setLoadingType("chat");

        try {
          const fd = new FormData();
          fd.append("prompt", currentText || "Phân tích ảnh giúp mình");
          fd.append("tool", "vision");
          fd.append("file", files[0]);

          const r = await fetch(`${API_URL}/generate-image`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`
            },
            body: fd
          });

          const d = await r.json();

          if (d.chatId) {
            setChatId(d.chatId);
            await loadChats();
          }

          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.id === assistantId) {
                return {
                  ...msg,
                  content: typeof d.answer === "string" ? d.answer : "Không đọc được ảnh."
                };
              }

              return msg;
            })
          );
        } catch {
          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.id === assistantId) {
                return {
                  ...msg,
                  content: "Lỗi đọc ảnh."
                };
              }

              return msg;
            })
          );
        } finally {
          setLoading(false);
          setLoadingType("none");
        }

        return true;
      }

      setText("");
      await sendRealFiles(currentText || "Xem file và hỗ trợ giúp mình", "file_summary", files);
      await loadChats();
      return true;
    }

    await sendText(text);
    return true;
  }

  /* ==================================================
     UI
  ================================================== */

  const isEmpty =
    messages.length === 0;

  const quickCardItems = quickCards.flatMap((group) =>
    Array.isArray(group.items) ? group.items : []
  );

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
    navigateTo={navigateTo}

  usage={usage}
  refreshUsage={loadUsage}

  refreshChats={loadChats}
  setChats={setChats}
  activeChatId={chatId}
/>

      <main className="main">
        {mainView ? (
          <div className="shellModuleWrap">
            {renderShellModule()}
          </div>
        ) : tab === "tools" ? (
          <Tools runTool={runTool} />
        ) : isEmpty ? (
          <section className="emptyWrap">
            <div className="heroTitle">Bạn muốn làm gì hôm nay?</div>
            <div className="quickGrid">{quickCardItems.map(renderQuickCard)}</div>
            <div
              style={{
                textAlign: "center",
                marginTop: "12px",
                color: "#64748b"
              }}
            >
              Vào Tool Center để dùng
              các công cụ AI cho doanh nghiệp.
            </div>
          </section>
        ) : (
          <>
            <MessageList
              messages={messages}
              loading={loading && loadingType === "chat"}
            />

            {loading && loadingType === "image" && (
              <div className="chatArea">
                <div className="row assistant">
                  <div className="bubble assistant typingBubble">
                    <div className="msgRole">WorkAI</div>
                    <div>Đang tạo ảnh...</div>
                  </div>
                </div>
              </div>
            )}

            <div ref={endRef}></div>
          </>
        )}

        {!mainView && tab !== "tools" && (
          <Composer
            text={text}
            setText={setText}
            search={search}
            setSearch={setSearch}
            loading={loading}
            send={handleComposerSend}
          />
        )}
      </main>

      {showPaywall && (
        <div className="paywallWrap">
          <div className="paywallBox">
            <div className="paywallBadge">FREE LIMIT REACHED</div>
            <h2>Bạn đã dùng hết lượt chat hôm nay</h2>
            <p>Nâng cấp Pro để tiếp tục dùng AI không gián đoạn.</p>
            <div className="paywallPrice">Chỉ 99.000đ/tháng</div>
            <div className="paywallList">
              ✔ 200 chat/ngày<br />
              ✔ Upload file nhiều hơn<br />
              ✔ Tạo ảnh nhiều hơn<br />
              ✔ Ưu tiên AI mạnh hơn
            </div>
            <div className="paywallActions">
              <button
                className="paywallBtn"
                onClick={() => {
                  setPaywallDismissed(true);
                  setShowPaywall(false);
                  setTab("chat");
                  document.querySelector(".upgradeBtn")?.click();
                }}
              >
                Nâng cấp ngay
              </button>

              <button
                className="paywallClose"
                onClick={() => {
                  setPaywallDismissed(true);
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
