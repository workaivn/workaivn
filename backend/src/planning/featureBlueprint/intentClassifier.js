import { INTENT_TYPES } from "./types.js";

function normalizeText(value = "") {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function lower(value = "") {
  return normalizeText(value).toLowerCase();
}

export function detectIntent(prompt = "") {
  const text = normalizeText(prompt);
  const l = lower(text);

  const isFeatureAdd = /\b(add|extend|update)\b/i.test(text) && /\b(feature|module|section|screen|page|report|form|crud)\b/i.test(text);
  const isModify = /\b(modify|update|refactor|rewrite|fix|repair|correct)\b/i.test(text) && /\b(ui|interface|screen|page|layout|component|dashboard|app|site|website)\b/i.test(text);

  const intentType =
    /\b(rest api|api server|backend api|express api)\b/i.test(text) ? INTENT_TYPES.API_SERVER :
    /\bweb ban hang\b|\becommerce\b|\bonline store\b|\bshop\b/i.test(text) ? INTENT_TYPES.ECOMMERCE :
    /\bbenh vien\b|\bphong kham\b|\bclinic\b|\bhospital\b/i.test(text) ? INTENT_TYPES.HOSPITAL :
    /\bdashboard\b|\bquan tri\b|\breport\b|\banalytics\b|\badmin panel\b/i.test(text) ? INTENT_TYPES.DASHBOARD :
    /\blanding page\b|\bhero\b|\bintro\b|\bmarketing site\b/i.test(text) ? INTENT_TYPES.LANDING_PAGE :
    /\bcrud\b|\bquan ly\b|\bmanage\b|\badministration\b/i.test(text) ? INTENT_TYPES.CRUD_MODULE :
    /\bsaas\b|\btool\b|\binternal tool\b|\bsoftware as a service\b/i.test(text) ? INTENT_TYPES.SAAS :
    /\bblog\b|\bnews\b/i.test(text) ? INTENT_TYPES.BLOG :
    /\bportfolio\b/i.test(text) ? INTENT_TYPES.PORTFOLIO :
    /\bform workflow\b|\bworkflow\b|\bonboarding\b/i.test(text) ? INTENT_TYPES.FORM_WORKFLOW :
    isFeatureAdd ? INTENT_TYPES.FEATURE_ADD :
    isModify ? INTENT_TYPES.MODIFY_UI :
    /\brefactor\b/i.test(text) ? INTENT_TYPES.REFRACTOR_UI :
    /\bfix\b|\bbroken\b/i.test(text) ? INTENT_TYPES.FIX_BROKEN_UI :
    /\bnew\b|\bcreate\b|\bbuild\b|\btao\b/i.test(text) ? INTENT_TYPES.NEW_WEBSITE :
    INTENT_TYPES.UNKNOWN;

  return {
    prompt: text,
    lower: l,
    intentType,
    isFeatureAdd,
    isModify,
    keywords: l.split(/\s+/).filter(Boolean)
  };
}

