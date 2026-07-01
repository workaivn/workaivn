import crypto from "node:crypto";
import path from "node:path";
import { parse as parseJavaScript } from "@babel/parser";
import { KNOWN_FRAMEWORKS } from "./types.js";

function normalizePath(value = "") {
  return String(value || "").replace(/\\/g, "/").trim();
}

function normalizeLower(value = "") {
  return normalizePath(value).toLowerCase();
}

function pascalize(value = "") {
  return normalizePath(value)
    .replace(/\.[^.]+$/, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function basenameWithoutExtension(file = "") {
  const normalized = normalizePath(file);
  const parts = normalized.split("/");
  const last = parts[parts.length - 1] || "";
  return last.replace(/\.[^.]+$/, "");
}

function fileExtension(file = "") {
  const normalized = normalizePath(file);
  const index = normalized.lastIndexOf(".");
  return index >= 0 ? normalized.slice(index + 1).toLowerCase() : "";
}

function hashContent(content = "") {
  return crypto.createHash("sha1").update(String(content || ""), "utf8").digest("hex");
}

function parseSource(content = "") {
  try {
    return parseJavaScript(String(content || ""), {
      sourceType: "unambiguous",
      allowReturnOutsideFunction: true,
      plugins: [
        "jsx",
        "typescript",
        "decorators-legacy",
        "classProperties",
        "classPrivateProperties",
        "classPrivateMethods",
        "dynamicImport",
        "importMeta",
        "topLevelAwait"
      ]
    });
  } catch {
    return null;
  }
}

function walkAst(nodes, callback) {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    callback(node);
    for (const key of Object.keys(node)) {
      if (["type", "start", "end", "loc", "leadingComments", "trailingComments", "comments", "extra"].includes(key)) continue;
      const child = node[key];
      if (Array.isArray(child)) walkAst(child, callback);
      else if (child && typeof child.type === "string") walkAst([child], callback);
    }
  }
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean).map(value => normalizePath(value)))];
}

function pathSegments(file = "") {
  return normalizePath(file).split("/").filter(Boolean);
}

function isRelativeSpecifier(value = "") {
  return /^(\.\.?\/|\/|~\/|@\/)/.test(String(value || "").trim());
}

function guessFrameworkFromPath(file = "") {
  const normalized = normalizeLower(file);
  if (!normalized) return null;
  if (/^pages\/.*\.vue$/.test(normalized) || /(^|\/)app\.vue$/.test(normalized)) return "nuxt";
  if (/\.vue$/.test(normalized)) return "vue";
  if (/\.svelte$/.test(normalized)) return "svelte";
  if (/\.astro$/.test(normalized)) return "astro";
  if (/\.blade\.php$/.test(normalized)) return "blade";
  if (/\.twig$/.test(normalized)) return "twig";
  if (/\.cshtml$/.test(normalized)) return "razor";
  if (/\.aspx$/.test(normalized)) return "aspnet-mvc";
  if (/\.jsp$/.test(normalized) || /\.jspx$/.test(normalized)) return "jsp";
  if (/\.php$/.test(normalized)) return "php";
  if (/\.html?$/.test(normalized)) return "html";
  if (/(^|\/)(?:app|pages)\/(?:page|layout|loading|error|template)\.[cm]?[jt]sx?$/.test(normalized) || /(^|\/)pages\/index\.[cm]?[jt]sx?$/.test(normalized)) return "next";
  return null;
}

function detectFrameworkFromContent(content = "", file = "") {
  const normalized = String(content || "");
  const lower = normalized.toLowerCase();
  const ext = fileExtension(file);
  const pathFramework = guessFrameworkFromPath(file);

  const looksLikeJsx = /<\s*[A-Z][A-Za-z0-9]*\b|return\s*<[^>]+>/.test(normalized) || /\.(?:jsx|tsx)$/.test(normalizeLower(file));

  if (pathFramework && !["next"].includes(pathFramework)) return pathFramework;
  if (pathFramework === "next") return "next";
  if (/next\/dynamic|getserversideprops|getstaticprops|generateStaticParams/.test(lower)) return "next";
  if (/from\s+['"]react['"]|react\.|useState|useEffect|createelement|lazy\(/.test(lower) || looksLikeJsx) return "react";
  if (/defineasynccomponent|<router-view\b|createwebhistory|createrouter/.test(lower)) return "vue";
  if (/<svelte:|bind:|on:click|loadcomponent/.test(lower) || ext === "svelte") return "svelte";
  if (/from\s+['"]solid-js['"]|createsignal|<Show\b|<For\b/.test(lower)) return "solid";
  if (/@component\s*\(|templateurl\s*:|selector\s*:|@ngmodule\s*\(/.test(lower)) return "angular";
  if (/^---[\s\S]*?---/.test(normalized) && /<astro:|client:/.test(lower)) return "astro";
  if (/@extends\s*\(|@include\s*\(|<x-[\w-]+/.test(lower)) return "blade";
  if (/\{%\s*(?:extends|include|block)\b|\{\{\s*include\s*\(/.test(lower)) return "twig";
  if (/<jsp:include\b|<%@\s*include\b/.test(lower)) return "jsp";
  if (/\bnamespace\s+[A-Za-z_][\w.]*\b|\busing\s+[A-Za-z_][\w.]*;|\b@page\b/.test(normalized)) return "razor";
  if (/from\s+['"]next\/|next\.config/.test(lower)) return "next";
  if (/from\s+['"]vue['"]|definecomponent\(|<template>/.test(lower)) return "vue";
  if (/\bphp\b|<\?php/.test(lower)) return "php";
  if (/\bdjango\b|\{%\s*extends\s+['"]/.test(lower)) return "django";
  if (/\bflask\b|\bjinja\b|\{\{\s*url_for\s*\(/.test(lower)) return "flask";
  return pathFramework || null;
}

function detectComponentType(file = "", content = "", framework = "") {
  const normalized = normalizeLower(file);
  const lower = String(content || "").toLowerCase();
  if (/(^|\/)(layout|layouts|master|shell|wrapper)(\.|\/|$)/.test(normalized) || /\btemplateurl\b|\bextends\b/.test(lower)) return "layout";
  if (/(^|\/)(page|pages|index)(\.[^.]+)?$/.test(normalized) || /route\s*[:=]/.test(lower) || /<router-view\b/.test(lower)) return "page";
  if (/(^|\/)(component|components|widget|widgets|shared|common|ui)(\.|\/|$)/.test(normalized)) return "component";
  if (/(^|\/)(provider|providers)(\.|\/|$)/.test(normalized) || /\bprovider\b/.test(lower)) return "provider";
  if (/\bconsumer\b/.test(lower)) return "consumer";
  if (/(^|\/)(route|routes)(\.|\/|$)/.test(normalized)) return "route";
  if (framework === "blade" || framework === "twig" || framework === "jsp" || framework === "django" || framework === "flask" || framework === "php" || framework === "html") return "template";
  return "unknown";
}

function extractPropsFromAst(ast) {
  const props = new Set();
  if (!ast) return [];
  walkAst(ast.program.body, node => {
    if (node.type === "FunctionDeclaration" && node.params?.[0]?.type === "ObjectPattern") {
      for (const prop of node.params[0].properties || []) {
        if (prop?.key?.name) props.add(prop.key.name);
      }
    }
    if (node.type === "VariableDeclarator" && node.init?.type === "ArrowFunctionExpression" && node.init.params?.[0]?.type === "ObjectPattern") {
      for (const prop of node.init.params[0].properties || []) {
        if (prop?.key?.name) props.add(prop.key.name);
      }
    }
    if (node.type === "ObjectProperty" && node.key?.name === "props" && node.value?.type === "ObjectExpression") {
      for (const prop of node.value.properties || []) {
        if (prop?.key?.name) props.add(prop.key.name);
      }
    }
  });
  return [...props];
}

function extractHooksFromAst(ast) {
  const hooks = new Set();
  if (!ast) return [];
  walkAst(ast.program.body, node => {
    if (node.type === "CallExpression" && node.callee?.type === "Identifier" && /^use[A-Z]/.test(node.callee.name)) {
      hooks.add(node.callee.name);
    }
  });
  return [...hooks];
}

function extractLocalImportRecords(ast) {
  const imports = [];
  if (!ast) return imports;
  for (const node of ast.program.body) {
    if (node.type !== "ImportDeclaration") continue;
    const source = String(node.source.value || "");
    const specifiers = node.specifiers.map(spec => {
      if (spec.type === "ImportDefaultSpecifier") return spec.local.name;
      if (spec.type === "ImportSpecifier") return spec.imported.name;
      if (spec.type === "ImportNamespaceSpecifier") return "*";
      return null;
    }).filter(Boolean);
    imports.push({ source, specifiers });
  }
  return imports;
}

function extractExportsFromAst(ast) {
  const exports = [];
  if (!ast) return exports;
  for (const node of ast.program.body) {
    if (node.type === "ExportNamedDeclaration") {
      if (node.declaration?.type === "FunctionDeclaration" && node.declaration.id?.name) {
        exports.push(node.declaration.id.name);
      } else if (node.declaration?.type === "VariableDeclaration") {
        for (const decl of node.declaration.declarations || []) {
          if (decl.id?.type === "Identifier") exports.push(decl.id.name);
        }
      } else {
        for (const spec of node.specifiers || []) {
          if (spec.exported?.name) exports.push(spec.exported.name);
        }
      }
    }
    if (node.type === "ExportDefaultDeclaration") {
      exports.push("default");
    }
  }
  return exports;
}

function extractDynamicImports(ast, content = "") {
  const dynamic = [];
  if (!ast) return dynamic;
  walkAst(ast.program.body, node => {
    if (node.type === "ImportExpression" && node.source?.type === "StringLiteral") {
      dynamic.push(String(node.source.value || ""));
    }
    if (node.type === "CallExpression" && node.callee?.type === "Import") {
      const arg = node.arguments?.[0];
      if (arg?.type === "StringLiteral") dynamic.push(String(arg.value || ""));
    }
  });
  for (const match of String(content || "").matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/gi)) {
    dynamic.push(match[1]);
  }
  return dynamic;
}

function extractJsxTags(ast) {
  const tags = [];
  if (!ast) return tags;
  walkAst(ast.program.body, node => {
    if (node.type === "JSXOpeningElement") {
      const name = node.name;
      if (name?.type === "JSXIdentifier") tags.push(name.name);
      else if (name?.type === "JSXMemberExpression" && name.object?.name) tags.push(name.object.name);
    }
  });
  return tags;
}

function extractTemplateReferences(content = "", framework = "") {
  const text = String(content || "");
  const lower = text.toLowerCase();
  const refs = [];
  const add = value => {
    if (value) refs.push(value);
  };

  for (const match of text.matchAll(/@include\s*\(\s*['"]([^'"]+)['"]/gi)) add(match[1]);
  for (const match of text.matchAll(/@extends\s*\(\s*['"]([^'"]+)['"]/gi)) add(match[1]);
  for (const match of text.matchAll(/@component\s*\(\s*['"]([^'"]+)['"]/gi)) add(match[1]);
  for (const match of text.matchAll(/\{%\s*(?:include|extends|embed)\s+['"]([^'"]+)['"]/gi)) add(match[1]);
  for (const match of text.matchAll(/\{\{\s*include\s*\(\s*['"]([^'"]+)['"]/gi)) add(match[1]);
  for (const match of text.matchAll(/<jsp:include\b[^>]*\bpage\s*=\s*['"]([^'"]+)['"]/gi)) add(match[1]);
  for (const match of text.matchAll(/<x-([A-Za-z0-9_-]+)/g)) add(match[1]);
  for (const match of text.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)) add(match[1]);
  for (const match of text.matchAll(/\bres\.render\s*\(\s*['"]([^'"]+)['"]/gi)) add(match[1]);
  for (const match of text.matchAll(/\binclude\s*\(\s*['"]([^'"]+)['"]/gi)) add(match[1]);
  for (const match of text.matchAll(/\b(?:import|export)\s+[^'"]+from\s+['"]([^'"]+)['"]/gi)) add(match[1]);

  if (framework === "html" || framework === "astro") {
    for (const match of text.matchAll(/<([a-z][a-z0-9-]*)\b[^>]*>/gi)) add(match[1]);
  }

  return [...new Set(refs.map(value => String(value || "").trim()).filter(Boolean))];
}

function buildNameCandidates(file = "", content = "", exports = []) {
  const names = new Set();
  const base = basenameWithoutExtension(file);
  if (base) {
    names.add(base);
    names.add(pascalize(base));
  }
  const segments = pathSegments(file);
  const lastDir = segments.length > 1 ? segments[segments.length - 2] : "";
  if (lastDir) names.add(pascalize(lastDir));
  for (const name of exports || []) {
    if (name && name !== "default") names.add(String(name));
  }
  const text = String(content || "");
  for (const match of text.matchAll(/\b(?:function|class|const|let|var)\s+([A-Z][A-Za-z0-9_]*)/g)) {
    names.add(match[1]);
  }
  return [...names].filter(Boolean);
}

function resolveLocalTarget(workspaceIndex, currentFile, reference) {
  const ref = String(reference || "").trim();
  if (!ref) return [];

  const currentDir = path.posix.dirname(normalizePath(currentFile));
  const normalizedRef = ref.replace(/\\/g, "/");
  const candidates = new Set();

  const add = candidate => {
    const normalized = normalizePath(candidate);
    if (!normalized) return;
    if (workspaceIndex.fileSet.has(normalized.toLowerCase())) candidates.add(normalized);
  };

  if (isRelativeSpecifier(normalizedRef)) {
    const base = normalizedRef.startsWith("/") || normalizedRef.startsWith("~/") || normalizedRef.startsWith("@/")
      ? normalizedRef.replace(/^[@~]?\/+/, "")
      : path.posix.normalize(path.posix.join(currentDir, normalizedRef));
    const withExtensions = [
      base,
      `${base}.js`,
      `${base}.jsx`,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.mjs`,
      `${base}.cjs`,
      `${base}.vue`,
      `${base}.svelte`,
      `${base}.astro`,
      `${base}.php`,
      `${base}.blade.php`,
      `${base}.twig`,
      `${base}.cshtml`,
      `${base}.aspx`,
      `${base}.jsp`,
      `${base}.html`,
      `${base}/index.js`,
      `${base}/index.jsx`,
      `${base}/index.ts`,
      `${base}/index.tsx`,
      `${base}/index.vue`,
      `${base}/index.php`,
      `${base}/index.html`
    ];
    for (const candidate of withExtensions) {
      add(candidate);
      add(candidate.replace(/^\.\//, ""));
    }
  } else {
    const simple = pascalize(normalizedRef);
    const nameMatches = workspaceIndex.nameIndex.get(simple.toLowerCase()) || [];
    for (const match of nameMatches) candidates.add(match);
  }

  if (!candidates.size && /^\w[\w-]*$/.test(normalizedRef)) {
    const simple = pascalize(normalizedRef);
    const nameMatches = workspaceIndex.nameIndex.get(simple.toLowerCase()) || [];
    for (const match of nameMatches) candidates.add(match);
  }

  return [...candidates];
}

function buildWorkspaceIndex(files = []) {
  const fileSet = new Set((Array.isArray(files) ? files : []).map(file => normalizePath(file).toLowerCase()));
  const nameIndex = new Map();
  const pathIndex = new Map();
  for (const file of files || []) {
    const normalized = normalizePath(file);
    pathIndex.set(normalized.toLowerCase(), normalized);
    const base = basenameWithoutExtension(normalized);
    const key = base.toLowerCase();
    if (!nameIndex.has(key)) nameIndex.set(key, []);
    nameIndex.get(key).push(normalized);
    const pascal = pascalize(base).toLowerCase();
    if (!nameIndex.has(pascal)) nameIndex.set(pascal, []);
    nameIndex.get(pascal).push(normalized);
  }
  return { fileSet, pathIndex, nameIndex };
}

function selectComponentName(file, content, exports = []) {
  const exportNames = (Array.isArray(exports) ? exports : []).filter(name => name && name !== "default");
  if (exportNames.length > 0) return exportNames[0];
  const candidates = buildNameCandidates(file, content, exports);
  return candidates.find(name => /^[A-Z]/.test(String(name || ""))) || pascalize(basenameWithoutExtension(file)) || basenameWithoutExtension(file) || file;
}

function inferRouteFromPath(file = "") {
  const normalized = normalizePath(file);
  if (!normalized) return null;
  if (/^(?:app|pages|src\/pages)\/.*\/page\.[^.]+$/i.test(normalized)) {
    const withoutPage = normalized.replace(/\/page\.[^.]+$/i, "");
    return withoutPage === "app" || withoutPage === "pages" || withoutPage === "src/pages" ? "/" : `/${withoutPage.replace(/^(?:app|pages|src\/pages)\//i, "")}`;
  }
  if (/^(?:pages|src\/pages)\/index\.[^.]+$/i.test(normalized)) return "/";
  if (/^index\.(?:html|php|cshtml|aspx)$/i.test(normalized)) return "/";
  if (/^(?:pages|views|templates)\/.+/i.test(normalized)) {
    const trimmed = normalized.replace(/^(?:pages|views|templates)\//i, "").replace(/\.[^.]+$/, "");
    return `/${trimmed.replace(/\/index$/i, "")}`.replace(/\/+/g, "/");
  }
  return null;
}

function inferLayoutRole(file = "", content = "", framework = "") {
  const normalized = normalizeLower(file);
  if (/(^|\/)(layout|layouts|master|shell|wrapper)(\.|\/|$)/.test(normalized)) return true;
  if (framework === "next" && /layout\.[^.]+$/.test(normalized)) return true;
  if (framework === "nuxt" && /layouts?\//.test(normalized)) return true;
  if (/\btemplateurl\b|\b@extends\b|\bextends\b/.test(String(content || "").toLowerCase())) return true;
  return false;
}

export {
  basenameWithoutExtension,
  buildWorkspaceIndex,
  detectComponentType,
  detectFrameworkFromContent,
  extractDynamicImports,
  extractExportsFromAst,
  extractHooksFromAst,
  extractJsxTags,
  extractLocalImportRecords,
  extractPropsFromAst,
  extractTemplateReferences,
  fileExtension,
  hashContent,
  inferLayoutRole,
  inferRouteFromPath,
  isRelativeSpecifier,
  normalizeLower,
  normalizePath,
  pascalize,
  parseSource,
  resolveLocalTarget,
  selectComponentName,
  unique
};
