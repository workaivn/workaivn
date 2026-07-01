export { buildUIPlan, getUIPlanCache, loadUIPlan } from "./planner.js";
export { loadUIPlan as loadUIPlanFile, saveUIPlan } from "./serializer.js";
export { analyzeLayouts } from "./layoutAnalyzer.js";
export { analyzeNavigation } from "./navigationAnalyzer.js";
export { analyzeWidgets } from "./widgetAnalyzer.js";
export { analyzeResponsive } from "./responsiveAnalyzer.js";
export { analyzeForms } from "./formAnalyzer.js";
export { analyzeFlows } from "./flowAnalyzer.js";
export { validateUIPlan } from "./validator.js";
export {
  analyzeSourceFile,
  collectMatches,
  detectPageKind,
  flowLabelFromText,
  hasPattern,
  hashContent,
  isTextCandidate,
  kindFromNameOrText,
  makeId,
  mergeLabels,
  navigationLabelFromText,
  responsiveLabelFromText,
  titleFromPath,
  widgetLabelFromText,
  normalizePath,
  unique
} from "./shared.js";
export { UI_LOG_EVENTS, UI_PLAN_VERSION } from "./types.js";

export function findPage(plan = null, query = "") {
  const needle = String(query || "").toLowerCase();
  if (!plan || !needle) return null;
  return (Array.isArray(plan.pages) ? plan.pages : []).find(page =>
    String(page.title || "").toLowerCase() === needle ||
    String(page.route || "").toLowerCase() === needle ||
    String(page.path || "").toLowerCase() === needle
  ) || null;
}

export function findLayout(plan = null, query = "") {
  const needle = String(query || "").toLowerCase();
  if (!plan || !needle) return null;
  return (Array.isArray(plan.layouts) ? plan.layouts : []).find(layout =>
    String(layout.name || "").toLowerCase() === needle ||
    String(layout.path || "").toLowerCase() === needle
  ) || null;
}

export function findWidget(plan = null, query = "") {
  const needle = String(query || "").toLowerCase();
  if (!plan || !needle) return null;
  return (Array.isArray(plan.widgets) ? plan.widgets : []).find(widget =>
    String(widget.name || "").toLowerCase() === needle ||
    String(widget.path || "").toLowerCase() === needle ||
    String(widget.kind || "").toLowerCase() === needle
  ) || null;
}

export function findForms(plan = null, query = "") {
  const needle = String(query || "").toLowerCase();
  return (Array.isArray(plan?.forms) ? plan.forms : []).filter(form =>
    !needle ||
    String(form.name || "").toLowerCase().includes(needle) ||
    String(form.path || "").toLowerCase().includes(needle)
  );
}

export function findNavigation(plan = null, query = "") {
  const needle = String(query || "").toLowerCase();
  return (Array.isArray(plan?.navigation) ? plan.navigation : []).filter(item =>
    !needle ||
    String(item.name || "").toLowerCase().includes(needle) ||
    String(item.path || "").toLowerCase().includes(needle) ||
    (Array.isArray(item.labels) && item.labels.some(label => String(label).toLowerCase().includes(needle)))
  );
}

export function findResponsive(plan = null, query = "") {
  const needle = String(query || "").toLowerCase();
  return (Array.isArray(plan?.responsive) ? plan.responsive : []).filter(item =>
    !needle ||
    String(item.path || "").toLowerCase().includes(needle) ||
    (Array.isArray(item.labels) && item.labels.some(label => String(label).toLowerCase().includes(needle)))
  );
}

export function findImpacts(plan = null, query = "") {
  const needle = String(query || "").toLowerCase();
  return (Array.isArray(plan?.impacts) ? plan.impacts : []).filter(item =>
    !needle ||
    String(item.name || "").toLowerCase().includes(needle) ||
    String(item.path || "").toLowerCase().includes(needle) ||
    (Array.isArray(item.affectedRoutes) && item.affectedRoutes.some(route => String(route).toLowerCase().includes(needle)))
  );
}

export function findDialogs(plan = null, query = "") {
  const needle = String(query || "").toLowerCase();
  return (Array.isArray(plan?.pages) ? plan.pages : []).flatMap(page => page.dialogs || []).filter(name =>
    !needle || String(name).toLowerCase().includes(needle)
  );
}

export function findFlows(plan = null, query = "") {
  const needle = String(query || "").toLowerCase();
  return (Array.isArray(plan?.flows) ? plan.flows : []).filter(item =>
    !needle ||
    String(item.name || "").toLowerCase().includes(needle) ||
    String(item.path || "").toLowerCase().includes(needle) ||
    (Array.isArray(item.labels) && item.labels.some(label => String(label).toLowerCase().includes(needle)))
  );
}

export function searchUI(plan = null, query = "") {
  const needle = String(query || "").toLowerCase();
  if (!plan || !needle) return [];
  return [
    ...(Array.isArray(plan.pages) ? plan.pages : []),
    ...(Array.isArray(plan.layouts) ? plan.layouts : []),
    ...(Array.isArray(plan.widgets) ? plan.widgets : []),
    ...(Array.isArray(plan.navigation) ? plan.navigation : []),
    ...(Array.isArray(plan.forms) ? plan.forms : []),
    ...(Array.isArray(plan.flows) ? plan.flows : []),
    ...(Array.isArray(plan.impacts) ? plan.impacts : [])
  ].filter(item =>
    String(item.title || item.name || "").toLowerCase().includes(needle) ||
    String(item.path || "").toLowerCase().includes(needle) ||
    String(item.route || "").toLowerCase().includes(needle)
  );
}

