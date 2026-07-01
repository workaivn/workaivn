import path from "node:path";
import { DEPENDENCY_NODE_TYPES } from "./types.js";

function normalizePath(value = "") {
  return String(value || "").replace(/\\/g, "/").trim();
}

function lower(value = "") {
  return normalizePath(value).toLowerCase();
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
}

function basename(file = "") {
  return path.posix.basename(normalizePath(file));
}

function fileExt(file = "") {
  const name = basename(file);
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}

function detectFramework(file = "", content = "") {
  const normalized = lower(file);
  const text = String(content || "").toLowerCase();
  if (/(^|\/)(?:app|pages)\/(?:page|layout|loading|error|template)\.(?:[cm]?[jt]sx?|jsx?)$/.test(normalized) || /(^|\/)pages\/index\.(?:[cm]?[jt]sx?|jsx?)$/.test(normalized)) return "next";
  if (/\.vue$/.test(normalized)) return "vue";
  if (/\.svelte$/.test(normalized)) return "svelte";
  if (/\.astro$/.test(normalized)) return "astro";
  if (/\.blade\.php$/.test(normalized)) return "blade";
  if (/\.twig$/.test(normalized)) return "twig";
  if (/\.cshtml$/.test(normalized)) return "razor";
  if (/\.aspx$/.test(normalized)) return "aspnet-mvc";
  if (/\.jsp$|\.jspx$/.test(normalized)) return "jsp";
  if (/\.php$/.test(normalized)) return "php";
  if (/\bfrom\s+flask\b|\bimport\s+flask\b|\bflask\.flask\b/.test(text)) return "flask";
  if (/\bfrom\s+fastapi\b|\bimport\s+fastapi\b|\bfastapi\b/.test(text)) return "fastapi";
  if (/\bfrom\s+django\b|\bimport\s+django\b|\bdjango\.http\b|\bdjango\.shortcuts\b/.test(text)) return "django";
  if (/from\s+['"]react['"]|useState|useEffect|lazy\(|jsx|tsx/.test(text)) return "react";
  if (/from\s+['"]vue['"]|definecomponent\(|<template>/.test(text)) return "vue";
  if (/from\s+['"]solid-js['"]|createsignal/.test(text)) return "solid";
  if (/@component\s*\(|templateurl\s*:|selector\s*:/.test(text)) return "angular";
  return null;
}

function detectNodeType(file = "", content = "") {
  const normalized = lower(file);
  const name = basename(file).toLowerCase();
  const ext = fileExt(file);
  if (/(?:^|\/)(?:tests?|__tests__|specs?)(?:\/|$)|\.(?:test|spec)\./.test(normalized)) return DEPENDENCY_NODE_TYPES.TEST;
  if (/(?:^|\/)(?:components|component|widgets|shared|common|ui)(?:\/|$)/.test(normalized)) return DEPENDENCY_NODE_TYPES.COMPONENT;
  if (/(?:^|\/)(?:routes?|pages|app)(?:\/|$)|\/page\.(?:[cm]?[jt]sx?)$|\/layout\.(?:[cm]?[jt]sx?)$/.test(normalized)) return DEPENDENCY_NODE_TYPES.ROUTE;
  if (/(?:controller|controllers)/.test(normalized)) return DEPENDENCY_NODE_TYPES.CONTROLLER;
  if (/(?:service|services)/.test(normalized)) return DEPENDENCY_NODE_TYPES.SERVICE;
  if (/(?:repository|repositories|repo)/.test(normalized)) return DEPENDENCY_NODE_TYPES.REPOSITORY;
  if (/(?:model|models|entity|entities)/.test(normalized)) return DEPENDENCY_NODE_TYPES.MODEL;
  if (!/(?:^|\/)(?:package\.json|composer\.json|pom\.xml|build\.gradle|cargo\.toml|go\.mod|requirements\.txt|pubspec\.yaml)$/.test(normalized) &&
    (/(?:^|\/)(?:state|stores?|contexts?)(?:\/|$)|\b(?:redux|vuex|pinia|ngrx|mobx|context|store|atom|signal|zustand|recoil)\b/.test(normalized) || /\b(?:redux|vuex|pinia|ngrx|mobx|context|store|atom|signal|zustand|recoil)\b/.test(String(content || "").toLowerCase()))) {
    return DEPENDENCY_NODE_TYPES.STATE;
  }
  if (/(?:migration|migrations|schema|seed)/.test(normalized)) return DEPENDENCY_NODE_TYPES.DATABASE;
  if (/(?:worker|workers|queue|job|jobs|cron|scheduler|pubsub|socket|realtime)/.test(normalized)) return DEPENDENCY_NODE_TYPES.RUNTIME;
  if (/(?:package\.json|composer\.json|pom\.xml|build\.gradle|cargo\.toml|go\.mod|requirements\.txt|dockerfile|makefile|taskfile)/.test(name)) return DEPENDENCY_NODE_TYPES.BUILD;
  if (/\.(?:css|scss|sass|less|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|eot|md|markdown|pdf)$/i.test(name)) return DEPENDENCY_NODE_TYPES.ASSET;
  if (/\.(?:json|yml|yaml|toml|xml|ini|env)$/i.test(name)) return DEPENDENCY_NODE_TYPES.CONFIG;
  if (ext === "php" && /<\?php/.test(String(content || ""))) return DEPENDENCY_NODE_TYPES.FILE;
  return DEPENDENCY_NODE_TYPES.FILE;
}

function parseJsLikeDependencies(content = "") {
  const source = String(content || "");
  const refs = [];
  const patterns = [
    /import\s+[^'"]+\s+from\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /export\s+.*?from\s+['"]([^'"]+)['"]/g,
    /\busing\s+([A-Za-z0-9_.]+)\s*;/g,
    /\breference\s+['"]([^'"]+)['"]/g,
    /\bautoload\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) refs.push(match[1]);
  }
  for (const match of source.matchAll(/<\s*([A-Z][A-Za-z0-9_]*)\b/g)) {
    refs.push(match[1]);
  }
  return unique(refs);
}

function parsePhpDependencies(content = "") {
  const source = String(content || "");
  const refs = [];
  for (const match of source.matchAll(/\b(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]\s*\)?/gi)) refs.push(match[1]);
  for (const match of source.matchAll(/\buse\s+([^;]+);/gi)) refs.push(match[1]);
  return unique(refs);
}

function parseTemplateDependencies(content = "") {
  const source = String(content || "");
  const refs = [];
  for (const match of source.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) refs.push(match[1]);
  for (const match of source.matchAll(/<link[^>]+href=["']([^"']+)["']/gi)) refs.push(match[1]);
  for (const match of source.matchAll(/(?:@include|@extends)\s*\(?\s*['"]([^'"]+)['"]\s*\)?/gi)) refs.push(match[1]);
  for (const match of source.matchAll(/\{\%\s*(?:include|extends)\s+['"]([^'"]+)['"]/gi)) refs.push(match[1]);
  for (const match of source.matchAll(/<jsp:include[^>]+page=["']([^"']+)["']/gi)) refs.push(match[1]);
  for (const match of source.matchAll(/<include[^>]+src=["']([^"']+)["']/gi)) refs.push(match[1]);
  return unique(refs);
}

function extractRawDependencies(file = "", content = "") {
  const ext = fileExt(file);
  if (["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts"].includes(ext)) return parseJsLikeDependencies(content);
  if (["php", "phtml"].includes(ext) || /\.blade\.php$/i.test(file)) return parsePhpDependencies(content);
  if (["html", "htm", "twig", "cshtml", "aspx", "jsp", "jspx", "vue", "svelte", "astro"].includes(ext)) return parseTemplateDependencies(content);
  if (["css", "scss", "sass", "less"].includes(ext)) {
    const refs = [];
    for (const match of String(content || "").matchAll(/@import\s+['"]([^'"]+)['"]/gi)) refs.push(match[1]);
    for (const match of String(content || "").matchAll(/url\(\s*['"]?([^"')]+)['"]?\s*\)/gi)) refs.push(match[1]);
    return unique(refs);
  }
  if (["cs", "java"].includes(ext)) {
    const refs = [];
    for (const match of String(content || "").matchAll(/\busing\s+([A-Za-z0-9_.]+)\s*;/gi)) refs.push(match[1]);
    for (const match of String(content || "").matchAll(/\bimport\s+([A-Za-z0-9_.]+)\s*;/gi)) refs.push(match[1]);
    return unique(refs);
  }
  return [];
}

function classifyDependencyKind(specifier = "") {
  const value = String(specifier || "").trim();
  if (!value) return "unknown";
  if (/^https?:\/\//i.test(value)) return DEPENDENCY_NODE_TYPES.ASSET;
  if (/^(?:\.{1,2}\/|\/|~\/|@\/)/.test(value)) return "file";
  if (/^(?:react|vue|svelte|solid-js|next|express|fastify|nestjs|lodash|axios|zustand|redux|pinia|vuex|rxjs|socket\.io|mongoose|sequelize|prisma|typeorm|sharp|uuid|moment|dayjs|chart\.js|framer-motion)(?:\/|$)/i.test(value)) return "package";
  if (/\.(?:css|scss|sass|less|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|eot|md|html?|json)$/i.test(value)) return "asset";
  return "package";
}

function resolveRelativeCandidate(specifier = "", fromFile = "", workspaceFiles = []) {
  const sourceDir = path.posix.dirname(normalizePath(fromFile) || ".");
  const base = normalizePath(specifier);
  const root = path.posix.normalize(path.posix.join(sourceDir, base));
  const candidates = [];
  if (path.posix.extname(root)) {
    candidates.push(root);
  } else {
    candidates.push(root);
    candidates.push(`${root}.js`, `${root}.jsx`, `${root}.ts`, `${root}.tsx`, `${root}.mjs`, `${root}.cjs`, `${root}.vue`, `${root}.svelte`, `${root}.astro`, `${root}.php`, `${root}.html`, `${root}.htm`, `${root}.css`, `${root}.scss`, `${root}.json`);
    candidates.push(path.posix.join(root, "index.js"), path.posix.join(root, "index.ts"), path.posix.join(root, "index.tsx"), path.posix.join(root, "index.jsx"), path.posix.join(root, "index.php"), path.posix.join(root, "index.html"));
  }
  const lookup = new Set((workspaceFiles || []).map(file => lower(file)));
  for (const candidate of candidates) {
    if (lookup.has(lower(candidate))) return normalizePath(candidate);
  }
  return null;
}

function resolveDependencyTarget(specifier = "", fromFile = "", context = {}) {
  const workspaceFiles = Array.isArray(context.workspaceFiles) ? context.workspaceFiles : [];
  const value = String(specifier || "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return `asset:${value}`;
  if (/^(\.\.\/|\.\/|\/|~\/|@\/)/.test(value)) {
    const alias = value.startsWith("@/") ? value.replace(/^@\//, "src/") : value.startsWith("~/") ? value.replace(/^~\//, "") : value;
    const resolved = resolveRelativeCandidate(alias, fromFile, workspaceFiles);
    return resolved || null;
  }
  if (/[\\]/.test(value) || /^[A-Z][A-Za-z0-9_.\\]+$/.test(value)) {
    const candidates = unique([
      value.replace(/\\/g, "/"),
      value.replace(/\\/g, "/").replace(/^App\//i, "app/"),
      `${value.replace(/\\/g, "/")}.php`,
      `${value.replace(/\\/g, "/").replace(/^App\//i, "app/")}.php`,
      `${value.replace(/\\/g, "/")}.cs`,
      `${value.replace(/\\/g, "/")}.java`
    ]);
    for (const candidate of candidates) {
      const resolved = resolveRelativeCandidate(candidate, fromFile, workspaceFiles);
      if (resolved) return resolved;
      const normalizedCandidate = lower(candidate);
      const directMatch = workspaceFiles.find(file => lower(file) === normalizedCandidate);
      if (directMatch) return normalizePath(directMatch);
    }
  }
  if (!/[./\\]/.test(value)) {
    const normalizedValue = value.toLowerCase();
    const fileMatch = workspaceFiles.find(file => {
      const fileName = basename(file).replace(/\.[^.]+$/, "").toLowerCase();
      return fileName === normalizedValue || fileName === normalizedValue.replace(/^[a-z]/, match => match.toLowerCase());
    });
    if (fileMatch) return normalizePath(fileMatch);
  }
  if (classifyDependencyKind(value) === "package") {
    const pkg = value.split("/")[0].startsWith("@") ? value.split("/").slice(0, 2).join("/") : value.split("/")[0];
    return `package:${pkg}`;
  }
  return null;
}

function buildFileNode(file = "", content = "", context = {}) {
  const framework = detectFramework(file, content);
  const type = detectNodeType(file, content);
  const dependencies = extractRawDependencies(file, content);
  let route = null;
  const normalized = normalizePath(file);
  const parts = normalized.split("/");
  const base = basename(file).replace(/\.[^.]+$/, "");
  if (/(^|\/)(?:app|pages|routes)\/.*\/page\.(?:[cm]?[jt]sx?)$/i.test(normalized)) {
    const routeParts = parts.slice(0, -1).filter(Boolean);
    const appIndex = routeParts.indexOf("app");
    const pagesIndex = routeParts.indexOf("pages");
    const routesIndex = routeParts.indexOf("routes");
    const sliced = appIndex >= 0 ? routeParts.slice(appIndex + 1) : pagesIndex >= 0 ? routeParts.slice(pagesIndex + 1) : routesIndex >= 0 ? routeParts.slice(routesIndex + 1) : routeParts;
    route = `/${sliced.filter(Boolean).join("/")}`.replace(/\/page$/, "") || "/";
  } else if (/(^|\/)app\/page\.(?:[cm]?[jt]sx?)$/i.test(normalized) || /(^|\/)pages\/index\.(?:[cm]?[jt]sx?)$/i.test(normalized) || /(^|\/)index\.(?:php|html?|blade\.php|cshtml|jsp|twig|vue|svelte|astro)$/i.test(normalized)) {
    route = "/";
  } else if (/(^|\/)pages\/.+\.(?:[cm]?[jt]sx?)$/i.test(normalized)) {
    const routeParts = parts.slice(parts.findIndex(part => part === "pages") + 1);
    route = `/${routeParts.join("/")}`.replace(/\.[^.]+$/, "") || "/";
  } else if (/(^|\/)(?:routes|app)\/.+\.(?:[cm]?[jt]sx?|php)$/i.test(normalized)) {
    route = `/${base.toLowerCase()}`;
  }
  return {
    id: normalizePath(file),
    name: basename(file).replace(/\.[^.]+$/, "") || basename(file),
    path: normalizePath(file),
    framework,
    type,
    route,
    dependencies,
    dependents: [],
    dependencyCount: dependencies.length,
    dependentCount: 0,
    fanIn: 0,
    fanOut: dependencies.length,
    criticalScore: 0,
    impactScore: 0,
    reuseScore: 0,
    changeFrequency: 0,
    unused: false,
    circular: false,
    dynamic: /import\s*\(/.test(String(content || "")) || /lazy\(/.test(String(content || "")),
    runtime: /(worker|queue|cron|socket|realtime|scheduler)/i.test(file) || /(worker|queue|cron|socket|realtime|scheduler)/i.test(String(content || "")),
    database: /(model|repository|migration|schema|sql|query|orm)/i.test(file) || /(model|repository|migration|schema|sql|query|orm)/i.test(String(content || "")),
    state: /(redux|vuex|pinia|ngrx|mobx|context|store|atom|signal)/i.test(file) || /(redux|vuex|pinia|ngrx|mobx|context|store|atom|signal)/i.test(String(content || "")),
    build: /(package\.json|composer\.json|pom\.xml|build\.gradle|cargo\.toml|go\.mod|requirements\.txt|dockerfile|makefile|taskfile)/i.test(file),
    asset: type === DEPENDENCY_NODE_TYPES.ASSET,
    config: type === DEPENDENCY_NODE_TYPES.CONFIG
  };
}

export {
  basename,
  buildFileNode,
  classifyDependencyKind,
  detectFramework,
  detectNodeType,
  extractRawDependencies,
  normalizePath,
  resolveDependencyTarget,
  unique
};
