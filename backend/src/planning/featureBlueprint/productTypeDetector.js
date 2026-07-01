import { PRODUCT_TYPES } from "./types.js";

function includesAny(text = "", terms = []) {
  const lower = String(text || "").toLowerCase();
  return terms.some(term => lower.includes(String(term).toLowerCase()));
}

export function detectProductType(prompt = "", intent = {}, workspaceContext = {}) {
  const text = String(prompt || "");
  const currentIntent = intent || {};
  const existingFiles = Array.isArray(workspaceContext?.existingFiles) ? workspaceContext.existingFiles : [];
  const lowerFiles = new Set(existingFiles.map(file => String(file || "").replace(/\\/g, "/").toLowerCase()));

  if (lowerFiles.has("index.php") || lowerFiles.has("public/index.php")) return PRODUCT_TYPES.MODIFY_UI;
  if (existingFiles.some(file => /\.csproj$/i.test(String(file || "")))) return PRODUCT_TYPES.MODIFY_UI;
  if (lowerFiles.has("next.config.js") || lowerFiles.has("next.config.ts")) return PRODUCT_TYPES.SAAS_APP;
  if (lowerFiles.has("vite.config.ts") || lowerFiles.has("vite.config.js")) return PRODUCT_TYPES.SAAS_APP;
  if (lowerFiles.has("src/server.js") || lowerFiles.has("server.js")) return PRODUCT_TYPES.API_SERVER;
  if (lowerFiles.has("index.html")) return PRODUCT_TYPES.LANDING_PAGE;

  if (includesAny(text, ["api server", "rest api", "backend", "express"])) return PRODUCT_TYPES.API_SERVER;
  if (includesAny(text, ["dashboard", "admin panel", "admin", "portal"])) return PRODUCT_TYPES.FINANCE_DASHBOARD;
  if (includesAny(text, ["saas", "crm", "erp", "tool"])) return PRODUCT_TYPES.SAAS_APP;
  if (includesAny(text, ["blog", "news"])) return PRODUCT_TYPES.BLOG_NEWS;
  if (includesAny(text, ["portfolio"])) return PRODUCT_TYPES.PORTFOLIO;
  if (includesAny(text, ["workflow"])) return PRODUCT_TYPES.FORM_WORKFLOW;
  if (includesAny(text, ["report"])) return PRODUCT_TYPES.REPORT_PAGE;
  if (includesAny(text, ["ecommerce", "shop", "store"])) return PRODUCT_TYPES.ECOMMERCE;
  if (includesAny(text, ["hospital", "clinic", "phong kham", "benh vien"])) return PRODUCT_TYPES.HOSPITAL_SITE;
  if (includesAny(text, ["landing page", "marketing site", "hero", "cta"])) return PRODUCT_TYPES.LANDING_PAGE;

  if (currentIntent.intentType === "create_api_server") return PRODUCT_TYPES.API_SERVER;
  if (currentIntent.intentType === "create_dashboard") return PRODUCT_TYPES.FINANCE_DASHBOARD;
  if (currentIntent.intentType === "create_saas_app") return PRODUCT_TYPES.SAAS_APP;
  if (currentIntent.intentType === "create_blog_news_site") return PRODUCT_TYPES.BLOG_NEWS;
  if (currentIntent.intentType === "create_portfolio") return PRODUCT_TYPES.PORTFOLIO;
  if (currentIntent.intentType === "create_form_workflow") return PRODUCT_TYPES.FORM_WORKFLOW;
  if (currentIntent.intentType === "create_report_page") return PRODUCT_TYPES.REPORT_PAGE;
  if (currentIntent.intentType === "create_ecommerce_site") return PRODUCT_TYPES.ECOMMERCE;
  if (currentIntent.intentType === "create_hospital_clinic_site") return PRODUCT_TYPES.HOSPITAL_SITE;
  if (currentIntent.intentType === "create_landing_page") return PRODUCT_TYPES.LANDING_PAGE;
  if (currentIntent.intentType === "modify_existing_ui") return PRODUCT_TYPES.MODIFY_UI;
  if (currentIntent.intentType === "refactor_ui") return PRODUCT_TYPES.REFRACTOR_UI;
  if (currentIntent.intentType === "fix_broken_ui") return PRODUCT_TYPES.FIX_BROKEN_UI;

  return PRODUCT_TYPES.UNKNOWN;
}
