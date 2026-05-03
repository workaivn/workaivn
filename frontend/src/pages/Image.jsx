import React, {
  useEffect,
  useRef,
  useState
} from "react";

import Sidebar from "../components/Sidebar";
import { apiGet } from "../services/api";

export default function ImagePage({
  tab,
  setTab
}) {
  const [prompt, setPrompt] = useState("");
  const [img, setImg] = useState("");
  const [loading, setLoading] = useState(false);
  const [chats, setChats] = useState([]);
  const [chatId, setChatId] = useState(null);
  const [tool, setTool] = useState("create");
  const [file, setFile] = useState(null);

  const fileRef = useRef(null);
  const autoRan = useRef(false);

  useEffect(() => {
    boot();
  }, []);

  useEffect(() => {
    if (!prompt.trim()) {
      syncToolPrompt(tool);
    }
  }, [tool]);

  async function boot(){

await loadChats();

const savedPrompt =
localStorage.getItem(
"imagePrompt"
);

const savedTool =
localStorage.getItem(
"imageTool"
);

if(savedPrompt){
setPrompt(savedPrompt);
}

if(savedTool){
setTool(savedTool);
}

localStorage.removeItem(
"imagePrompt"
);

localStorage.removeItem(
"imageTool"
);

/* auto nhận file từ Chat */
const useLast =
localStorage.getItem(
"imageUseLastFile"
);

const lastName =
localStorage.getItem(
"lastImageFileName"
);

if(
useLast &&
lastName
){

setPrompt(prev=>
prev ||
"Tạo ảnh sản phẩm nền trắng studio"
);

/* chỉ báo UI */
setFile({
name:lastName,
virtual:true
});

}

}


  function syncToolPrompt(name) {
    if (name === "create")
      setPrompt(
        "Tạo ảnh đẹp chuyên nghiệp"
      );

    if (name === "passport")
      setPrompt(
        "Làm ảnh 4x6 nền trắng, cân đối, nét"
      );

    if (name === "removebg")
      setPrompt(
        "Xóa nền ảnh, giữ chủ thể rõ nét"
      );

    if (name === "upscale")
      setPrompt(
        "Nâng nét ảnh mờ, tăng chi tiết"
      );
  }

  async function loadChats() {
    try {
      const r = await apiGet("/chats");
      const d = await r.json();

      setChats(
        Array.isArray(d)
          ? d
          : []
      );
    } catch {
      setChats([]);
    }
  }

  function pickFile(e) {
    const f =
      e.target.files?.[0];

    if (!f) return;

    setFile(f);
  }

  async function generate(
    customPrompt,
    customTool
  ) {
    const finalPrompt = (
      customPrompt || prompt
    ).trim();

    const finalTool =
      customTool || tool;

    if (!finalPrompt) return;

    setLoading(true);
    setImg("");

    try {
      const fd =
        new FormData();

      fd.append(
        "prompt",
        finalPrompt
      );

      fd.append(
        "tool",
        finalTool
      );

      fd.append(
        "chatId",
        chatId || ""
      );

      if(
		file &&
		!file.virtual
		){
		fd.append(
		"file",
		file
		);
		}

      const controller =
        new AbortController();

      const timeout =
        setTimeout(() => {
          controller.abort();
        }, 180000);

      const r =
        await fetch(
          "https://api.workaivn.com/api/generate-image",
          {
            method: "POST",
            headers: {
              authorization:
                localStorage.getItem(
                  "token"
                ) || ""
            },
            body: fd,
            signal:
              controller.signal
          }
        );

      clearTimeout(timeout);

      const d =
        await r.json();

      if (!r.ok) {
        throw new Error(
          d.error ||
            "Lỗi tạo ảnh"
        );
      }

      setImg(
        d.imageUrl || ""
      );

      setChatId(
        d.chatId || null
      );
    } catch (err) {
      alert(
        err.name ===
          "AbortError"
          ? "Xử lý quá lâu."
          : err.message
      );
    }

    setLoading(false);
  }

  function newChat() {
    setPrompt("");
    setImg("");
    setFile(null);
    setChatId(null);
  }

  function logout() {
    localStorage.removeItem(
      "token"
    );
    location.reload();
  }

  function toolClass(name) {
    return tool === name
      ? "toolBtn active"
      : "toolBtn";
  }

  return (
    <div className="app">
      <Sidebar
        chats={chats}
        openChat={() => {}}
        newChat={newChat}
        logout={logout}
        tab={tab}
        setTab={setTab}
      />

      <main className="main">
        <header className="topbar">
          Ảnh PRO AI
        </header>

        <div className="imagePage">
          <div className="imgTools">
            <button
              className={toolClass(
                "create"
              )}
              onClick={() =>
                setTool(
                  "create"
                )
              }
            >
              🖼 Tạo ảnh
            </button>

            <button
              className={toolClass(
                "passport"
              )}
              onClick={() =>
                setTool(
                  "passport"
                )
              }
            >
              📷 4x6
            </button>

            <button
              className={toolClass(
                "removebg"
              )}
              onClick={() =>
                setTool(
                  "removebg"
                )
              }
            >
              🧽 Xóa nền
            </button>

            <button
              className={toolClass(
                "upscale"
              )}
              onClick={() =>
                setTool(
                  "upscale"
                )
              }
            >
              ✨ Nâng nét
            </button>
          </div>

          <textarea
            value={prompt}
            onChange={(e) =>
              setPrompt(
                e.target.value
              )
            }
            placeholder="Nhập mô tả ảnh..."
          />

          <input
            hidden
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={pickFile}
          />

          <button
            className="ghostBtn"
            onClick={() =>
              fileRef.current?.click()
            }
          >
            📎 Chọn ảnh
          </button>

          {file && (
            <div className="fileTag">
              {file.name}
            </div>
          )}
		  
		  {file?.virtual && (
			<div className="fileTag">
			📎 File đã chọn từ trang Chat:
			{file.name}

			<br/><br/>
			⚠ Bấm "Chọn ảnh" nếu muốn gửi file thật.
			</div>
			)}

          <button
            onClick={() =>
              generate()
            }
            disabled={loading}
          >
            {loading
              ? "Đang xử lý..."
              : "Chạy AI"}
          </button>

          {img && (
            <div className="resultWrap">
              <img
                src={img}
                alt="AI Result"
                className="resultImg"
              />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}