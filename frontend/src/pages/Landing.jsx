import React, { useEffect, useState } from "react";
import "./Landing.css";
import { API_BASE_URL } from "../services/api.js";

const APP = "https://app.workaivn.com";
function go(path = "") { window.location.href = APP + path; }

const FEATURES = [
  { icon: "🤖", title: "AI Agent Hub", desc: "Giao nhiệm vụ cho nhiều AI Agent cùng lúc, so sánh kết quả, chọn tốt nhất." },
  { icon: "⚙️", title: "Prompt Builder", desc: "Tự động tạo prompt chuẩn cho Cline, Cursor, Codex, Gemini, Claude." },
  { icon: "🔀", title: "Multi Provider", desc: "Kết nối OpenAI, Gemini, Anthropic, OpenRouter trong một giao diện duy nhất." },
  { icon: "🧩", title: "Agent Workspace", desc: "Không gian 3 panel để chỉnh sửa, chạy và so sánh task." },
  { icon: "🧠", title: "Project Memory", desc: "Lưu bối cảnh dự án, kiến trúc hệ thống, tài liệu tái sử dụng." },
  { icon: "🔗", title: "Task Workflow", desc: "Chuỗi task tự động, mỗi bước dùng agent riêng, đầu ra nối tiếp nhau." },
  { icon: "📝", title: "Prompt Templates", desc: "Thư viện mẫu prompt có sẵn cho từng loại task lập trình." },
  { icon: "📊", title: "Usage & Plan", desc: "Quản lý lượt dùng theo ngày, nâng cấp plan khi cần." },
];

const STEPS = [
  { n: "1", title: "Nhập ý tưởng / task", desc: "Mô tả yêu cầu trong một câu hoặc nhiều câu chi tiết." },
  { n: "2", title: "WorkAIVN chuẩn hóa prompt", desc: "Hệ thống tự chọn template phù hợp, bổ sung context." },
  { n: "3", title: "Chọn agent / provider", desc: "Chọn OpenAI, Gemini hay Anthropic — hoặc chạy cả ba cùng lúc." },
  { n: "4", title: "Copy hoặc chạy task", desc: "Dùng kết quả trực tiếp hoặc copy vào Cline/Cursor." },
  { n: "5", title: "So sánh, lưu, tiếp tục", desc: "Xem lịch sử, so sánh output, lưu vào Project Memory." },
];

const USE_CASES = [
  { icon: "💻", title: "Lập trình với Cline/Cursor", desc: "Tạo prompt chuẩn, chia task thành phase rõ ràng trước khi đưa vào IDE." },
  { icon: "📄", title: "Viết tài liệu kỹ thuật", desc: "Tự động tạo README, ADR, API spec từ mô tả hệ thống." },
  { icon: "🔍", title: "Review code", desc: "Chạy review qua nhiều model, tổng hợp ý kiến." },
  { icon: "🗂️", title: "Chia phase dự án", desc: "Phân tích yêu cầu thành các sprint/phase có thể thực thi." },
  { icon: "🛒", title: "Tạo nội dung bán hàng", desc: "Prompt tối ưu cho caption, kịch bản livestream, email marketing." },
  { icon: "👥", title: "Workflow AI cho team", desc: "Chia sẻ agent, template, task chain trong nội bộ team nhỏ." },
];

const PLANS_FALLBACK = [
  {
    name: "Free", price: "0đ", period: "/mãi mãi", badge: "",
    features: ["10 chat/ngày", "3 file/ngày", "2 ảnh/ngày", "Công cụ cơ bản"],
    cta: "Bắt đầu miễn phí", highlight: false
  },
  {
    name: "Pro", price: "99.000đ", period: "/tháng", badge: "Phổ biến nhất",
    features: ["200 chat/ngày", "30 file/ngày", "20 ảnh/ngày", "Agent Hub", "Project Memory"],
    cta: "Nâng cấp Pro", highlight: true
  },
  {
    name: "Business", price: "499.000đ", period: "/tháng", badge: "",
    features: ["Không giới hạn", "Tất cả tính năng", "Ưu tiên AI mạnh hơn", "Hỗ trợ ưu tiên"],
    cta: "Liên hệ", highlight: false
  },
];

export default function Landing() {
  const [plans, setPlans] = useState(PLANS_FALLBACK);
  const [heroTitle, setHeroTitle] = useState("WorkAIVN — AI Agent Hub cho công việc và lập trình");
  const [heroSub, setHeroSub] = useState("Gửi một yêu cầu, chia task thành nhiều phase, chạy qua nhiều AI Agent, lưu lịch sử và so sánh kết quả.");

  useEffect(() => {
    const API = API_BASE_URL + "/api";
    fetch(`${API}/app/config`)
      .then(r => r.json())
      .then(d => {
        if (d.data?.LANDING_HERO_TITLE) setHeroTitle(d.data.LANDING_HERO_TITLE);
        if (d.data?.LANDING_HERO_SUBTITLE) setHeroSub(d.data.LANDING_HERO_SUBTITLE);
      })
      .catch(() => {});

    fetch(`${API}/app/plans`)
      .then(r => r.json())
      .then(d => {
        if (d.data) {
          const raw = d.data;
          const mapped = [
            {
              name: raw.free?.name || "Free",
              price: (raw.free?.price || 0) === 0 ? "0đ" : Number(raw.free.price).toLocaleString("vi-VN") + "đ",
              period: "/mãi mãi", badge: "",
              features: [
                `${raw.free?.limits?.chatPerDay || 10} chat/ngày`,
                `${raw.free?.limits?.filePerDay || 3} file/ngày`,
                "Công cụ cơ bản"
              ],
              cta: "Bắt đầu miễn phí", highlight: false
            },
            {
              name: raw.pro?.name || "Pro",
              price: Number(raw.pro?.price || 99000).toLocaleString("vi-VN") + "đ",
              period: "/tháng", badge: "Phổ biến nhất",
              features: [
                `${raw.pro?.limits?.chatPerDay || 200} chat/ngày`,
                `${raw.pro?.limits?.filePerDay || 30} file/ngày`,
                "Agent Hub đầy đủ", "Project Memory"
              ],
              cta: "Nâng cấp Pro", highlight: true
            },
            {
              name: raw.business?.name || "Business",
              price: Number(raw.business?.price || 499000).toLocaleString("vi-VN") + "đ",
              period: "/tháng", badge: "",
              features: ["Không giới hạn", "Tất cả tính năng", "Hỗ trợ ưu tiên"],
              cta: "Liên hệ", highlight: false
            },
          ];
          setPlans(mapped);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="lp">
      {/* NAV */}
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <div className="lp-brand">
            <img src="/logo.png" alt="WorkAIVN" className="lp-logo" />
            <span className="lp-brand-name">WorkAI<span className="lp-brand-vn">VN</span></span>
          </div>
          <nav className="lp-nav-links">
            <a href="#features">Tính năng</a>
            <a href="#how">Cách dùng</a>
            <a href="#pricing">Bảng giá</a>
          </nav>
          <div className="lp-nav-cta">
            <button className="lp-btn-ghost" onClick={() => go("/login")}>Đăng nhập</button>
            <button className="lp-btn-primary" onClick={() => go("/register")}>Bắt đầu miễn phí</button>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="lp-hero">
        <div className="lp-hero-inner">
          <div className="lp-hero-badge">🚀 AI Agent Hub cho Việt Nam</div>
          <h1 className="lp-hero-title">{heroTitle}</h1>
          <p className="lp-hero-sub">{heroSub}</p>
          <div className="lp-hero-actions">
            <button className="lp-btn-primary lp-btn-lg" onClick={() => go("/register")}>Bắt đầu miễn phí</button>
            <button className="lp-btn-outline lp-btn-lg" onClick={() => go("/")}>Khám phá Agent Hub</button>
          </div>
          {/* Hero card preview */}
          <div className="lp-hero-cards">
            <div className="lp-preview-card">
              <div className="lp-preview-label">🤖 Agent Hub</div>
              <div className="lp-preview-bar"></div>
              <div className="lp-preview-bar short"></div>
              <div className="lp-preview-chips">
                <span className="lp-chip green">GPT-4o ✅</span>
                <span className="lp-chip blue">Gemini ✅</span>
                <span className="lp-chip purple">Claude ✅</span>
              </div>
            </div>
            <div className="lp-preview-card">
              <div className="lp-preview-label">⚙️ Prompt Builder</div>
              <div className="lp-preview-bar"></div>
              <div className="lp-preview-bar short"></div>
              <div className="lp-preview-bar"></div>
            </div>
            <div className="lp-preview-card">
              <div className="lp-preview-label">📊 Compare Mode</div>
              <div className="lp-preview-compare">
                <div className="lp-compare-col"><div className="lp-preview-bar"></div><div className="lp-preview-bar short"></div></div>
                <div className="lp-compare-col"><div className="lp-preview-bar"></div><div className="lp-preview-bar short"></div></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="lp-section" id="features">
        <div className="lp-section-inner">
          <div className="lp-section-label">Tính năng</div>
          <h2 className="lp-section-title">Mọi thứ bạn cần để làm việc với AI</h2>
          <div className="lp-features-grid">
            {FEATURES.map(f => (
              <div key={f.title} className="lp-feature-card">
                <div className="lp-feature-icon">{f.icon}</div>
                <h3 className="lp-feature-title">{f.title}</h3>
                <p className="lp-feature-desc">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="lp-section lp-section-alt" id="how">
        <div className="lp-section-inner">
          <div className="lp-section-label">Cách dùng</div>
          <h2 className="lp-section-title">Từ ý tưởng đến kết quả trong 5 bước</h2>
          <div className="lp-steps">
            {STEPS.map(s => (
              <div key={s.n} className="lp-step">
                <div className="lp-step-num">{s.n}</div>
                <div>
                  <div className="lp-step-title">{s.title}</div>
                  <div className="lp-step-desc">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* USE CASES */}
      <section className="lp-section" id="usecases">
        <div className="lp-section-inner">
          <div className="lp-section-label">Ứng dụng thực tế</div>
          <h2 className="lp-section-title">WorkAIVN phù hợp với ai?</h2>
          <div className="lp-usecase-grid">
            {USE_CASES.map(u => (
              <div key={u.title} className="lp-usecase-card">
                <span className="lp-usecase-icon">{u.icon}</span>
                <div>
                  <div className="lp-usecase-title">{u.title}</div>
                  <div className="lp-usecase-desc">{u.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="lp-section lp-section-alt" id="pricing">
        <div className="lp-section-inner">
          <div className="lp-section-label">Bảng giá</div>
          <h2 className="lp-section-title">Minh bạch, không phí ẩn</h2>
          <div className="lp-plans">
            {plans.map(p => (
              <div key={p.name} className={`lp-plan-card ${p.highlight ? "lp-plan-highlight" : ""}`}>
                {p.badge && <div className="lp-plan-badge">{p.badge}</div>}
                <div className="lp-plan-name">{p.name}</div>
                <div className="lp-plan-price">{p.price}<span className="lp-plan-period">{p.period}</span></div>
                <ul className="lp-plan-features">
                  {p.features.map(f => <li key={f}>✔ {f}</li>)}
                </ul>
                <button className={`lp-plan-cta ${p.highlight ? "lp-btn-primary" : "lp-btn-outline"}`}
                  onClick={() => go(p.highlight ? "/register" : (p.name === "Business" ? "#" : "/register"))}>
                  {p.cta}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="lp-cta-section">
        <div className="lp-section-inner lp-cta-inner">
          <h2 className="lp-cta-title">Biến WorkAIVN thành trung tâm điều phối AI Agent của bạn.</h2>
          <p className="lp-cta-sub">Miễn phí để bắt đầu. Không cần thẻ tín dụng.</p>
          <div className="lp-cta-actions">
            <button className="lp-btn-primary lp-btn-lg" onClick={() => go("/register")}>Bắt đầu miễn phí</button>
            <button className="lp-btn-white lp-btn-lg" onClick={() => go("/")}>Vào ứng dụng →</button>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="lp-footer">
        <div className="lp-section-inner lp-footer-inner">
          <div className="lp-footer-brand">
            <img src="/logo.png" alt="WorkAIVN" className="lp-footer-logo" />
            <span>WorkAIVN</span>
          </div>
          <div className="lp-footer-copy">© 2024 WorkAIVN. Nền tảng AI Agent Hub cho người Việt.</div>
          <div className="lp-footer-links">
            <a href="#features">Tính năng</a>
            <a href="#pricing">Bảng giá</a>
            <a href={APP + "/login"}>Đăng nhập</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
