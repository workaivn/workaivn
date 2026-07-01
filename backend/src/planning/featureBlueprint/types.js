export const FEATURE_BLUEPRINT_VERSION = 1;

export const FEATURE_BLUEPRINT_LOG_EVENTS = {
  START: "FEATURE_BLUEPRINT_START",
  INTENT: "FEATURE_INTENT_DETECTED",
  PRODUCT: "PRODUCT_TYPE_DETECTED",
  TEMPLATE: "BLUEPRINT_ARCHITECTURE_INFERRED",
  PAGE: "BLUEPRINT_PAGE_PLANNED",
  COMPONENT: "BLUEPRINT_COMPONENT_PLANNED",
  MODEL: "BLUEPRINT_MODEL_PLANNED",
  API: "BLUEPRINT_API_PLANNED",
  SCAFFOLD: "SCAFFOLD_PLAN_CREATED",
  FILE: "FILE_PLAN_CREATED",
  VALIDATED: "BLUEPRINT_VALIDATED",
  COMPLETE: "FEATURE_BLUEPRINT_COMPLETE"
};

export const FEATURE_BLUEPRINT_FILE = "feature-blueprint.json";

export const PRODUCT_TYPES = {
  ECOMMERCE: "ecommerce",
  HOSPITAL_SITE: "hospital_site",
  HOSPITAL_LANDING: "hospital_landing",
  FINANCE_DASHBOARD: "finance_dashboard",
  API_SERVER: "api_server",
  CRUD_MODULE: "crud_module",
  LANDING_PAGE: "landing_page",
  SAAS_APP: "saas_app",
  INTERNAL_TOOL: "internal_tool",
  BLOG_NEWS: "blog_news",
  PORTFOLIO: "portfolio",
  REPORT_PAGE: "report_page",
  FORM_WORKFLOW: "form_workflow",
  FEATURE_ADD: "feature_add",
  MODIFY_UI: "modify_ui",
  REFRACTOR_UI: "refactor_ui",
  FIX_BROKEN_UI: "fix_broken_ui",
  UNKNOWN: "unknown"
};

export const INTENT_TYPES = {
  NEW_WEBSITE: "create_new_website",
  LANDING_PAGE: "create_landing_page",
  DASHBOARD: "create_dashboard",
  ADMIN_PANEL: "create_admin_panel",
  API_SERVER: "create_api_server",
  CRUD_MODULE: "create_crud_module",
  ECOMMERCE: "create_ecommerce_site",
  HOSPITAL: "create_hospital_clinic_site",
  BLOG: "create_blog_news_site",
  PORTFOLIO: "create_portfolio",
  SAAS: "create_saas_app",
  INTERNAL_TOOL: "create_internal_tool",
  REPORT: "create_report_page",
  FORM_WORKFLOW: "create_form_workflow",
  MODIFY_UI: "modify_existing_ui",
  FEATURE_ADD: "add_feature_to_existing_app",
  REFRACTOR_UI: "refactor_ui",
  FIX_BROKEN_UI: "fix_broken_ui",
  UNKNOWN: "unknown"
};

export const STACKS = {
  NEXT_TS: "nextjs-ts",
  REACT_VITE_TS: "react-vite-ts",
  NODE_EXPRESS: "node-express",
  PHP_BLADE: "php-blade",
  STATIC_HTML: "generic-static-html",
  ASPNET_CORE: "aspnet-core",
  LARAVEL: "laravel",
  FASTAPI: "python-fastapi",
  FLASK: "python-flask"
};
