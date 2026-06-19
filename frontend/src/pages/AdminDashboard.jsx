import React, { useEffect, useState } from "react";
import { apiGet } from "../services/api";
import "./AdminDashboard.css";

const MENU_GROUPS = [
  {
    label: "Tổng quan",
    items: [
      { key: "dashboard", label: "📊 Dashboard" },
      { key: "users", label: "👥 Người dùng" },
    ]
  },
  {
    label: "Cấu hình AI",
    items: [
      { key: "providers", label: "🔌 Providers" },
      { key: "agents", label: "🤖 Agents" },
      { key: "templates", label: "📝 Templates" },
    ]
  },
  {
    label: "Cấu hình App",
    items: [
      { key: "config", label: "⚙️ Config Center" },
      { key: "plans", label: "💳 Plans & Giới hạn" },
    ]
  }
];

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (activeTab === "dashboard") loadDashboard();
  }, [activeTab]);

  async function loadDashboard() {
    setLoading(true);
    try {
      const r = await apiGet("/admin/dashboard");
      const d = await r.json();
      setData(d.data);
    } catch {}
    setLoading(false);
  }

  return (
    <div className="adm-shell">
      <aside className="adm-side">
        <div className="adm-logo">
          <img src="/logo.png" alt="WorkAIVN" />
          <span>Admin</span>
        </div>
        {MENU_GROUPS.map(g => (
          <div key={g.label} className="adm-group">
            <div className="adm-group-label">{g.label}</div>
            {g.items.map(item => (
              <button
                key={item.key}
                className={`adm-menu-btn ${activeTab === item.key ? "active" : ""}`}
                onClick={() => setActiveTab(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}
        <div className="adm-back">
          <button onClick={() => window.location.href = "/"}>← Về ứng dụng</button>
        </div>
      </aside>

      <main className="adm-main">
        {activeTab === "dashboard" && <DashboardTab data={data} loading={loading} />}
        {activeTab === "users" && <UsersTab />}
        {activeTab === "providers" && <ProvidersTab />}
        {activeTab === "agents" && <AgentsTab />}
        {activeTab === "templates" && <TemplatesTab />}
        {activeTab === "config" && <ConfigTab />}
        {activeTab === "plans" && <PlansTab />}
      </main>
    </div>
  );
}

function DashboardTab({ data, loading }) {
  if (loading) return <div className="adm-loading">Đang tải...</div>;
  if (!data) return <div className="adm-empty">Không lấy được dữ liệu</div>;

  const cards = [
    { label: "Tổng users", value: data.users?.total ?? 0, icon: "👥" },
    { label: "Gói Pro", value: data.users?.pro ?? 0, icon: "⭐" },
    { label: "Gói Business", value: data.users?.business ?? 0, icon: "💼" },
    { label: "Doanh thu", value: (data.revenue ?? 0).toLocaleString("vi-VN") + "đ", icon: "💰" },
    { label: "Providers", value: `${data.providers?.active ?? 0}/${data.providers?.total ?? 0}`, icon: "🔌" },
    { label: "Agents", value: data.agents ?? 0, icon: "🤖" },
    { label: "Tasks", value: data.tasks ?? 0, icon: "📋" },
    { label: "Runs OK", value: data.runs?.completed ?? 0, icon: "✅" },
    { label: "Runs Lỗi", value: data.runs?.failed ?? 0, icon: "❌" },
    { label: "Templates", value: data.templates ?? 0, icon: "📝" },
    { label: "Memories", value: data.memories ?? 0, icon: "🧠" },
    { label: "Free limit/ngày", value: data.freePlanLimit ?? "10", icon: "🆓" },
  ];

  return (
    <div className="adm-content">
      <h2 className="adm-title">Dashboard</h2>
      <div className="adm-cards">
        {cards.map(c => (
          <div key={c.label} className="adm-card">
            <div className="adm-card-icon">{c.icon}</div>
            <div className="adm-card-value">{c.value}</div>
            <div className="adm-card-label">{c.label}</div>
          </div>
        ))}
      </div>
      <div className="adm-row">
        <div className="adm-panel">
          <h3>Task gần đây</h3>
          {(data.recentTasks || []).map(t => (
            <div key={t._id} className="adm-row-item">
              <span className="adm-item-title">{t.title}</span>
              <span className={`adm-badge badge-${t.status}`}>{t.status}</span>
            </div>
          ))}
          {!data.recentTasks?.length && <div className="adm-muted">Chưa có task</div>}
        </div>
        <div className="adm-panel">
          <h3>Run gần đây</h3>
          {(data.recentRuns || []).map(r => (
            <div key={r._id} className="adm-row-item">
              <span className="adm-item-title">{r.agentId?.name || "Agent"}</span>
              <span className={`adm-badge badge-${r.status}`}>{r.status}</span>
            </div>
          ))}
          {!data.recentRuns?.length && <div className="adm-muted">Chưa có run</div>}
        </div>
      </div>
    </div>
  );
}

function UsersTab() {
  const [users, setUsers] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const API = (import.meta.env.VITE_API_URL || "https://api.workaivn.com/api").replace(/\/api$/, "");

  async function load() {
    setLoading(true);
    try {
      const r = await apiGet(`/admin/users?q=${encodeURIComponent(q)}`);
      const d = await r.json();
      setUsers(Array.isArray(d) ? d : []);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function setPlan(id, plan) {
    try {
      const r = await fetch(`${API}/api/admin/user/${id}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + localStorage.getItem("token") },
        body: JSON.stringify({ plan })
      });
      if (r.ok) { setMsg("Đã cập nhật plan"); load(); }
    } catch {}
  }

  return (
    <div className="adm-content">
      <h2 className="adm-title">Người dùng</h2>
      {msg && <div className="adm-toast">{msg}</div>}
      <div className="adm-toolbar">
        <input className="adm-input" placeholder="Tìm email..." value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && load()} />
        <button className="adm-btn-primary" onClick={load}>Tìm</button>
      </div>
      {loading ? <div className="adm-loading">Đang tải...</div> : (
        <table className="adm-table">
          <thead><tr><th>Email</th><th>Plan</th><th>Ngày tạo</th><th>Thao tác</th></tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u._id}>
                <td>{u.email}</td>
                <td><span className={`adm-badge badge-${u.plan || "free"}`}>{u.plan || "free"}</span></td>
                <td>{new Date(u.createdAt).toLocaleDateString("vi-VN")}</td>
                <td>
                  <select className="adm-select-sm" defaultValue={u.plan || "free"} onChange={e => setPlan(u._id, e.target.value)}>
                    <option value="free">Free</option>
                    <option value="pro">Pro</option>
                    <option value="business">Business</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ProvidersTab() {
  const [list, setList] = useState([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [msg, setMsg] = useState("");
  const [seeding, setSeeding] = useState(false);
  const API = (import.meta.env.VITE_API_URL || "https://api.workaivn.com/api").replace(/\/api$/, "");

  async function load() {
    try {
      const r = await apiGet("/admin/providers");
      const d = await r.json();
      setList(d.data || []);
    } catch {}
  }

  useEffect(() => { load(); }, []);

  async function seedAgents() {
    setSeeding(true);
    try {
      const r = await fetch(`${API}/api/admin/seed-agents`, {
        method: "POST",
        headers: { Authorization: "Bearer " + localStorage.getItem("token") }
      });
      const d = await r.json();
      setMsg(d.message || (d.success ? "✅ Seed xong" : "❌ Lỗi"));
      load();
    } catch (e) {
      setMsg("❌ " + e.message);
    }
    setSeeding(false);
    setTimeout(() => setMsg(""), 6000);
  }

  async function save() {
    const method = form._id ? "PATCH" : "POST";
    const url = form._id ? `${API}/api/admin/providers/${form._id}` : `${API}/api/admin/providers`;
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + localStorage.getItem("token") }, body: JSON.stringify(form) });
    const d = await r.json();
    if (d.success) { setMsg("Đã lưu"); setEditing(false); load(); } else { setMsg(d.message || "Lỗi"); }
  }

  async function testConn(id) {
    const r = await fetch(`${API}/api/admin/providers/${id}/test`, { method: "POST", headers: { Authorization: "Bearer " + localStorage.getItem("token") } });
    const d = await r.json();
    setMsg(d.message || (d.success ? "OK" : "Lỗi"));
    setTimeout(() => setMsg(""), 4000);
  }

  async function remove(id) {
    if (!confirm("Xóa provider này?")) return;
    const r = await fetch(`${API}/api/admin/providers/${id}`, { method: "DELETE", headers: { Authorization: "Bearer " + localStorage.getItem("token") } });
    const d = await r.json();
    if (d.success) load(); else setMsg(d.message);
  }

  function startEdit(p) {
    setForm(p || { name: "", code: "", type: "api", baseUrl: "", apiKeyEnv: "", isActive: true });
    setEditing(true);
  }

  return (
    <div className="adm-content">
      <div className="adm-header-row">
        <h2 className="adm-title">AI Providers</h2>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="adm-btn-ghost" onClick={seedAgents} disabled={seeding}>
            {seeding ? "Đang seed..." : "🌱 Seed Providers & Agents"}
          </button>
          <button className="adm-btn-primary" onClick={() => startEdit(null)}>+ Thêm Provider</button>
        </div>
      </div>
      {msg && <div className="adm-toast">{msg}</div>}
      {editing && (
        <div className="adm-form-card">
          <h3>{form._id ? "Sửa" : "Thêm"} Provider</h3>
          {["name","code","baseUrl","apiKeyEnv"].map(f => (
            <div key={f} className="adm-form-row">
              <label className="adm-label">{f}</label>
              <input className="adm-input" value={form[f] || ""} onChange={e => setForm({...form, [f]: e.target.value})} />
            </div>
          ))}
          <div className="adm-form-row">
            <label className="adm-label">Type</label>
            <select className="adm-input" value={form.type || "api"} onChange={e => setForm({...form, type: e.target.value})}>
              <option value="api">api</option><option value="manual">manual</option>
            </select>
          </div>
          <div className="adm-form-row adm-checkbox-row">
            <label className="adm-label">Hoạt động</label>
            <input type="checkbox" checked={form.isActive !== false} onChange={e => setForm({...form, isActive: e.target.checked})} />
          </div>
          <div className="adm-form-actions">
            <button className="adm-btn-primary" onClick={save}>Lưu</button>
            <button className="adm-btn-ghost" onClick={() => setEditing(false)}>Hủy</button>
          </div>
        </div>
      )}
      <table className="adm-table">
        <thead><tr><th>Tên</th><th>Code</th><th>Type</th><th>Env Key</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
        <tbody>
          {list.map(p => (
            <tr key={p._id}>
              <td>{p.name}</td>
              <td><code>{p.code}</code></td>
              <td>{p.type}</td>
              <td><code>{p.apiKeyEnv}</code></td>
              <td><span className={`adm-badge ${p.isActive ? "badge-completed" : "badge-failed"}`}>{p.isActive ? "Bật" : "Tắt"}</span></td>
              <td className="adm-actions">
                <button className="adm-btn-sm" onClick={() => startEdit(p)}>Sửa</button>
                <button className="adm-btn-sm" onClick={() => testConn(p._id)}>Test</button>
                <button className="adm-btn-sm danger" onClick={() => remove(p._id)}>Xóa</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AgentsTab() {
  const [list, setList] = useState([]);
  const [providers, setProviders] = useState([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [msg, setMsg] = useState("");
  const API = (import.meta.env.VITE_API_URL || "https://api.workaivn.com/api").replace(/\/api$/, "");

  async function load() {
    try {
      const [ar, pr] = await Promise.all([apiGet("/admin/agents"), apiGet("/admin/providers")]);
      const ad = await ar.json(); const pd = await pr.json();
      setList(ad.data || []); setProviders(pd.data || []);
    } catch {}
  }
  useEffect(() => { load(); }, []);

  function startEdit(a) {
    setForm(a ? { ...a, providerId: a.providerId?._id || a.providerId } : {
      name: "", code: "", description: "", modelName: "gpt-4o-mini",
      agentType: "coding", systemPrompt: "", temperature: 0.7, maxTokens: 2000, isActive: true
    });
    setEditing(true);
  }

  async function save() {
    const method = form._id ? "PATCH" : "POST";
    const url = form._id ? `${API}/api/admin/agents/${form._id}` : `${API}/api/admin/agents`;
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + localStorage.getItem("token") }, body: JSON.stringify(form) });
    const d = await r.json();
    if (d.success) { setMsg("Đã lưu"); setEditing(false); load(); } else { setMsg(d.message || "Lỗi"); }
  }

  async function duplicate(id) {
    const r = await fetch(`${API}/api/admin/agents/${id}/duplicate`, { method: "POST", headers: { Authorization: "Bearer " + localStorage.getItem("token") } });
    if (r.ok) { setMsg("Đã nhân bản"); load(); }
  }

  async function remove(id) {
    if (!confirm("Xóa agent này?")) return;
    const r = await fetch(`${API}/api/admin/agents/${id}`, { method: "DELETE", headers: { Authorization: "Bearer " + localStorage.getItem("token") } });
    if (r.ok) load();
  }

  return (
    <div className="adm-content">
      <div className="adm-header-row">
        <h2 className="adm-title">Agents</h2>
        <button className="adm-btn-primary" onClick={() => startEdit(null)}>+ Thêm Agent</button>
      </div>
      {msg && <div className="adm-toast">{msg}</div>}
      {editing && (
        <div className="adm-form-card">
          <h3>{form._id ? "Sửa" : "Thêm"} Agent</h3>
          {[{f:"name",l:"Tên"},{f:"code",l:"Code"},{f:"description",l:"Mô tả"},{f:"modelName",l:"Model"},{f:"temperature",l:"Temperature"},{f:"maxTokens",l:"Max Tokens"}].map(({f,l}) => (
            <div key={f} className="adm-form-row">
              <label className="adm-label">{l}</label>
              <input className="adm-input" value={form[f] ?? ""} onChange={e => setForm({...form, [f]: e.target.value})} />
            </div>
          ))}
          <div className="adm-form-row">
            <label className="adm-label">Provider</label>
            <select className="adm-input" value={form.providerId || ""} onChange={e => setForm({...form, providerId: e.target.value})}>
              <option value="">-- Chọn --</option>
              {providers.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
            </select>
          </div>
          <div className="adm-form-row">
            <label className="adm-label">Type</label>
            <select className="adm-input" value={form.agentType || "coding"} onChange={e => setForm({...form, agentType: e.target.value})}>
              {["coding","documentation","testing","refactoring","manual"].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="adm-form-row">
            <label className="adm-label">System Prompt</label>
            <textarea className="adm-input" rows={4} value={form.systemPrompt || ""} onChange={e => setForm({...form, systemPrompt: e.target.value})} />
          </div>
          <div className="adm-form-actions">
            <button className="adm-btn-primary" onClick={save}>Lưu</button>
            <button className="adm-btn-ghost" onClick={() => setEditing(false)}>Hủy</button>
          </div>
        </div>
      )}
      <table className="adm-table">
        <thead><tr><th>Tên</th><th>Provider</th><th>Model</th><th>Type</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
        <tbody>
          {list.map(a => (
            <tr key={a._id}>
              <td>{a.name}</td>
              <td>{a.providerId?.name || "—"}</td>
              <td><code>{a.modelName}</code></td>
              <td>{a.agentType}</td>
              <td><span className={`adm-badge ${a.isActive ? "badge-completed" : "badge-failed"}`}>{a.isActive ? "Bật" : "Tắt"}</span></td>
              <td className="adm-actions">
                <button className="adm-btn-sm" onClick={() => startEdit(a)}>Sửa</button>
                <button className="adm-btn-sm" onClick={() => duplicate(a._id)}>Copy</button>
                <button className="adm-btn-sm danger" onClick={() => remove(a._id)}>Xóa</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TemplatesTab() {
  const [list, setList] = useState([]);
  useEffect(() => {
    apiGet("/admin/templates").then(r => r.json()).then(d => setList(d.data || [])).catch(() => {});
  }, []);
  return (
    <div className="adm-content">
      <h2 className="adm-title">Prompt Templates</h2>
      <table className="adm-table">
        <thead><tr><th>Tiêu đề</th><th>Task Type</th><th>Mô tả</th></tr></thead>
        <tbody>
          {list.map(t => (
            <tr key={t._id}>
              <td>{t.title}</td>
              <td><code>{t.taskType}</code></td>
              <td>{t.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!list.length && <div className="adm-empty">Chưa có template</div>}
    </div>
  );
}

function ConfigTab() {
  const [settings, setSettings] = useState([]);
  const [activeGroup, setActiveGroup] = useState("general");
  const [localVals, setLocalVals] = useState({});
  const [msg, setMsg] = useState("");
  const API = (import.meta.env.VITE_API_URL || "https://api.workaivn.com/api").replace(/\/api$/, "");

  const GROUPS = [
    { key: "general", label: "⚙️ General" },
    { key: "branding", label: "🎨 Branding" },
    { key: "auth", label: "🔐 Auth" },
    { key: "ai_providers", label: "🤖 AI Providers" },
    { key: "agent_hub", label: "🧩 Agent Hub" },
    { key: "plans", label: "💳 Plans" },
    { key: "payment", label: "💰 Payment" },
    { key: "email", label: "📧 Email" },
    { key: "storage", label: "📦 Storage" },
    { key: "security", label: "🛡️ Security" },
  ];

  async function loadGroup(group) {
    try {
      const r = await apiGet(`/admin/config/${group}`);
      const d = await r.json();
      setSettings(d.data || []);
      const map = {};
      (d.data || []).forEach(s => { map[s.key] = s.value; });
      setLocalVals(map);
    } catch {}
  }

  useEffect(() => { loadGroup(activeGroup); }, [activeGroup]);

  async function saveKey(key) {
    const r = await fetch(`${API}/api/admin/config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + localStorage.getItem("token") },
      body: JSON.stringify({ key, value: localVals[key] ?? "" })
    });
    const d = await r.json();
    setMsg(d.success ? "✅ Đã lưu " + key : "❌ " + (d.message || "Lỗi"));
    setTimeout(() => setMsg(""), 3000);
  }

  return (
    <div className="adm-content">
      <h2 className="adm-title">Config Center</h2>
      {msg && <div className="adm-toast">{msg}</div>}
      <div className="adm-config-layout">
        <nav className="adm-config-nav">
          {GROUPS.map(g => (
            <button key={g.key} className={`adm-config-nav-btn ${activeGroup === g.key ? "active" : ""}`} onClick={() => setActiveGroup(g.key)}>
              {g.label}
            </button>
          ))}
        </nav>
        <div className="adm-config-body">
          {settings.map(s => (
            <div key={s.key} className="adm-setting-row">
              <div className="adm-setting-meta">
                <div className="adm-setting-label">{s.label || s.key}</div>
                <div className="adm-setting-key"><code>{s.key}</code></div>
                {s.description && <div className="adm-setting-desc">{s.description}</div>}
              </div>
              <div className="adm-setting-control">
                {s.type === "boolean" ? (
                  <select className="adm-input" value={localVals[s.key] ?? s.value} onChange={e => setLocalVals({...localVals, [s.key]: e.target.value})}>
                    <option value="true">Bật</option>
                    <option value="false">Tắt</option>
                  </select>
                ) : s.type === "secret" ? (
                  <input type="password" className="adm-input" placeholder="Nhập để thay đổi (trống = giữ cũ)"
                    value={localVals[s.key] === "••••••••" ? "" : (localVals[s.key] ?? "")}
                    onChange={e => setLocalVals({...localVals, [s.key]: e.target.value})}
                    readOnly={s.isReadOnly}
                  />
                ) : (
                  <input type="text" className="adm-input" value={localVals[s.key] ?? s.value}
                    onChange={e => setLocalVals({...localVals, [s.key]: e.target.value})}
                    readOnly={s.isReadOnly}
                  />
                )}
                <button className="adm-btn-sm" onClick={() => saveKey(s.key)} disabled={s.isReadOnly}>Lưu</button>
              </div>
            </div>
          ))}
          {!settings.length && <div className="adm-empty">Chưa có config. Chạy seed-settings.js trước.</div>}
        </div>
      </div>
    </div>
  );
}

function PlansTab() {
  const [settings, setSettings] = useState([]);
  const [localVals, setLocalVals] = useState({});
  const [msg, setMsg] = useState("");
  const API = (import.meta.env.VITE_API_URL || "https://api.workaivn.com/api").replace(/\/api$/, "");

  useEffect(() => {
    apiGet("/admin/config/plans").then(r => r.json()).then(d => {
      setSettings(d.data || []);
      const map = {};
      (d.data || []).forEach(s => { map[s.key] = s.value; });
      setLocalVals(map);
    }).catch(() => {});
  }, []);

  async function saveAll() {
    const updates = settings.map(s => ({ key: s.key, value: localVals[s.key] ?? s.value }));
    const r = await fetch(`${API}/api/admin/config/plans`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + localStorage.getItem("token") },
      body: JSON.stringify({ updates })
    });
    const d = await r.json();
    setMsg(d.success ? "✅ Đã lưu tất cả" : "❌ " + (d.message || "Lỗi"));
    setTimeout(() => setMsg(""), 3000);
  }

  const planGroups = {
    "Gói Free": settings.filter(s => s.key.startsWith("FREE_")),
    "Gói Pro": settings.filter(s => s.key.startsWith("PRO_")),
    "Gói Business": settings.filter(s => s.key.startsWith("BUSINESS_")),
    "Cài đặt chung": settings.filter(s => !s.key.startsWith("FREE_") && !s.key.startsWith("PRO_") && !s.key.startsWith("BUSINESS_")),
  };

  return (
    <div className="adm-content">
      <div className="adm-header-row">
        <h2 className="adm-title">Plans & Giới hạn</h2>
        <button className="adm-btn-primary" onClick={saveAll}>Lưu tất cả</button>
      </div>
      {msg && <div className="adm-toast">{msg}</div>}
      {Object.entries(planGroups).map(([groupName, items]) => items.length === 0 ? null : (
        <div key={groupName} className="adm-plan-group">
          <h3 className="adm-plan-group-title">{groupName}</h3>
          <div className="adm-plan-grid">
            {items.map(s => (
              <div key={s.key} className="adm-plan-field">
                <label className="adm-label">{s.label || s.key}</label>
                <input className="adm-input" type={s.type === "number" ? "number" : "text"}
                  value={localVals[s.key] ?? s.value}
                  onChange={e => setLocalVals({...localVals, [s.key]: e.target.value})}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
      {!settings.length && <div className="adm-empty">Chưa có dữ liệu. Chạy seed-settings.js trước.</div>}
    </div>
  );
}
