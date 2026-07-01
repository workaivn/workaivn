export const UI_PLAN_VERSION = 1;

export const UI_LOG_EVENTS = {
  START: "UI_PLAN_START",
  PAGE: "PAGE_FOUND",
  LAYOUT: "LAYOUT_FOUND",
  WIDGET: "WIDGET_FOUND",
  FORM: "FORM_FOUND",
  NAVIGATION: "NAVIGATION_FOUND",
  FLOW: "FLOW_FOUND",
  RESPONSIVE: "RESPONSIVE_FOUND",
  IMPACT: "IMPACT_FOUND",
  COMPLETE: "UI_PLAN_COMPLETE"
};

export const UI_PLAN_FILE = "ui-plan.json";
export const COMPONENT_TREE_FILE = "component-tree.json";

export const PAGE_LIKE_SEGMENTS = new Set([
  "page",
  "pages",
  "app",
  "views",
  "templates",
  "routes",
  "screens",
  "screen"
]);

export const LAYOUT_LIKE_SEGMENTS = new Set([
  "layout",
  "layouts",
  "master",
  "shell",
  "wrapper",
  "container"
]);

export const WIDGET_LABELS = [
  "header",
  "toolbar",
  "search",
  "notification",
  "avatar",
  "sidebar",
  "menu",
  "content",
  "card",
  "chart",
  "footer",
  "button",
  "input",
  "select",
  "checkbox",
  "radio",
  "switch",
  "datepicker",
  "upload",
  "table",
  "calendar",
  "tree",
  "timeline",
  "editor",
  "map",
  "video",
  "pdf",
  "markdown",
  "rich text",
  "canvas",
  "dialog",
  "modal",
  "drawer",
  "tabs",
  "wizard",
  "grid",
  "flex"
];

export const NAVIGATION_LABELS = [
  "breadcrumb",
  "sidebar",
  "navbar",
  "menu",
  "tabs",
  "wizard",
  "router",
  "redirect",
  "dialog flow",
  "popup navigation"
];

export const FLOW_LABELS = [
  "click",
  "hover",
  "focus",
  "blur",
  "drag",
  "drop",
  "scroll",
  "resize",
  "keyboard",
  "context menu",
  "double click",
  "touch",
  "gesture"
];

export const RESPONSIVE_LABELS = [
  "desktop",
  "tablet",
  "mobile",
  "breakpoint",
  "responsive",
  "hidden",
  "conditional render",
  "media query"
];

