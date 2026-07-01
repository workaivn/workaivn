import path from "node:path";
import { basenameWithoutExtension, normalizePath, pascalize, pathLooksLikeTest, unique } from "./contextBuilder.js";

function countMatches(text, pattern) {
  const matches = String(text || "").match(pattern);
  return matches ? matches.length : 0;
}

function detectQuoteStyle(texts = []) {
  let single = 0;
  let double = 0;
  for (const text of texts.filter(Boolean)) {
    single += countMatches(text, /'[^'\n]*'/g);
    double += countMatches(text, /"[^"\n]*"/g);
  }
  if (single === double) return "single";
  return single > double ? "single" : "double";
}

function detectIndentStyle(texts = []) {
  let tabs = 0;
  let spaces = 0;
  for (const text of texts.filter(Boolean)) {
    tabs += countMatches(text, /^\t+/gm);
    spaces += countMatches(text, /^ {2,}/gm);
  }
  if (tabs > spaces) return "tabs";
  if (spaces > 0) return "spaces";
  return "spaces";
}

function detectLineEnding(texts = []) {
  for (const text of texts.filter(Boolean)) {
    if (/\r\n/.test(text)) return "\r\n";
  }
  return "\n";
}

function detectModuleSystem(context = {}, texts = []) {
  const joined = texts.filter(Boolean).join("\n");
  if (/module\.exports\b|exports\.[A-Za-z_$][\w$]*\b|require\s*\(/.test(joined)) return "cjs";
  if (/\bimport\s+.+\s+from\s+['"][^'"]+['"]|\bexport\s+(?:default\s+)?(?:function|class|const|let|var)\b|\bexport\s*\{/.test(joined)) return "esm";
  const ext = String(context.sourceExt || "").toLowerCase();
  if ([".mjs", ".mts", ".tsx", ".ts", ".jsx", ".js"].includes(ext)) return "esm";
  if (ext === ".php") return "php";
  if (ext === ".html" || ext === ".css") return "static";
  return "unknown";
}

function detectExportStyle(texts = []) {
  const joined = texts.filter(Boolean).join("\n");
  const defaultCount = countMatches(joined, /\bexport\s+default\b/g);
  const namedCount = countMatches(joined, /\bexport\s+(?:const|let|var|function|class)\b/g) + countMatches(joined, /\bexport\s*\{/g);
  if (defaultCount > namedCount) return "default";
  if (namedCount > defaultCount) return "named";
  return "named";
}

function detectImportStyle(texts = []) {
  const joined = texts.filter(Boolean).join("\n");
  if (/@\//.test(joined)) return "alias";
  if (/\.\.\//.test(joined) || /\.\/.*/.test(joined)) return "relative";
  return "relative";
}

function detectTestFramework(context = {}, texts = []) {
  const joined = texts.filter(Boolean).join("\n");
  const packageJson = context.workspaceState?.packageJson || {};
  const scripts = packageJson?.scripts || {};
  const scriptText = Object.values(scripts).join("\n");
  if (/node:test/.test(joined) || /node --test/.test(scriptText)) return "node:test";
  if (/vitest|from 'vitest'|from "vitest"/.test(joined) || /vitest/.test(scriptText)) return "vitest";
  if (/jest|from 'jest'|from "jest"/.test(joined) || /jest/.test(scriptText)) return "jest";
  if (/mocha|chai/.test(joined) || /mocha/.test(scriptText)) return "mocha";
  return pathLooksLikeTest(context.targetPath) ? "node:test" : "unknown";
}

function collectConventionTexts(context = {}) {
  const texts = [];
  if (typeof context.existingContent === "string") texts.push(context.existingContent);
  if (Array.isArray(context.relatedFiles)) {
    for (const file of context.relatedFiles.slice(0, 12)) {
      if (typeof file?.content === "string") texts.push(file.content);
    }
  }
  const packageJson = context.workspaceState?.packageJson;
  if (packageJson) texts.push(JSON.stringify(packageJson, null, 2));
  return texts;
}

function detectPackageManager(context = {}) {
  const pkg = context.workspaceState?.packageJson || {};
  if (pkg.packageManager) return String(pkg.packageManager).split("@")[0];
  if (context.workspaceState?.hasPackageJson) return "npm";
  if (context.workspaceState?.hasIndexPhp) return "composer";
  return "npm";
}

function detectNamingConvention(texts = []) {
  const joined = texts.filter(Boolean).join("\n");
  if (/\b[A-Z][A-Za-z0-9]+(?:[A-Z][A-Za-z0-9]+)+\b/.test(joined)) return "pascal";
  if (/\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/.test(joined)) return "kebab";
  return "camel";
}

export function resolveConvention(context = {}) {
  const texts = collectConventionTexts(context);
  const packageManager = detectPackageManager(context);
  const quoteStyle = detectQuoteStyle(texts);
  const indentStyle = detectIndentStyle(texts);
  const lineEnding = detectLineEnding(texts);
  const moduleSystem = detectModuleSystem(context, texts);
  const exportStyle = detectExportStyle(texts);
  const importStyle = detectImportStyle(texts);
  const testFramework = detectTestFramework(context, texts);
  const namingStyle = detectNamingConvention(texts);
  const targetPath = normalizePath(context.targetPath || context.task?.toolArgs?.path || "");
  const targetBase = basenameWithoutExtension(targetPath);
  const componentName = pascalize(targetBase);
  const relatedNames = unique((Array.isArray(context.relatedFiles) ? context.relatedFiles : [])
    .map(item => item?.name || path.basename(String(item?.path || "")))
    .filter(Boolean));

  const confidence = Math.min(0.95, 0.35 + (texts.filter(Boolean).length * 0.08));
  const reasons = [
    moduleSystem !== "unknown" ? `moduleSystem:${moduleSystem}` : null,
    `quoteStyle:${quoteStyle}`,
    `indentStyle:${indentStyle}`,
    `testFramework:${testFramework}`,
    `packageManager:${packageManager}`
  ].filter(Boolean);

  return {
    packageManager,
    moduleSystem,
    quoteStyle,
    indentStyle,
    lineEnding,
    exportStyle,
    importStyle,
    testFramework,
    namingStyle,
    componentName,
    targetBase,
    targetPath,
    relatedNames,
    confidence,
    reasons
  };
}

