// src/components/Sidebar.jsx
import { formatLimit } from "../utils/format";

import React, {
  useEffect,
  useRef,
  useState
} from "react";

import {
  apiGet,
  apiPost
} from "../services/api";

export default function Sidebar({
  chats = [],
  openChat,
  newChat,
  logout,
  tab,
  setTab,
  usage = null,
  refreshUsage,

  refreshChats,
  setChats,
  activeChatId
})
 {
  const [menuId, setMenuId] =
    useState(null);

  const [query, setQuery] =
    useState("");

  const [editingId, setEditingId] =
    useState(null);

  const [editValue, setEditValue] =
    useState("");

  const list = chats || [];
const [
  paymentPending,
  setPaymentPending
] = useState(false);
  const menuRef = useRef(null);
const API =
  import.meta.env.VITE_API_URL ||
  "https://api.workaivn.com";
  
  const [showUpgrade, setShowUpgrade] =
  useState(false);

const [upgradeLoading, setUpgradeLoading] =
  useState(false);

const [upgradeInfo, setUpgradeInfo] =
  useState(null);
  
	useEffect(() => {
	  if (!showUpgrade) return;

	  const t = setInterval(async () => {
		try {
		  await refreshUsage();
		} catch {}
	  }, 5000);

	  return () => clearInterval(t);
	}, [showUpgrade]);
	
	useEffect(() => {
	  if (!usage) return;

	  if (usage.plan === "pro" || usage.plan === "business") {
		setShowUpgrade(false);
		setUpgradeInfo(null);
	  }
	}, [usage]);
  
	useEffect(() => {
	  if (!showUpgrade) return;

	  const timer =
		setInterval(
		  async () => {
			try {
			  if (
				refreshUsage
			  ) {
				await refreshUsage();
			  }
			} catch {}
		  },
		  10000
		);

	  return () =>
		clearInterval(
		  timer
		);
	}, [
	  showUpgrade
	]);

  useEffect(() => {
    function closeMenu(e) {
      if (
        menuRef.current &&
        !menuRef.current.contains(
          e.target
        )
      ) {
        setMenuId(null);
      }
    }

    document.addEventListener(
      "mousedown",
      closeMenu
    );

    return () =>
      document.removeEventListener(
        "mousedown",
        closeMenu
      );
  }, []);


useEffect(() => {
  if (!showUpgrade) return;

  const t = setInterval(async () => {
    try {
      const r = await apiGet("/usage");
      const d = await r.json();

      if (
        d.plan === "pro" ||
        d.plan === "business"
      ) {
        setShowUpgrade(false);
        setUpgradeInfo(null);
      }

    } catch {}
  }, 3000);

  return () => clearInterval(t);

}, [showUpgrade]);

  function isImageChat(chat) {
    const msgs =
      chat.messages || [];

    return msgs.some((m) => {
      const c = String(
        m.content || ""
      ).toLowerCase();

      return (
        c.includes(
          "data:image"
        ) ||
        c.includes(".png") ||
        c.includes(".jpg") ||
        c.includes(
          "openaiusercontent"
        )
      );
    });
  }

  function cleanTitle(chat) {
    return (
      chat.title ||
      (isImageChat(chat)
        ? "Ảnh AI"
        : "New Chat")
    );
  }

  const filtered =
    list.filter((chat) =>
      cleanTitle(chat)
        .toLowerCase()
        .includes(
          query.toLowerCase()
        )
    );

  const planName =
    usage?.plan || "free";

  const limits =
    usage?.limits || {};

  const used =
    usage?.used || {};

  const chatUsed =
    used.chat || 0;

  const chatLimit =
    limits.chatPerDay || 10;

  const percent =
    Math.min(
      100,
      Math.round(
        (chatUsed /
          chatLimit) *
          100
      )
    );



async function requestUpgrade(plan = "pro") {
  setUpgradeLoading(true);

  try {
    const r = await apiPost("/payment/create", { plan });
    const d = await r.json();

    setUpgradeInfo(d);
    setShowUpgrade(true);

  } catch (e) {
    console.log(e);
  }

  setUpgradeLoading(false);
}

async function saveRename(id) {
  const title =
    editValue.trim();

  if (!title) return;

  try {
    const r = await fetch(
		  API +
			"/api/chat/" +
			id +
			"/rename",
      {
        method: "PUT",
        headers: {
          "Content-Type":
            "application/json",
          authorization:
            localStorage.getItem("token")
        },
        body: JSON.stringify({
          title
        })
      }
    );

    if (!r.ok) return;

    await refreshChats();

  } catch (err) {
    console.log(err);
  }

  setEditingId(null);
  setMenuId(null);
}

async function deleteChat(id) {
  if (!confirm("Xóa chat này?")) return;

  try {
    const r = await fetch(
		  API +
			"/api/chat/" +
			id,
      {
        method: "DELETE",
        headers: {
          authorization:
            localStorage.getItem("token")
        }
      }
    );

    if (!r.ok) return;

    setChats((prev) =>
      prev.filter(
        (x) => x._id !== id
      )
    );

    if (activeChatId === id) {
      newChat();
      setTab("chat");
    }

    await refreshChats();

  } catch (err) {
    console.log(err);
  }

  setMenuId(null);
}

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="brandOnly">
          <img
            src="/logo.png"
            className="bigLogo"
          />
        </div>

        <button
          className="newBtn premium"
          onClick={() => {
            setTab("chat");
            newChat();
          }}
        >
          + New Chat
        </button>

        <div className="sideTabs premiumTabs">
          <button
            className={
              tab === "chat"
                ? "active"
                : ""
            }
            onClick={() =>
              setTab("chat")
            }
          >
            💬 Chat
          </button>

          <button
            className={
              tab === "tools"
                ? "active"
                : ""
            }
            onClick={() =>
              setTab("tools")
            }
          >
            🧰 Tools
          </button>
        </div>

        <input
          className="searchHistory"
          placeholder="Tìm lịch sử..."
          value={query}
          onChange={(e) =>
            setQuery(
              e.target.value
            )
          }
        />
      </div>

      <div className="sidebar-body">
        <div className="recentTitle">
          GẦN ĐÂY
        </div>

        <div className="history">
          {filtered.map(
            (chat) => (
              <div
                key={chat._id}
                className="chatRow premiumRow"
              >
                {editingId ===
                chat._id ? (
                  <input
                    autoFocus
                    className="chatEditInput"
                    value={
                      editValue
                    }
                    onChange={(
                      e
                    ) =>
                      setEditValue(
                        e.target
                          .value
                      )
                    }
                    onBlur={() =>
                      saveRename(
                        chat._id
                      )
                    }
                    onKeyDown={(
                      e
                    ) => {
                      if (
                        e.key ===
                        "Enter"
                      ) {
                        saveRename(
                          chat._id
                        );
                      }

                      if (
                        e.key ===
                        "Escape"
                      ) {
                        setEditingId(
                          null
                        );
                      }
                    }}
                  />
                ) : (
                  <div
                    className="chatTitle"
                    onClick={() => {
                      setTab(
                        "chat"
                      );
                      openChat(
                        chat._id
                      );
                    }}
                  >
                    {cleanTitle(
                      chat
                    )}
                  </div>
                )}

                <button
                  className="moreBtn"
                  onClick={() =>
                    setMenuId(
                      menuId ===
                        chat._id
                        ? null
                        : chat._id
                    )
                  }
                >
                  ⋯
                </button>

                {menuId ===
                  chat._id && (
                  <div
                    className="menuBox"
                    ref={menuRef}
                  >
                    <button
                      onClick={() => {
                        setEditingId(
                          chat._id
                        );

                        setEditValue(
                          cleanTitle(
                            chat
                          )
                        );

                        setMenuId(
                          null
                        );
                      }}
                    >
                      ✏ Rename
                    </button>

                    <button
                      onClick={() =>
                        deleteChat(
                          chat._id
                        )
                      }
                    >
                      🗑 Delete
                    </button>
                  </div>
                )}
              </div>
            )
          )}
        </div>
      </div>

      <div className="sidebar-footer">
        <div className="planCard">
          <div className="planTop">
            <span>
              {planName
                .charAt(0)
                .toUpperCase() +
                planName.slice(
                  1
                )}{" "}
              Plan
            </span>

            <span>
              {chatUsed}/{formatLimit(chatLimit)}
            </span>
          </div>

          <div className="planBar">
            <div
              className="planFill"
              style={{
                width:
                  percent +
                  "%"
              }}
            ></div>
          </div>

          {planName ===
            "free" && (
            <button
			  className="upgradeBtn"
			  onClick={() => setShowUpgrade(true)}
			>
			  🚀 Nâng cấp
			</button>
          )}
        </div>
{showUpgrade && (
  <div className="upgradeBox">

    {/* chọn gói */}
    <div className="planSelect">

      <button
        onClick={() => requestUpgrade("pro")}
        disabled={upgradeLoading}
      >
        🚀 Pro - 99K
      </button>

      <button
        onClick={() => requestUpgrade("business")}
        disabled={upgradeLoading}
      >
        💼 Business - 499K
      </button>

    </div>

    {/* loading */}
    {upgradeLoading && (
      <div style={{ marginTop: 10 }}>
        Đang tạo QR...
      </div>
    )}

    {/* QR */}
    {upgradeInfo && (
      <div className="qrBox">

        <img
          src={
            upgradeInfo.qr +
            "&t=" +
            Date.now()
          }
          style={{ width: "100%" }}
        />

        <div className="payInfo">
          <div>
            💰 {upgradeInfo.amount.toLocaleString("vi-VN")} đồng
          </div>

          <div>
            📝 {upgradeInfo.content}
          </div>
        </div>

      </div>
    )}

    {/* pending */}
    {paymentPending && (
      <div className="pendingBox">
        ⏳ Đang chờ thanh toán...
      </div>
    )}

  </div>
)}


<button className="logoutBtn" onClick={() => { window.location.href = "/profile"; }} > 👤 Tài khoản </button>
<button className="logoutBtn" onClick={logout} > 🚪 Logout </button>
      </div>
	    
	  
    </aside>
  );
}
