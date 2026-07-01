export const COMPONENT_TREE_VERSION = 1;

export const TERMINAL_TASK_STATUSES = new Set(["SUCCESS", "FAILED", "BLOCKED", "SKIPPED"]);

export const COMPONENT_LOG_EVENTS = {
  START: "COMPONENT_TREE_START",
  FOUND: "COMPONENT_FOUND",
  LINK: "COMPONENT_LINK",
  DYNAMIC: "COMPONENT_DYNAMIC",
  ROUTE: "COMPONENT_ROUTE",
  LAYOUT: "COMPONENT_LAYOUT",
  SHARED: "COMPONENT_SHARED",
  UNUSED: "COMPONENT_UNUSED",
  CYCLE: "COMPONENT_CYCLE",
  COMPLETE: "COMPONENT_TREE_COMPLETE"
};

export const DEFAULT_COMPONENT_TREE_FILE = "component-tree.json";

export const KNOWN_FRAMEWORKS = new Set([
  "react",
  "next",
  "vue",
  "nuxt",
  "angular",
  "svelte",
  "solid",
  "astro",
  "php",
  "blade",
  "twig",
  "aspnet-mvc",
  "razor",
  "jsp",
  "django",
  "flask",
  "laravel",
  "express-template",
  "html",
  "custom"
]);

export const COMPONENT_TYPES = new Set([
  "component",
  "page",
  "layout",
  "template",
  "widget",
  "shared",
  "route",
  "provider",
  "consumer",
  "unknown"
]);

