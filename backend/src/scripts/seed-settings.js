/**
 * seed-settings.js
 * Seed SystemSetting với tất cả config WorkAIVN
 * Usage: node src/scripts/seed-settings.js
 */
import "dotenv/config";
import mongoose from "mongoose";
import SystemSetting from "../models/SystemSetting.js";

await mongoose.connect(process.env.MONGO_URI || "mongodb+srv://workaivn:WdhI0UjYBcOMZLCS@cluster0.wohpjri.mongodb.net/?appName=Cluster0");

const settings = [
  // ── GENERAL ─────────────────────────────────────────────
  { key: "APP_NAME", value: "WorkAIVN", type: "string", group: "general", label: "Tên ứng dụng", isPublic: true },
  { key: "APP_URL", value: "https://app.workaivn.com", type: "url", group: "general", label: "URL ứng dụng", isPublic: true },
  { key: "APP_ENV", value: "production", type: "string", group: "general", label: "Môi trường" },
  { key: "SUPPORT_EMAIL", value: "support@workaivn.com", type: "string", group: "general", label: "Email hỗ trợ", isPublic: true },
  { key: "DEFAULT_LANGUAGE", value: "vi", type: "string", group: "general", label: "Ngôn ngữ mặc định", isPublic: true },
  { key: "MAINTENANCE_MODE", value: "false", type: "boolean", group: "general", label: "Chế độ bảo trì" },

  // ── BRANDING ─────────────────────────────────────────────
  { key: "APP_LOGO_URL", value: "/logo.png", type: "url", group: "branding", label: "URL Logo", isPublic: true },
  { key: "BRAND_PRIMARY_COLOR", value: "#4f46e5", type: "string", group: "branding", label: "Màu chính", isPublic: true },
  { key: "BRAND_SECONDARY_COLOR", value: "#667eea", type: "string", group: "branding", label: "Màu phụ", isPublic: true },
  { key: "LANDING_HERO_TITLE", value: "WorkAIVN — AI Agent Hub cho công việc và lập trình", type: "string", group: "branding", label: "Hero Title", isPublic: true },
  { key: "LANDING_HERO_SUBTITLE", value: "Gửi một yêu cầu, chia task thành nhiều phase, chạy qua nhiều AI Agent, lưu lịch sử và so sánh kết quả.", type: "string", group: "branding", label: "Hero Subtitle", isPublic: true },
  { key: "LANDING_CTA_TEXT", value: "Bắt đầu miễn phí", type: "string", group: "branding", label: "CTA Text", isPublic: true },

  // ── AUTH ─────────────────────────────────────────────────
  { key: "JWT_SECRET", value: process.env.JWT_SECRET || "", type: "secret", group: "auth", label: "JWT Secret", isSecret: true, isReadOnly: true, description: "Không nên đổi runtime" },
  { key: "ACCESS_TOKEN_EXPIRES_IN", value: "7d", type: "string", group: "auth", label: "Token hết hạn sau" },
  { key: "ENABLE_REGISTER", value: "true", type: "boolean", group: "auth", label: "Cho phép đăng ký" },
  { key: "ENABLE_EMAIL_LOGIN", value: "true", type: "boolean", group: "auth", label: "Cho phép đăng nhập email" },

  // ── AI PROVIDERS ─────────────────────────────────────────
  { key: "OPENAI_API_KEY", value: process.env.OPENAI_API_KEY || "", type: "secret", group: "ai_providers", label: "OpenAI API Key", isSecret: true },
  { key: "OPENAI_BASE_URL", value: "https://api.openai.com/v1", type: "url", group: "ai_providers", label: "OpenAI Base URL" },
  { key: "OPENAI_DEFAULT_MODEL", value: "gpt-4o-mini", type: "string", group: "ai_providers", label: "OpenAI Model mặc định" },
  { key: "GEMINI_API_KEY", value: process.env.GEMINI_API_KEY || "", type: "secret", group: "ai_providers", label: "Gemini API Key", isSecret: true },
  { key: "GEMINI_DEFAULT_MODEL", value: "gemini-1.5-flash", type: "string", group: "ai_providers", label: "Gemini Model mặc định" },
  { key: "ANTHROPIC_API_KEY", value: process.env.ANTHROPIC_API_KEY || "", type: "secret", group: "ai_providers", label: "Anthropic API Key", isSecret: true },
  { key: "ANTHROPIC_DEFAULT_MODEL", value: "claude-3-haiku-20240307", type: "string", group: "ai_providers", label: "Anthropic Model mặc định" },
  { key: "OPENROUTER_API_KEY", value: process.env.OPENROUTER_API_KEY || "", type: "secret", group: "ai_providers", label: "OpenRouter API Key", isSecret: true },
  { key: "OPENROUTER_DEFAULT_MODEL", value: "mistralai/mistral-7b-instruct", type: "string", group: "ai_providers", label: "OpenRouter Model mặc định" },
  { key: "DEFAULT_AI_PROVIDER", value: "openai", type: "string", group: "ai_providers", label: "Provider AI mặc định" },
  { key: "AI_REQUEST_TIMEOUT", value: "30000", type: "number", group: "ai_providers", label: "AI Request Timeout (ms)" },

  // ── AGENT HUB ────────────────────────────────────────────
  { key: "ENABLE_AGENT_HUB", value: "true", type: "boolean", group: "agent_hub", label: "Bật Agent Hub", isPublic: true },
  { key: "ENABLE_MULTI_AGENT_RUN", value: "true", type: "boolean", group: "agent_hub", label: "Cho phép Multi-Agent Run" },
  { key: "ENABLE_PROJECT_MEMORY", value: "true", type: "boolean", group: "agent_hub", label: "Bật Project Memory", isPublic: true },
  { key: "MAX_RUNS_PER_TASK", value: "10", type: "number", group: "agent_hub", label: "Số lần run tối đa / task" },
  { key: "MAX_PROMPT_LENGTH", value: "8000", type: "number", group: "agent_hub", label: "Độ dài prompt tối đa" },
  { key: "TASK_HISTORY_LIMIT", value: "50", type: "number", group: "agent_hub", label: "Giới hạn lịch sử task" },

  // ── PLANS ────────────────────────────────────────────────
  { key: "FREE_PLAN_NAME", value: "Free", type: "string", group: "plans", label: "Tên gói Free", isPublic: true },
  { key: "FREE_PLAN_PRICE", value: "0", type: "number", group: "plans", label: "Giá gói Free", isPublic: true },
  { key: "FREE_PLAN_CHAT_LIMIT", value: "10", type: "number", group: "plans", label: "Chat/ngày (Free)", isPublic: true },
  { key: "FREE_PLAN_FILE_LIMIT", value: "3", type: "number", group: "plans", label: "File/ngày (Free)" },
  { key: "FREE_PLAN_IMAGE_LIMIT", value: "2", type: "number", group: "plans", label: "Ảnh/ngày (Free)" },
  { key: "FREE_PLAN_TOOL_LIMIT", value: "5", type: "number", group: "plans", label: "Tool/ngày (Free)" },
  { key: "PRO_PLAN_NAME", value: "Pro", type: "string", group: "plans", label: "Tên gói Pro", isPublic: true },
  { key: "PRO_PLAN_PRICE", value: "99000", type: "number", group: "plans", label: "Giá gói Pro (VNĐ)", isPublic: true },
  { key: "PRO_PLAN_CHAT_LIMIT", value: "200", type: "number", group: "plans", label: "Chat/ngày (Pro)" },
  { key: "PRO_PLAN_FILE_LIMIT", value: "30", type: "number", group: "plans", label: "File/ngày (Pro)" },
  { key: "PRO_PLAN_IMAGE_LIMIT", value: "20", type: "number", group: "plans", label: "Ảnh/ngày (Pro)" },
  { key: "PRO_PLAN_TOOL_LIMIT", value: "100", type: "number", group: "plans", label: "Tool/ngày (Pro)" },
  { key: "BUSINESS_PLAN_NAME", value: "Business", type: "string", group: "plans", label: "Tên gói Business", isPublic: true },
  { key: "BUSINESS_PLAN_PRICE", value: "499000", type: "number", group: "plans", label: "Giá gói Business (VNĐ)", isPublic: true },
  { key: "ENABLE_UPGRADE_BUTTON", value: "true", type: "boolean", group: "plans", label: "Hiện nút Nâng cấp", isPublic: true },
  { key: "UPGRADE_BUTTON_TEXT", value: "🚀 Nâng cấp", type: "string", group: "plans", label: "Text nút Nâng cấp", isPublic: true },

  // ── PAYMENT ──────────────────────────────────────────────
  { key: "ENABLE_PAYMENT", value: "true", type: "boolean", group: "payment", label: "Bật thanh toán" },
  { key: "CURRENCY", value: "VND", type: "string", group: "payment", label: "Đơn vị tiền tệ" },
  { key: "BILLING_PROVIDER", value: "sepay", type: "string", group: "payment", label: "Nhà cung cấp thanh toán" },
  { key: "SEPAY_API_KEY", value: process.env.SEPAY_API_KEY || "", type: "secret", group: "payment", label: "SePay API Key", isSecret: true },

  // ── EMAIL ────────────────────────────────────────────────
  { key: "ENABLE_EMAIL", value: "true", type: "boolean", group: "email", label: "Bật gửi email" },
  { key: "SMTP_HOST", value: process.env.SMTP_HOST || "", type: "string", group: "email", label: "SMTP Host" },
  { key: "SMTP_PORT", value: process.env.SMTP_PORT || "587", type: "number", group: "email", label: "SMTP Port" },
  { key: "SMTP_USER", value: process.env.SMTP_USER || "", type: "string", group: "email", label: "SMTP User" },
  { key: "SMTP_PASS", value: process.env.SMTP_PASS || "", type: "secret", group: "email", label: "SMTP Password", isSecret: true },
  { key: "SMTP_FROM", value: "noreply@workaivn.com", type: "string", group: "email", label: "Email gửi đi" },

  // ── STORAGE ──────────────────────────────────────────────
  { key: "STORAGE_PROVIDER", value: "cloudinary", type: "string", group: "storage", label: "Storage Provider" },
  { key: "ENABLE_FILE_UPLOAD", value: "true", type: "boolean", group: "storage", label: "Bật upload file" },
  { key: "MAX_UPLOAD_SIZE", value: "10", type: "number", group: "storage", label: "Kích thước file tối đa (MB)" },
  { key: "CLOUDINARY_CLOUD_NAME", value: process.env.CLOUDINARY_CLOUD_NAME || "", type: "string", group: "storage", label: "Cloudinary Cloud Name" },
  { key: "CLOUDINARY_API_KEY", value: process.env.CLOUDINARY_API_KEY || "", type: "secret", group: "storage", label: "Cloudinary API Key", isSecret: true },
  { key: "CLOUDINARY_API_SECRET", value: process.env.CLOUDINARY_API_SECRET || "", type: "secret", group: "storage", label: "Cloudinary API Secret", isSecret: true },

  // ── SECURITY ─────────────────────────────────────────────
  { key: "RATE_LIMIT_ENABLED", value: "true", type: "boolean", group: "security", label: "Bật Rate Limit" },
  { key: "RATE_LIMIT_WINDOW", value: "900000", type: "number", group: "security", label: "Rate Limit Window (ms)" },
  { key: "RATE_LIMIT_MAX", value: "100", type: "number", group: "security", label: "Rate Limit Max requests" },
  { key: "CORS_ORIGIN", value: "https://app.workaivn.com", type: "string", group: "security", label: "CORS Origin" },
  { key: "ENABLE_ADMIN_ONLY_MODE", value: "false", type: "boolean", group: "security", label: "Chế độ chỉ admin" },
];

let created = 0;
let skipped = 0;

for (const s of settings) {
  const exists = await SystemSetting.findOne({ key: s.key });
  if (exists) {
    skipped++;
    continue;
  }
  await SystemSetting.create({ defaultValue: s.value, ...s });
  created++;
}

console.log(`✅ Seed xong: ${created} created, ${skipped} skipped`);
await mongoose.disconnect();
