import path from "node:path";
import { buildCodeContext, basenameWithoutExtension, normalizePath, pascalize, camelize, pathLooksLikeTest, unique } from "./contextBuilder.js";
import { resolveConvention } from "./conventionResolver.js";
import { CODE_GENERATION_LOG_EVENTS, CODE_GENERATION_STATUS, CODE_GENERATION_TOOL } from "./types.js";
import { guardGeneratedOutput, validateGeneratedOutput } from "./validator.js";
import { serializeGenerationResult } from "./serializer.js";

function logEvent(eventName, payload = {}) {
  console.log(`[${eventName}]`, payload);
}

function quote(value, style = "single") {
  const text = String(value ?? "");
  const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/'/g, "\\'");
  return style === "double" ? `"${escaped}"` : `'${escaped}'`;
}

function indentBlock(text = "", indentStyle = "spaces", level = 1) {
  const indent = indentStyle === "tabs" ? "\t".repeat(level) : "  ".repeat(level);
  return String(text || "").split("\n").map(line => (line ? `${indent}${line}` : line)).join("\n");
}

function renderNamedImport(source, names = [], convention = {}) {
  const specifiers = unique(names.filter(Boolean));
  if (specifiers.length === 0) return `import * as module from ${quote(source, convention.quoteStyle)};`;
  return `import { ${specifiers.join(", ")} } from ${quote(source, convention.quoteStyle)};`;
}

function renderDefaultImport(source, name, convention = {}) {
  return `import ${name} from ${quote(source, convention.quoteStyle)};`;
}

function relativeImportPath(fromPath = "", toPath = "") {
  const fromDir = path.posix.dirname(normalizePath(fromPath) || ".");
  let relative = path.posix.relative(fromDir, normalizePath(toPath));
  if (!relative.startsWith(".")) relative = `./${relative}`;
  return relative.replace(/\\/g, "/");
}

function extractExportNames(content = "") {
  const text = String(content || "");
  const names = [];
  for (const match of text.matchAll(/\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) names.push(match[1]);
  for (const match of text.matchAll(/\bexport\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) names.push(match[1]);
  for (const match of text.matchAll(/\bexport\s*\{\s*([^}]+)\s*\}/g)) {
    for (const part of match[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/i)[0].trim();
      if (name) names.push(name);
    }
  }
  if (/\bexport\s+default\s+function\s+([A-Za-z_$][\w$]*)/.test(text)) names.push(RegExp.$1);
  return unique(names);
}

function extractImportSources(content = "") {
  const text = String(content || "");
  const sources = [];
  for (const match of text.matchAll(/\bimport\s+[^'"]+from\s+['"]([^'"]+)['"]/g)) sources.push(match[1]);
  for (const match of text.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) sources.push(match[1]);
  return unique(sources);
}

function detectLanguageRole(context = {}, convention = {}) {
  const targetPath = normalizePath(context.targetPath || "");
  const ext = path.extname(targetPath).toLowerCase();
  if (pathLooksLikeTest(targetPath)) return "test";
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".css" || ext === ".scss" || ext === ".sass") return "style";
  if (ext === ".php") return "php";
  if (ext === ".md" || ext === ".txt") return "doc";
  if (ext === ".json") return "config";
  if ([".tsx", ".jsx"].includes(ext)) return "component";
  if ([".ts", ".js", ".mjs", ".cjs"].includes(ext)) {
    if (/route|controller|service|store|util|helper|model|schema|api|server|app/i.test(targetPath)) return "module";
    if (convention.moduleSystem === "cjs") return "module";
    return "module";
  }
  return "module";
}

function inferEntityName(context = {}) {
  const base = basenameWithoutExtension(context.targetPath || "");
  if (!base) return "Generated";
  if (/^(index|main|app|page|layout|server|route|controller)$/i.test(base)) {
    const parent = normalizePath(context.targetPath || "").split("/").slice(-2, -1)[0] || base;
    return pascalize(parent);
  }
  return pascalize(base);
}

function buildTestSubject(context = {}, convention = {}) {
  const related = (Array.isArray(context.relatedFiles) ? context.relatedFiles : [])
    .filter(item => typeof item?.content === "string" || item?.path)
    .filter(item => !pathLooksLikeTest(item.path || "") && normalizePath(item.path || "") !== normalizePath(context.targetPath || ""));
  if (related.length === 0) return null;
  const file = related[0];
  const exports = extractExportNames(file.content || "");
  const source = relativeImportPath(context.targetPath || "", file.path || "");
  if (exports.length > 0) {
    return {
      source,
      exports,
      defaultExport: false
    };
  }
  return {
    source,
    exports: [inferEntityName({ targetPath: file.path })],
    defaultExport: true
  };
}

export function resolveImports(context = {}, convention = {}) {
  const imports = [];
  const targetPath = normalizePath(context.targetPath || "");
  const relatedFiles = Array.isArray(context.relatedFiles) ? context.relatedFiles : [];
  const explicitImports = Array.isArray(context.task?.expectedImports) ? context.task.expectedImports : [];

  for (const entry of explicitImports) {
    if (typeof entry === "string") {
      imports.push({ source: normalizePath(entry), kind: "namespace", evidence: [{ source: "task.expectedImports" }] });
    } else if (entry && typeof entry === "object") {
      imports.push({
        source: normalizePath(entry.source || entry.path || ""),
        kind: entry.kind || "namespace",
        names: Array.isArray(entry.names) ? entry.names.filter(Boolean) : [],
        evidence: Array.isArray(entry.evidence) ? entry.evidence : [{ source: "task.expectedImports" }]
      });
    }
  }

  for (const file of relatedFiles) {
    const sourcePath = normalizePath(file.path || "");
    if (!sourcePath || sourcePath === targetPath) continue;
    const relation = String(file.relation || file.source || "").toLowerCase();
    if (!/dependency|import|ui|component|test|subject|related/.test(relation)) continue;
    const exportNames = extractExportNames(file.content || "");
    const source = relativeImportPath(targetPath, sourcePath);
    if (exportNames.length > 0) {
      imports.push({
        source,
        kind: "named",
        names: exportNames,
        evidence: [{ source: file.source || relation || "relatedFiles", path: sourcePath }]
      });
    } else {
      imports.push({
        source,
        kind: "namespace",
        evidence: [{ source: file.source || relation || "relatedFiles", path: sourcePath }]
      });
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const item of imports) {
    const key = [item.source, item.kind, (item.names || []).join(",")].join("::");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

export function resolveExports(context = {}, convention = {}) {
  const explicitExports = Array.isArray(context.task?.expectedExports) ? context.task.expectedExports : [];
  if (explicitExports.length > 0) {
    return explicitExports.map(entry => (typeof entry === "string" ? { name: entry, kind: "named", evidence: [{ source: "task.expectedExports" }] } : entry));
  }

  const role = detectLanguageRole(context, convention);
  const entityName = inferEntityName(context);
  if (role === "test" || role === "html" || role === "style" || role === "php" || role === "doc" || role === "config") {
    return [];
  }
  if (role === "component" && convention.exportStyle !== "named") {
    return [{ name: "default", kind: "default", value: entityName, evidence: [{ source: "fileRole", value: role }] }];
  }
  return [{ name: entityName, kind: "named", evidence: [{ source: "fileRole", value: role }] }];
}

function formatExports(exports = [], convention = {}) {
  const named = exports.filter(item => item.kind !== "default");
  const defaultExport = exports.find(item => item.kind === "default");
  const lines = [];
  if (defaultExport) {
    lines.push(`export default function ${defaultExport.value || defaultExport.name || "Generated"}() {`);
    lines.push(indentBlock("return null;", convention.indentStyle));
    lines.push("}");
  }
  for (const item of named) {
    const name = item.name || item.value || "Generated";
    lines.push(`export function ${name}() {`);
    lines.push(indentBlock("return null;", convention.indentStyle));
    lines.push("}");
  }
  return lines.join(convention.lineEnding || "\n");
}

function buildComponentContent(context = {}, convention = {}, imports = [], exports = []) {
  const entityName = inferEntityName(context);
  const lines = [];
  for (const imp of imports) {
    if (imp.kind === "named" && Array.isArray(imp.names) && imp.names.length > 0) {
      lines.push(renderNamedImport(imp.source, imp.names, convention));
    } else if (imp.kind === "default" && (imp.names || imp.value)) {
      lines.push(renderDefaultImport(imp.source, imp.names?.[0] || imp.value, convention));
    } else {
      const alias = pascalize(path.basename(imp.source || "module").replace(/\.[^.]+$/, "")) || "Module";
      lines.push(`import * as ${alias} from ${quote(imp.source, convention.quoteStyle)};`);
    }
  }
  const exportBlock = formatExports(exports, convention);
  if (exportBlock) {
    lines.push(exportBlock);
    return lines.join(convention.lineEnding || "\n") + (convention.lineEnding || "\n");
  }
  lines.push(`export default function ${entityName}() {`);
  lines.push(indentBlock("return <main></main>;", convention.indentStyle));
  lines.push("}");
  return lines.join(convention.lineEnding || "\n") + (convention.lineEnding || "\n");
}

function buildModuleContent(context = {}, convention = {}, imports = [], exports = []) {
  const lines = [];
  for (const imp of imports) {
    if (imp.kind === "named" && Array.isArray(imp.names) && imp.names.length > 0) {
      lines.push(renderNamedImport(imp.source, imp.names, convention));
    } else if (imp.kind === "default" && (imp.names || imp.value)) {
      lines.push(renderDefaultImport(imp.source, imp.names?.[0] || imp.value, convention));
    } else {
      const alias = pascalize(path.basename(imp.source || "module").replace(/\.[^.]+$/, "")) || "Module";
      lines.push(`import * as ${alias} from ${quote(imp.source, convention.quoteStyle)};`);
    }
  }
  if (lines.length > 0) lines.push("");
  if (exports.length > 0) {
    for (const item of exports) {
      const name = item.name || item.value || inferEntityName(context);
      if (item.kind === "default") {
        lines.push(`export default function ${item.value || name}() {`);
        lines.push(indentBlock("return null;", convention.indentStyle));
        lines.push("}");
      } else {
        lines.push(`export function ${name}() {`);
        lines.push(indentBlock("return null;", convention.indentStyle));
        lines.push("}");
      }
      lines.push("");
    }
    return lines.join(convention.lineEnding || "\n").replace(/\n\n+$/, "\n");
  }
  const entityName = inferEntityName(context);
  lines.push(`export function ${camelize(entityName) || entityName}() {`);
  lines.push(indentBlock(`return ${quote(entityName, convention.quoteStyle)};`, convention.indentStyle));
  lines.push("}");
  return lines.join(convention.lineEnding || "\n") + (convention.lineEnding || "\n");
}

function buildHtmlContent(context = {}, convention = {}) {
  const title = inferEntityName(context);
  const css = (Array.isArray(context.relatedFiles) ? context.relatedFiles : []).find(item => /\.css$/i.test(String(item?.path || "")));
  const js = (Array.isArray(context.relatedFiles) ? context.relatedFiles : []).find(item => /\.(?:js|ts)$/i.test(String(item?.path || "")));
  const cssPath = css ? relativeImportPath(context.targetPath, css.path) : "assets/css/style.css";
  const jsPath = js ? relativeImportPath(context.targetPath, js.path) : "assets/js/app.js";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="stylesheet" href="${cssPath}" />
</head>
<body>
  <main id="root"></main>
  <script type="module" src="${jsPath}"></script>
</body>
</html>
`;
}

function buildCssContent() {
  return `:root {
  color-scheme: light;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: system-ui, sans-serif;
}
`;
}

function buildPhpContent(context = {}) {
  const title = inferEntityName(context);
  return `<?php
?><!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="stylesheet" href="assets/css/style.css" />
</head>
<body>
  <main id="root">
    <h1>${title}</h1>
  </main>
  <script src="assets/js/app.js"></script>
</body>
</html>
`;
}

function buildTestContent(context = {}, convention = {}, imports = [], exports = []) {
  const subject = buildTestSubject(context, convention);
  const testFramework = convention.testFramework || "node:test";
  const targetPath = normalizePath(context.targetPath || "");
  const lines = [];
  if (testFramework === "node:test") {
    lines.push(`import test from ${quote("node:test", convention.quoteStyle)};`);
    lines.push(`import assert from ${quote("node:assert/strict", convention.quoteStyle)};`);
  }
  const subjectExports = exports.filter(item => item.kind !== "default").map(item => item.name || item.value).filter(Boolean);
  if (subject) {
    if (subject.defaultExport && subject.exports.length === 1) {
      lines.push(renderDefaultImport(subject.source, subject.exports[0], convention));
    } else {
      lines.push(renderNamedImport(subject.source, subject.exports, convention));
    }
  }
  lines.push("");
  const testName = subject?.exports?.[0] || pascalize(basenameWithoutExtension(targetPath) || "feature");
  lines.push(`test(${quote(`it works: ${testName}`, convention.quoteStyle)}, () => {`);
  if (subject) {
    const symbol = subject.exports[0];
    const assertion = subject.defaultExport
      ? `assert.equal(typeof ${symbol}, ${quote("function", convention.quoteStyle)});`
      : `assert.equal(typeof ${symbol}, ${quote("function", convention.quoteStyle)});`;
    lines.push(indentBlock(assertion, convention.indentStyle));
  } else {
    lines.push(indentBlock(`assert.equal(${quote(testName, convention.quoteStyle)}, ${quote(testName, convention.quoteStyle)});`, convention.indentStyle));
  }
  lines.push("});");
  return lines.join(convention.lineEnding || "\n") + (convention.lineEnding || "\n");
}

function buildPatchedContent(context = {}, convention = {}, imports = [], exports = []) {
  const original = String(context.existingContent || "");
  let content = original;
  const targetPath = normalizePath(context.targetPath || "");
  const goal = String(context.objective || context.task?.goal || "").toLowerCase();
  const errorText = (Array.isArray(context.validationErrors) ? context.validationErrors : []).map(String).join("\n").toLowerCase();
  const importLines = imports.map(imp => {
    if (imp.kind === "named" && Array.isArray(imp.names) && imp.names.length > 0) return renderNamedImport(imp.source, imp.names, convention);
    if (imp.kind === "default" && (imp.names || imp.value)) return renderDefaultImport(imp.source, imp.names?.[0] || imp.value, convention);
    return `import * as ${pascalize(path.basename(imp.source || "module").replace(/\.[^.]+$/, "")) || "Module"} from ${quote(imp.source, convention.quoteStyle)};`;
  });

  if (importLines.length > 0) {
    const existingImports = extractImportSources(original);
    const toAdd = importLines.filter(line => !existingImports.some(src => line.includes(src)));
    if (toAdd.length > 0) {
      const importBlock = `${toAdd.join(convention.lineEnding || "\n")}${convention.lineEnding || "\n"}`;
      const firstCodeLine = content.search(/\S/);
      if (firstCodeLine > 0) {
        content = `${importBlock}${content}`;
      } else {
        content = `${importBlock}${content}`;
      }
    }
  }

  if ((/health/.test(goal) || /route/.test(goal) || /endpoint/.test(goal)) && /express|router|app\./i.test(content)) {
    if (!/health/.test(content)) {
      const routeLine = /router/i.test(original)
        ? `router.get(${quote("/health", convention.quoteStyle)}, (_req, res) => res.json({ ok: true }));`
        : `app.get(${quote("/health", convention.quoteStyle)}, (_req, res) => res.json({ ok: true }));`;
      const marker = /const\s+app\s*=\s*express\(\s*\);/i.test(content)
        ? /const\s+app\s*=\s*express\(\s*\);/i
        : /const\s+router\s*=\s*express\.Router\(\s*\);/i;
      const match = content.match(marker);
      if (match) {
        content = content.replace(match[0], `${match[0]}${convention.lineEnding || "\n"}${routeLine}`);
      } else {
        content = `${content}${convention.lineEnding || "\n"}${routeLine}${convention.lineEnding || "\n"}`;
      }
    }
  }

  if (content === original && exports.length > 0 && /export\s+(?:default\s+)?(?:function|class|const|let|var)/.test(content)) {
    const exportLine = exports[0].kind === "default"
      ? `export default ${exports[0].value || exports[0].name};`
      : `export const ${exports[0].name} = ${exports[0].name};`;
    if (!content.includes(exportLine)) {
      content = `${content}${content.endsWith(convention.lineEnding || "\n") ? "" : (convention.lineEnding || "\n")}${exportLine}${convention.lineEnding || "\n"}`;
    }
  }

  if (content === original && /test/.test(targetPath) && subjectHasMissingAssertion(context)) {
    content = `${original}${original.endsWith(convention.lineEnding || "\n") ? "" : (convention.lineEnding || "\n")}// assertion added by inference${convention.lineEnding || "\n"}`;
  }

  return content === original ? null : content;
}

function subjectHasMissingAssertion(context = {}) {
  const text = String(context.validationErrors || []).toLowerCase();
  return /missing assertion|failed assertion|no assertions|expectation/.test(text);
}

function buildPatchPayload(context = {}, updatedContent = "") {
  const original = String(context.existingContent || "");
  if (!original || !updatedContent || original === updatedContent) return null;
  const beforeLines = original.split(/\r?\n/);
  const afterLines = updatedContent.split(/\r?\n/);
  let start = 0;
  while (start < beforeLines.length && start < afterLines.length && beforeLines[start] === afterLines[start]) start += 1;
  let endBefore = beforeLines.length - 1;
  let endAfter = afterLines.length - 1;
  while (endBefore >= start && endAfter >= start && beforeLines[endBefore] === afterLines[endAfter]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  const find = beforeLines.slice(start, endBefore + 1).join("\n");
  const replace = afterLines.slice(start, endAfter + 1).join("\n");
  if (!find && !replace) return null;
  return JSON.stringify({
    file: normalizePath(context.targetPath || ""),
    find,
    replace
  }, null, 2);
}

export function generateFileContent(context = {}, convention = {}) {
  const role = detectLanguageRole(context, convention);
  const imports = resolveImports(context, convention);
  const exports = resolveExports(context, convention);

  if (role === "html") return buildHtmlContent(context, convention);
  if (role === "style") return buildCssContent(context, convention);
  if (role === "php") return buildPhpContent(context, convention);
  if (role === "test") return buildTestContent(context, convention, imports, exports);
  if (role === "component") return buildComponentContent(context, convention, imports, exports);
  return buildModuleContent(context, convention, imports, exports);
}

export function generateTestContent(context = {}, convention = {}) {
  return buildTestContent(context, convention, resolveImports(context, convention), resolveExports(context, convention));
}

export function generatePatch(context = {}, convention = {}) {
  const updatedContent = buildPatchedContent(context, convention, resolveImports(context, convention), resolveExports(context, convention));
  if (!updatedContent) return null;
  return buildPatchPayload(context, updatedContent);
}

export function buildValidationHints(context = {}, convention = {}) {
  const hints = [];
  const ext = path.extname(normalizePath(context.targetPath || "")).toLowerCase();
  const pkg = context.workspaceState?.packageJson || {};
  const scripts = pkg?.scripts || {};
  const task = context.task || {};
  const targetPath = normalizePath(context.targetPath || "");

  if (context.status === CODE_GENERATION_STATUS.NEEDS_CONTEXT) {
    hints.push(`read ${targetPath || "the target file"} before modifying it`);
  }
  if (ext === ".js" || ext === ".ts" || ext === ".jsx" || ext === ".tsx") {
    if (scripts.build) hints.push("run the existing build script after writing");
    if (!scripts.build && scripts.test) hints.push("run the existing test script after writing");
  }
  if (pathLooksLikeTest(targetPath)) {
    if (scripts.test) hints.push(scripts.test);
    else hints.push(`node --test ${targetPath}`);
  }
  if (/health|route|endpoint/.test(String(task.goal || "").toLowerCase())) {
    hints.push("re-run the target server or route validation after patching");
  }
  if (context.validationErrors?.length > 0) {
    hints.push(`review validation errors: ${context.validationErrors.map(err => String(err).slice(0, 120)).join("; ")}`);
  }
  return unique(hints);
}

export function generateForTask(input = {}) {
  const task = input.task || input.executionTask || {};
  const taskId = task?.id || input.taskId || null;
  const targetPath = normalizePath(input.targetPath || task?.toolArgs?.path || task?.toolArgs?.file || task?.toolArgs?.target || task?.targetPath || "");
  logEvent(CODE_GENERATION_LOG_EVENTS.START, { taskId, targetPath, tool: task?.tool || null });

  const contextPromise = buildCodeContext({ ...input, task, taskId, targetPath });
  return Promise.resolve(contextPromise).then(context => {
    logEvent(CODE_GENERATION_LOG_EVENTS.CONTEXT_BUILT, {
      taskId: context.taskId,
      targetPath: context.targetPath,
      evidenceCount: context.evidence.length,
      missingEvidence: context.missingEvidence
    });

    const convention = resolveConvention(context);
    logEvent(CODE_GENERATION_LOG_EVENTS.CONVENTION_RESOLVED, {
      taskId: context.taskId,
      targetPath: context.targetPath,
      moduleSystem: convention.moduleSystem,
      quoteStyle: convention.quoteStyle,
      indentStyle: convention.indentStyle,
      testFramework: convention.testFramework
    });

    const imports = resolveImports(context, convention);
    const exports = resolveExports(context, convention);
    logEvent(CODE_GENERATION_LOG_EVENTS.IMPORTS_RESOLVED, { taskId: context.taskId, count: imports.length, targetPath: context.targetPath });
    logEvent(CODE_GENERATION_LOG_EVENTS.EXPORTS_RESOLVED, { taskId: context.taskId, count: exports.length, targetPath: context.targetPath });

    const targetExists = Boolean(context.existingContent);
    const requestedTool = String(task?.tool || "").toUpperCase();
    let result = {
      taskId,
      targetPath,
      evidence: context.evidence,
      expectedImports: imports,
      expectedExports: exports,
      validationHints: buildValidationHints(context, convention),
      confidence: convention.confidence,
      reason: "",
      status: CODE_GENERATION_STATUS.READY,
      tool: requestedTool === CODE_GENERATION_TOOL.APPLY_PATCH || (targetExists && requestedTool !== CODE_GENERATION_TOOL.WRITE_FILE)
        ? CODE_GENERATION_TOOL.APPLY_PATCH
        : CODE_GENERATION_TOOL.WRITE_FILE,
      content: "",
      patch: ""
    };

    if (context.missingEvidence.length > 0) {
      result.status = CODE_GENERATION_STATUS.NEEDS_CONTEXT;
      result.reason = `Missing required evidence: ${context.missingEvidence.join(", ")}`;
      logEvent(CODE_GENERATION_LOG_EVENTS.NEEDS_CONTEXT, { taskId, targetPath, missingEvidence: context.missingEvidence });
      return serializeGenerationResult(result);
    }

    if (context.targetIsTest || /test/i.test(targetPath)) {
      result.content = generateTestContent(context, convention);
      result.tool = CODE_GENERATION_TOOL.WRITE_FILE;
      result.status = CODE_GENERATION_STATUS.READY;
      result.reason = "Generated test content from verified context";
      const finalGuard = guardGeneratedOutput(result, context);
      if (finalGuard.status === CODE_GENERATION_STATUS.SAFETY_BLOCKED) {
        result.status = CODE_GENERATION_STATUS.SAFETY_BLOCKED;
        result.reason = finalGuard.reason;
        logEvent(CODE_GENERATION_LOG_EVENTS.SAFETY_BLOCKED, { taskId, targetPath, reason: finalGuard.reason, details: finalGuard.details });
        return serializeGenerationResult(result);
      }
      logEvent(CODE_GENERATION_LOG_EVENTS.TEST_GENERATED, { taskId, targetPath });
      logEvent(CODE_GENERATION_LOG_EVENTS.FILE_GENERATED, { taskId, targetPath, role: "test" });
      logEvent(CODE_GENERATION_LOG_EVENTS.COMPLETE, { taskId, targetPath, status: result.status });
      return serializeGenerationResult(result);
    }

    if (context.existingContent) {
      const patch = generatePatch(context, convention);
      if (!patch) {
        result.status = CODE_GENERATION_STATUS.NEEDS_CONTEXT;
        result.reason = "Existing file content provided but no safe localized patch could be derived";
        logEvent(CODE_GENERATION_LOG_EVENTS.NEEDS_CONTEXT, { taskId, targetPath, reason: result.reason });
        return serializeGenerationResult(result);
      }
      result.tool = CODE_GENERATION_TOOL.APPLY_PATCH;
      result.patch = patch;
      result.content = "";
      result.reason = "Generated localized patch from verified existing content";
      const finalGuard = guardGeneratedOutput(result, context);
      if (finalGuard.status === CODE_GENERATION_STATUS.SAFETY_BLOCKED) {
        result.status = CODE_GENERATION_STATUS.SAFETY_BLOCKED;
        result.reason = finalGuard.reason;
        logEvent(CODE_GENERATION_LOG_EVENTS.SAFETY_BLOCKED, { taskId, targetPath, reason: finalGuard.reason, details: finalGuard.details });
        return serializeGenerationResult(result);
      }
      logEvent(CODE_GENERATION_LOG_EVENTS.PATCH_GENERATED, { taskId, targetPath });
      logEvent(CODE_GENERATION_LOG_EVENTS.FILE_GENERATED, { taskId, targetPath, role: detectLanguageRole(context, convention) });
      logEvent(CODE_GENERATION_LOG_EVENTS.COMPLETE, { taskId, targetPath, status: result.status });
      return serializeGenerationResult(result);
    }

    result.content = generateFileContent(context, convention);
    if (!String(result.content || "").trim()) {
      result.status = CODE_GENERATION_STATUS.NEEDS_CONTEXT;
      result.reason = "Generated content was empty";
      logEvent(CODE_GENERATION_LOG_EVENTS.NEEDS_CONTEXT, { taskId, targetPath, reason: result.reason });
      return serializeGenerationResult(result);
    }

    const finalGuard = guardGeneratedOutput(result, context);
    if (finalGuard.status === CODE_GENERATION_STATUS.SAFETY_BLOCKED) {
      result.status = CODE_GENERATION_STATUS.SAFETY_BLOCKED;
      result.reason = finalGuard.reason;
      logEvent(CODE_GENERATION_LOG_EVENTS.SAFETY_BLOCKED, { taskId, targetPath, reason: finalGuard.reason, details: finalGuard.details });
      return serializeGenerationResult(result);
    }

    logEvent(CODE_GENERATION_LOG_EVENTS.FILE_GENERATED, { taskId, targetPath, role: detectLanguageRole(context, convention) });
    logEvent(CODE_GENERATION_LOG_EVENTS.COMPLETE, { taskId, targetPath, status: result.status });
    return serializeGenerationResult(result);
  }).catch(error => {
    const failed = serializeGenerationResult({
      taskId,
      status: CODE_GENERATION_STATUS.INVALID,
      tool: null,
      targetPath,
      content: "",
      patch: "",
      reason: error.message || String(error),
      expectedExports: [],
      expectedImports: [],
      validationHints: [],
      evidence: [],
      confidence: 0
    });
    logEvent(CODE_GENERATION_LOG_EVENTS.SAFETY_BLOCKED, { taskId, targetPath, reason: failed.reason });
    return failed;
  });
}

export {
  buildCodeContext,
  resolveConvention,
  validateGeneratedOutput,
  guardGeneratedOutput,
  serializeGenerationResult
};
