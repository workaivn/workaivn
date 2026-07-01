import path from "node:path";
import crypto from "node:crypto";
import {
  basenameWithoutExtension,
  detectComponentType,
  detectFrameworkFromContent,
  inferLayoutRole,
  inferRouteFromPath,
  normalizePath,
  pascalize,
  unique
} from "../componentTree/index.js";
import {
  FLOW_LABELS,
  NAVIGATION_LABELS,
  PAGE_LIKE_SEGMENTS,
  RESPONSIVE_LABELS,
  WIDGET_LABELS
} from "./types.js";

function lower(value = "") {
  return String(value || "").toLowerCase();
}

function hashContent(content = "") {
  return crypto.createHash("sha1").update(String(content || ""), "utf8").digest("hex");
}

function makeId(...parts) {
  return hashContent(parts.map(part => String(part || "")).join("::")).slice(0, 12);
}

function isTextCandidate(file = "", outputFiles = []) {
  const normalized = normalizePath(file).toLowerCase();
  const skipped = new Set((Array.isArray(outputFiles) ? outputFiles : []).map(value => normalizePath(value).toLowerCase()).filter(Boolean));
  if (skipped.has(normalized)) return false;
  return /\.(?:js|jsx|ts|tsx|mjs|cjs|mts|cts|vue|svelte|astro|php|phtml|blade\.php|twig|cshtml|aspx|jsp|jspx|html?|md|txt|json|yml|yaml|css|scss|sass|xml)$/i.test(normalized) ||
    /(^|\/)(?:package\.json|composer\.json|pyproject\.toml|requirements\.txt|pubspec\.yaml|tsconfig\.json|next\.config\.[cm]?[jt]s)$/i.test(normalized) ||
    /(^|\/)(?:pages|app|views|templates|layouts|modules|packages|plugins|extensions|theme|components|widgets|shared|common|ui)(?:\/|$)/i.test(normalized);
}

function titleFromPath(file = "") {
  const normalized = normalizePath(file);
  const parts = normalized.split("/").filter(Boolean);
  const base = basenameWithoutExtension(normalized) || "";
  if (!base && parts.length === 0) return "";
  if (/^(index|\+page)$/i.test(base) && parts.length > 1) {
    return pascalize(parts[parts.length - 2]) || "Home";
  }
  if (/^(index|page|layout|default)$/i.test(base) && parts.length > 1) {
    return pascalize(parts[parts.length - 2]) || pascalize(base);
  }
  return pascalize(base || parts[parts.length - 1] || "");
}

function collectMatches(text = "", patterns = []) {
  const source = String(text || "");
  const matches = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const value = match[1] || match[0];
      if (value) matches.push(String(value).trim());
    }
  }
  return unique(matches);
}

function widgetLabelFromText(text = "", file = "") {
  const source = `${text}\n${file}`.toLowerCase();
  return WIDGET_LABELS.filter(label => source.includes(label));
}

function navigationLabelFromText(text = "", file = "") {
  const source = `${text}\n${file}`.toLowerCase();
  return NAVIGATION_LABELS.filter(label => source.includes(label));
}

function responsiveLabelFromText(text = "", file = "") {
  const source = `${text}\n${file}`.toLowerCase();
  const labels = new Set();
  if (/@media|media query|breakpoint/.test(source)) labels.add("media query");
  if (/desktop|lg:|xl:/.test(source)) labels.add("desktop");
  if (/tablet|md:/.test(source)) labels.add("tablet");
  if (/mobile|sm:|xs:/.test(source)) labels.add("mobile");
  if (/hidden|display:\s*none|conditional render/.test(source)) labels.add("hidden");
  if (/flex/.test(source)) labels.add("flex");
  if (/grid/.test(source)) labels.add("grid");
  if (/responsive/.test(source)) labels.add("responsive");
  return [...labels];
}

function flowLabelFromText(text = "", file = "") {
  const source = `${text}\n${file}`.toLowerCase();
  return FLOW_LABELS.filter(label => source.includes(label));
}

function hasPattern(text = "", patterns = []) {
  const source = String(text || "");
  return patterns.some(pattern => pattern.test(source));
}

function analyzeSourceFile(file, content = "") {
  const normalized = normalizePath(file);
  const text = String(content || "");
  const lowerText = lower(text);
  const framework = detectFrameworkFromContent(text, normalized) || "custom";
  const route = inferRouteFromPath(normalized);
  const type = detectComponentType(normalized, text, framework);
  const layout = inferLayoutRole(normalized, text, framework);
  const namedMatch = text.match(/(?:export\s+default\s+)?(?:async\s+)?function\s+([A-Z][A-Za-z0-9_]*)\s*\(/) ||
    text.match(/\bclass\s+([A-Z][A-Za-z0-9_]*)\b/) ||
    text.match(/\bconst\s+([A-Z][A-Za-z0-9_]*)\s*=/);
  const title = namedMatch?.[1] || titleFromPath(normalized);
  const pageLike = layout ? false : (
    route !== null ||
    PAGE_LIKE_SEGMENTS.has((normalized.split("/")[0] || "").toLowerCase()) ||
    /(^|\/)(page|index|home|dashboard|admin|login|register|profile|settings|report|list|detail|form|dialog|modal|drawer|tabs?|wizard)\.[^.]+$/i.test(normalized) ||
    /@page\b|<main\b|<router-view\b|<template\b|return\s*<|render\s*\(/i.test(text)
  );
  const widgetLabels = widgetLabelFromText(text, normalized);
  const navigationLabels = navigationLabelFromText(text, normalized);
  const responsiveLabels = responsiveLabelFromText(text, normalized);
  const flowLabels = flowLabelFromText(text, normalized);
  const forms = hasPattern(text, [/<form\b/i, /\buseForm\b/i, /\bonSubmit\b/i, /\bvalidate\b/i, /\brequired\b/i, /\bfield\b/i]) || /form/i.test(normalized);
  const dialogs = hasPattern(text, [/\bdialog\b/i, /\bmodal\b/i]);
  const drawers = hasPattern(text, [/\bdrawer\b/i]);
  const tabs = hasPattern(text, [/\btabs?\b/i]);
  const tables = hasPattern(text, [/\btable\b/i, /\bgrid\b/i, /\bdatagrid\b/i]);
  const charts = hasPattern(text, [/\bchart\b/i, /\bgraph\b/i]);
  const providers = hasPattern(text, [/\bprovider\b/i, /\bcontext\b/i, /\bsignal\b/i, /\bstore\b/i]);
  const permissions = hasPattern(text, [/\bpermission\b/i, /\bauthoriz/i, /\bprotected\b/i]);
  const dependencies = unique([
    ...(text.match(/\b(?:navigate|router\.push|router\.replace|redirect|Link|href)\b/gi) || []),
    ...(text.match(/\b(?:useState|useEffect|useMemo|useCallback|computed|watch|watchEffect|signal)\b/gi) || [])
  ]);
  return {
    file: normalized,
    framework,
    type,
    route,
    layout,
    title,
    pageLike,
    widgetLabels,
    navigationLabels,
    responsiveLabels,
    flowLabels,
    forms,
    dialogs,
    drawers,
    tabs,
    tables,
    charts,
    providers,
    permissions,
    dependencies,
    hash: hashContent(text)
  };
}

function mergeLabels(...lists) {
  return unique(lists.flat());
}

function kindFromNameOrText(value = "") {
  const text = lower(value);
  if (text.includes("header")) return "header";
  if (text.includes("toolbar")) return "toolbar";
  if (text.includes("search")) return "search";
  if (text.includes("notification")) return "notification";
  if (text.includes("avatar")) return "avatar";
  if (text.includes("sidebar")) return "sidebar";
  if (text.includes("menu")) return "menu";
  if (text.includes("content")) return "content";
  if (text.includes("card")) return "card";
  if (text.includes("chart")) return "chart";
  if (text.includes("footer")) return "footer";
  if (text.includes("form")) return "form";
  if (text.includes("table")) return "table";
  if (text.includes("dialog") || text.includes("modal")) return "dialog";
  if (text.includes("drawer")) return "drawer";
  if (text.includes("tabs")) return "tabs";
  if (text.includes("wizard")) return "wizard";
  if (text.includes("chart")) return "chart";
  if (text.includes("calendar")) return "calendar";
  if (text.includes("tree")) return "tree";
  return null;
}

function detectPageKind(text = "", file = "") {
  const source = `${text}\n${file}`.toLowerCase();
  if (source.includes("login")) return "Login";
  if (source.includes("register")) return "Register";
  if (source.includes("dashboard")) return "Dashboard";
  if (source.includes("admin")) return "Admin";
  if (source.includes("profile")) return "Profile";
  if (source.includes("settings")) return "Settings";
  if (source.includes("report")) return "Report";
  if (source.includes("detail")) return "User Detail";
  if (source.includes("list")) return "Product List";
  return titleFromPath(file);
}

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
  lower,
  normalizePath,
  unique
};
