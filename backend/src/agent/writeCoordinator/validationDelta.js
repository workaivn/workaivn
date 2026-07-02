import { parse as parseJavaScript } from "@babel/parser";

const DELTA_PATCH_OPERATIONS = new Set([
  "replace_imports",
  "replace_content",
  "replace_file",
  "patch",
  "append",
  "prepend"
]);

const DELTA_ROOT_ARRAY_KEYS = ["patches", "files"];

function logDeltaRetry(eventName, payload = {}) {
  console.log(`[${eventName}]`, payload);
}

function normalizePath(value = "") {
  return String(value || "").replace(/\\/g, "/").trim();
}

function detectLanguageFromPath(targetPath = "") {
  const normalized = normalizePath(targetPath).toLowerCase();
  if (normalized.endsWith(".ts") || normalized.endsWith(".tsx")) return "typescript";
  if (normalized.endsWith(".js") || normalized.endsWith(".jsx") || normalized.endsWith(".mjs") || normalized.endsWith(".cjs")) return "javascript";
  if (normalized.endsWith(".html") || normalized.endsWith(".htm")) return "html";
  if (normalized.endsWith(".css") || normalized.endsWith(".scss") || normalized.endsWith(".sass")) return "css";
  if (normalized.endsWith(".md") || normalized.endsWith(".markdown") || normalized.endsWith(".rst")) return "markdown";
  if (normalized.endsWith(".json") || normalized.endsWith(".jsonc") || normalized.endsWith(".json5")) return "json";
  if (normalized.endsWith(".py")) return "python";
  if (normalized.endsWith(".php")) return "php";
  if (normalized.endsWith(".rb")) return "ruby";
  if (normalized.endsWith(".java")) return "java";
  if (normalized.endsWith(".cs")) return "csharp";
  return "unknown";
}

function validateJsonLikeContent(text = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return { success: false, reason: "empty_content" };
  }
  try {
    JSON.parse(trimmed);
    return { success: true };
  } catch (error) {
    return { success: false, reason: `invalid_json: ${error.message}` };
  }
}

function validateHtmlLikeContent(text = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return { success: false, reason: "empty_content" };
  }
  const hasTag = /<\s*[a-z!][^>]*>/i.test(trimmed);
  const hasStructuralHint = /<!doctype\s+html|<html\b|<\/[a-z][^>]*>/i.test(trimmed);
  if (!hasTag) return { success: false, reason: "missing_html_tags" };
  if (!hasStructuralHint) return { success: true };
  return { success: true };
}

function validateCssLikeContent(text = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return { success: false, reason: "empty_content" };
  }
  const hasCssSyntax = /@(?:tailwind|layer|media|keyframes)\b|:[^;\n{}]+;|{[\s\S]*}/i.test(trimmed);
  if (!hasCssSyntax) {
    return { success: false, reason: "non_css_content" };
  }
  return { success: true };
}

function validateMarkdownLikeContent(text = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return { success: false, reason: "empty_content" };
  }
  return { success: true };
}

function extractJsonPayload(rawResponse) {
  if (rawResponse && typeof rawResponse === "object") {
    return { value: rawResponse, schema: "object" };
  }

  const rawText = String(rawResponse || "").trim();
  if (!rawText) return null;

  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    return { text: fenced[1].trim(), schema: "markdown_wrapped_json" };
  }

  const firstBrace = rawText.indexOf("{");
  const lastBrace = rawText.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return { text: rawText.slice(firstBrace, lastBrace + 1).trim(), schema: "embedded_json" };
  }

  return { text: rawText, schema: "raw_json" };
}

function parseJsonPayload(rawResponse) {
  if (rawResponse && typeof rawResponse === "object") return rawResponse;
  const extracted = extractJsonPayload(rawResponse);
  if (!extracted) return null;
  if (extracted.value) return extracted.value;
  try {
    return JSON.parse(extracted.text);
  } catch {
    return null;
  }
}

function detectDeltaSchema(parsed) {
  if (!parsed || typeof parsed !== "object") return "invalid";
  if (Array.isArray(parsed)) {
    const looksLikePatches = parsed.every(entry => entry && typeof entry === "object" && (
      Object.prototype.hasOwnProperty.call(entry, "operation") ||
      Object.prototype.hasOwnProperty.call(entry, "action") ||
      Object.prototype.hasOwnProperty.call(entry, "patch") ||
      Object.prototype.hasOwnProperty.call(entry, "replace")
    ));
    return looksLikePatches ? "patches" : "files";
  }
  if (Array.isArray(parsed.patches)) return "patches";
  if (Array.isArray(parsed.files)) return "files";
  if (parsed.path || parsed.file || parsed.targetPath || parsed.target) return "single";
  return "invalid";
}

function coerceContent(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(item => String(item ?? "")).join("\n");
  if (value && typeof value === "object") {
    if (typeof value.content === "string") return value.content;
    if (typeof value.text === "string") return value.text;
    if (typeof value.code === "string") return value.code;
    if (typeof value.source === "string") return value.source;
  }
  return "";
}

function normalizeDeltaPatch(patch, { defaultOperation = "replace_content", allowedPaths = null, schema = "single" } = {}) {
  if (!patch || typeof patch !== "object") {
    return { patch: null, reason: "Patch is not an object" };
  }

  const path = normalizePath(patch.path || patch.file || patch.targetPath || patch.target || "");
  const operation = String(patch.operation || patch.action || defaultOperation || "").toLowerCase().trim();
  const content = coerceContent(patch.content ?? patch.text ?? patch.code ?? patch.source ?? patch.body ?? patch.patch);
  const contentText = String(content || "");

  if (!path) {
    return { patch: null, reason: "Patch is missing a path" };
  }

  if (allowedPaths instanceof Set && allowedPaths.size > 0 && !allowedPaths.has(path)) {
    return { patch: null, reason: `Unexpected patch path: ${path}` };
  }

  if (!DELTA_PATCH_OPERATIONS.has(operation)) {
    return { patch: null, reason: `Unknown patch operation: ${operation || "(missing)"}` };
  }

  if (!contentText.trim()) {
    return { patch: null, reason: `Patch for ${path} has empty content` };
  }

  const normalizedOperation =
    operation === "patch" || operation === "replace_content"
      ? "replace_content"
      : operation === "replace_file"
        ? "replace_file"
        : operation === "append"
          ? "append"
          : operation === "prepend"
            ? "prepend"
            : "replace_imports";

  const normalizedPatch = {
    path,
    operation: normalizedOperation,
    content: contentText
  };

  if (schema === "files") {
    normalizedPatch.operation = normalizedOperation === "replace_imports" ? "replace_content" : normalizedOperation;
  }

  return { patch: normalizedPatch, reason: null };
}

function normalizeDeltaPatchList(parsed, expectedPaths = []) {
  const schema = detectDeltaSchema(parsed);
  const allowedPaths = new Set((Array.isArray(expectedPaths) ? expectedPaths : []).map(normalizePath).filter(Boolean));
  const patches = [];
  const errors = [];

  if (schema === "invalid") {
    return { schema, patches, errors: ["Unsupported delta retry schema"] };
  }

  logDeltaRetry("DELTA_RETRY_SCHEMA_DETECTED", {
    schema,
    patchArray: Array.isArray(parsed.patches),
    fileArray: Array.isArray(parsed.files),
    hasSingleObject: Boolean(parsed.path || parsed.file || parsed.targetPath || parsed.target)
  });

  const sourceEntries = Array.isArray(parsed)
    ? parsed
    : schema === "patches"
      ? Array.isArray(parsed.patches) ? parsed.patches : []
      : schema === "files"
        ? Array.isArray(parsed.files) ? parsed.files : []
        : [parsed];

  for (const entry of sourceEntries) {
    const normalized = normalizeDeltaPatch(entry, {
      defaultOperation: schema === "files" ? "replace_file" : "replace_content",
      allowedPaths,
      schema
    });
    if (!normalized.patch) {
      errors.push(normalized.reason || "Invalid patch");
      logDeltaRetry("DELTA_RETRY_PATCH_REJECTED", {
        schema,
        reason: normalized.reason || "Invalid patch",
        path: normalizePath(entry?.path || entry?.file || entry?.targetPath || entry?.target || "")
      });
      continue;
    }
    patches.push(normalized.patch);
    logDeltaRetry("DELTA_RETRY_PATCH_NORMALIZED", {
      schema,
      path: normalized.patch.path,
      operation: normalized.patch.operation,
      contentLength: normalized.patch.content.length
    });
  }

  return { schema, patches, errors };
}

function extractExportNames(content) {
  const names = [];
  const EXPORT_RX = /export\s+(?:default\s+)?(?:function\s+(\w+)|const\s+(\w+)|let\s+(\w+)|var\s+(\w+)|class\s+(\w+))/g;
  let match;
  while ((match = EXPORT_RX.exec(content)) !== null) {
    names.push(match[1] || match[2] || match[3] || match[4] || match[5]);
  }
  return [...new Set(names)];
}

function extractImportModules(content) {
  const modules = [];
  try {
    const ast = parseJavaScript(content, {
      sourceType: "unambiguous",
      allowReturnOutsideFunction: true,
      plugins: ["jsx", "typescript", "classProperties", "classPrivateProperties", "classPrivateMethods", "dynamicImport", "importMeta", "topLevelAwait"]
    });
    for (const node of ast.program.body) {
      if (node.type === "ImportDeclaration") {
        modules.push(node.source.value);
      }
    }
  } catch {}
  return modules;
}

function extractImportNames(content) {
  const names = new Set();
  try {
    const ast = parseJavaScript(content, {
      sourceType: "unambiguous",
      allowReturnOutsideFunction: true,
      plugins: ["jsx", "typescript", "classProperties", "classPrivateProperties", "classPrivateMethods", "dynamicImport", "importMeta", "topLevelAwait"]
    });
    for (const node of ast.program.body) {
      if (node.type !== "ImportDeclaration") continue;
      for (const spec of node.specifiers) {
        if (spec.type === "ImportDefaultSpecifier") names.add(spec.local.name);
        else if (spec.type === "ImportNamespaceSpecifier") names.add("*");
        else if (spec.type === "ImportSpecifier") names.add(spec.imported.name);
      }
    }
  } catch {}
  return [...names];
}

function hasExecutableTestSignal(content = "") {
  const text = String(content || "");
  return (
    /\btest\s*\(/i.test(text) ||
    /\bdescribe\s*\(/i.test(text) ||
    /\bit\s*\(/i.test(text) ||
    /\bexpect\s*\(/i.test(text) ||
    /\bassert\.[A-Za-z_$][\w$]*\s*\(/i.test(text) ||
    /\bthrow\s+new\s+Error\s*\(/i.test(text)
  );
}

function hasExecutableBody(ast) {
  if (!ast?.program?.body) return false;
  return ast.program.body.some(node => !node || !["ImportDeclaration", "EmptyStatement"].includes(node.type));
}

function replaceImportBlock(content, newImportContent) {
  const importLines = [];
  const nonImportLines = [];
  const lines = content.split("\n");
  let inImportBlock = true;
  for (const line of lines) {
    if (inImportBlock && /^\s*import\s/.test(line)) {
      importLines.push(line);
    } else if (inImportBlock && line.trim() === "") {
      importLines.push(line);
    } else {
      inImportBlock = false;
      nonImportLines.push(line);
    }
  }
  if (importLines.length === 0) return content;
  const newImports = newImportContent.split("\n");
  const mergedImports = [...newImports, ""];
  return [...mergedImports, ...nonImportLines].join("\n");
}

function removeExportBlock(content, exportName) {
  const rx = new RegExp(
    `export\\s+(?:default\\s+)?(?:function\\s+${exportName}|const\\s+${exportName}|let\\s+${exportName}|var\\s+${exportName}|class\\s+${exportName})`
  );
  const match = rx.exec(content);
  if (!match) return content;
  const start = match.index;
  let i = start;
  let braceCount = 0;
  let firstBrace = false;
  let inString = false;
  let stringChar = null;
  while (i < content.length) {
    const ch = content[i];
    if (inString) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === stringChar) inString = false;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = true;
      stringChar = ch;
      i++;
      continue;
    }
    if (ch === "{") { braceCount++; firstBrace = true; }
    if (ch === "}") { braceCount--; }
    if (firstBrace && braceCount === 0) {
      const block = content.slice(start, i + 1);
      return content.replace(block, "");
    }
    i++;
  }
  const semiIdx = content.indexOf(";", start);
  if (semiIdx >= start) {
    return content.slice(0, start) + content.slice(semiIdx + 1);
  }
  return content;
}

export function buildValidationDelta({
  targetPath,
  previousContent,
  validationErrors,
  frameworkValidation,
  role,
  requiredExports,
  requiredReferences
} = {}) {
  const content = String(previousContent || "");
  const preserveExports = extractExportNames(content);
  const preserveImports = extractImportNames(content);
  const preserveModules = extractImportModules(content);

  const missingExports = [];
  const missingReferences = [];
  const frameworkIssues = [];
  const placeholderIssues = [];
  const repairInstructions = [];

  if (role === "implementation" && Array.isArray(requiredExports)) {
    for (const exp of requiredExports) {
      if (!preserveExports.includes(exp) && !new RegExp(`\\b${String(exp).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(content)) {
        missingExports.push(exp);
      }
    }
  }

  if (role === "test" && Array.isArray(requiredReferences)) {
    for (const ref of requiredReferences) {
      if (!new RegExp(`\\b${String(ref).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(content)) {
        missingReferences.push(ref);
      }
    }
  }

  if (frameworkValidation && frameworkValidation.success === false) {
    if (Array.isArray(frameworkValidation.repairInstructions)) {
      for (const instr of frameworkValidation.repairInstructions) {
        frameworkIssues.push(instr);
        repairInstructions.push(instr);
      }
    }
    if (Array.isArray(frameworkValidation.illegalImports) && frameworkValidation.illegalImports.length > 0) {
      for (const imp of frameworkValidation.illegalImports) {
        frameworkIssues.push(`Illegal import: ${imp}`);
      }
    }
    if (Array.isArray(frameworkValidation.illegalCalls) && frameworkValidation.illegalCalls.length > 0) {
      for (const call of frameworkValidation.illegalCalls) {
        frameworkIssues.push(`Illegal call: ${call}()`);
      }
    }
  }

  if (/TODO|FIXME|placeholder|implement this/i.test(content)) {
    placeholderIssues.push("File contains placeholder text");
  }

  if (missingExports.length > 0) {
    repairInstructions.push(`Add missing exports: ${missingExports.join(", ")}`);
  }
  if (missingReferences.length > 0) {
    repairInstructions.push(`Add tests for: ${missingReferences.join(", ")}`);
  }

  const hasMissingContent = missingExports.length > 0 || missingReferences.length > 0;
  const hasFrameworkIssues = frameworkIssues.length > 0;
  const hasPlaceholderIssues = placeholderIssues.length > 0;
  const hasIssues = hasMissingContent || hasFrameworkIssues || hasPlaceholderIssues;

  let retryMode = "patch";
  if (!content || content.trim().length === 0) {
    retryMode = "full";
  }

  const failedRegions = [];
  if (missingExports.length > 0) {
    for (const exp of missingExports) failedRegions.push({ type: "missing_export", target: exp });
  }
  if (missingReferences.length > 0) {
    for (const ref of missingReferences) failedRegions.push({ type: "missing_reference", target: ref });
  }
  if (frameworkIssues.length > 0) {
    failedRegions.push({ type: "framework_issue", details: frameworkIssues.join("; ") });
  }
  if (placeholderIssues.length > 0) {
    failedRegions.push({ type: "placeholder", details: placeholderIssues[0] });
  }

  return {
    targetPath,
    preserveRegions: [...preserveExports],
    failedRegions,
    missingExports,
    missingReferences,
    frameworkIssues,
    placeholderIssues,
    repairInstructions,
    retryMode
  };
}

export function mergeCoordinatorPatch(previousContent, patches) {
  let merged = String(previousContent || "");

  for (const patch of Array.isArray(patches) ? patches : []) {
    const op = String(patch.operation || "").toLowerCase();
    const content = String(patch.content || "");

    switch (op) {
      case "append":
        merged = merged.trimEnd() + "\n\n" + content.trim() + "\n";
        break;

      case "prepend":
        merged = content.trim() + "\n\n" + merged.trimStart();
        break;

      case "replace_imports":
        merged = replaceImportBlock(merged, content);
        break;

      case "replace_region":
        if (patch.regionId) {
          merged = removeExportBlock(merged, patch.regionId);
          merged = merged.trimEnd() + "\n\n" + content.trim() + "\n";
        }
        break;

      case "replace_file":
      case "replace_content":
      case "patch":
        merged = content;
        break;

      default:
        break;
    }
  }

  return merged;
}

export function validateMonotonic({
  originalContent,
  mergedContent,
  role,
  requiredExports,
  requiredReferences
} = {}) {
  const originalExports = extractExportNames(originalContent);
  const mergedExports = extractExportNames(mergedContent);
  const originalImports = extractImportNames(originalContent);
  const mergedImports = extractImportNames(mergedContent);

  for (const name of originalExports) {
    if (!mergedExports.includes(name)) {
      return { passed: false, reason: `Export "${name}" was lost` };
    }
  }

  if (Array.isArray(requiredExports)) {
    for (const name of requiredExports) {
      if (!mergedExports.includes(name) && !new RegExp(`\\b${name}\\b`).test(mergedContent)) {
        return { passed: false, reason: `Required export "${name}" is missing` };
      }
    }
  }

  if (Array.isArray(requiredReferences)) {
    for (const name of requiredReferences) {
      if (!new RegExp(`\\b${name}\\b`).test(mergedContent)) {
        return { passed: false, reason: `Required reference "${name}" was lost` };
      }
    }
  }

  return { passed: true };
}

export function validateStructuralContent({
  targetPath = "",
  content = "",
  previousContent = "",
  role = "implementation",
  requiredExports = [],
  requiredReferences = [],
  frameworkValidation = null
} = {}) {
  const text = String(content || "");
  const originalText = String(previousContent || "");
  const normalizedRole = String(role || "").trim().toLowerCase();
  const detectedLanguage = detectLanguageFromPath(targetPath);
  console.log("[STRUCTURAL_VALIDATION_ROLE_SELECTED]", {
    targetPath,
    role: normalizedRole || "implementation"
  });
  console.log("[STRUCTURAL_VALIDATION_LANGUAGE_SELECTED]", {
    targetPath,
    language: detectedLanguage
  });
  const supportsJavaScriptStructuralParse = detectedLanguage === "javascript" || detectedLanguage === "typescript" || detectedLanguage === "unknown";

  if (!text.trim()) {
    return {
      success: false,
      reason: "empty_content",
      retryMode: "full",
      targetPath,
      hasExecutableBody: false,
      hasTestSignal: false,
      details: { targetPath, role: normalizedRole, contentLength: 0 }
    };
  }

  if (detectedLanguage === "json") {
    console.log("[STATIC_FILE_VALIDATION]", { targetPath, language: detectedLanguage, role: normalizedRole });
    const result = validateJsonLikeContent(text);
    console.log(result.success ? "[STATIC_FILE_VALIDATION_PASS]" : "[STATIC_FILE_VALIDATION_FAIL]", {
      targetPath,
      language: detectedLanguage,
      role: normalizedRole,
      reason: result.reason || null
    });
    if (!result.success) {
      return {
        success: false,
        reason: result.reason || "invalid_json",
        retryMode: "full",
        targetPath,
        hasExecutableBody: false,
        hasTestSignal: false,
        details: { targetPath, role: normalizedRole, contentLength: text.length, language: detectedLanguage }
      };
    }
    return {
      success: true,
      reason: null,
      retryMode: "patch",
      targetPath,
      hasExecutableBody: false,
      hasTestSignal: false,
      details: { targetPath, role: normalizedRole, contentLength: text.length, language: detectedLanguage }
    };
  }

  if (detectedLanguage === "html") {
    console.log("[STATIC_FILE_VALIDATION]", { targetPath, language: detectedLanguage, role: normalizedRole });
    const result = validateHtmlLikeContent(text);
    console.log(result.success ? "[STATIC_FILE_VALIDATION_PASS]" : "[STATIC_FILE_VALIDATION_FAIL]", {
      targetPath,
      language: detectedLanguage,
      role: normalizedRole,
      reason: result.reason || null
    });
    if (!result.success) {
      return {
        success: false,
        reason: result.reason || "invalid_html",
        retryMode: "full",
        targetPath,
        hasExecutableBody: false,
        hasTestSignal: false,
        details: { targetPath, role: normalizedRole, contentLength: text.length, language: detectedLanguage }
      };
    }
    return {
      success: true,
      reason: null,
      retryMode: "patch",
      targetPath,
      hasExecutableBody: false,
      hasTestSignal: false,
      details: { targetPath, role: normalizedRole, contentLength: text.length, language: detectedLanguage }
    };
  }

  if (detectedLanguage === "css") {
    console.log("[STATIC_FILE_VALIDATION]", { targetPath, language: detectedLanguage, role: normalizedRole });
    const result = validateCssLikeContent(text);
    console.log(result.success ? "[STATIC_FILE_VALIDATION_PASS]" : "[STATIC_FILE_VALIDATION_FAIL]", {
      targetPath,
      language: detectedLanguage,
      role: normalizedRole,
      reason: result.reason || null
    });
    if (!result.success) {
      return {
        success: false,
        reason: result.reason || "invalid_css",
        retryMode: "full",
        targetPath,
        hasExecutableBody: false,
        hasTestSignal: false,
        details: { targetPath, role: normalizedRole, contentLength: text.length, language: detectedLanguage }
      };
    }
    return {
      success: true,
      reason: null,
      retryMode: "patch",
      targetPath,
      hasExecutableBody: false,
      hasTestSignal: false,
      details: { targetPath, role: normalizedRole, contentLength: text.length, language: detectedLanguage }
    };
  }

  if (detectedLanguage === "markdown") {
    console.log("[STATIC_FILE_VALIDATION]", { targetPath, language: detectedLanguage, role: normalizedRole });
    const result = validateMarkdownLikeContent(text);
    console.log(result.success ? "[STATIC_FILE_VALIDATION_PASS]" : "[STATIC_FILE_VALIDATION_FAIL]", {
      targetPath,
      language: detectedLanguage,
      role: normalizedRole,
      reason: result.reason || null
    });
    if (!result.success) {
      return {
        success: false,
        reason: result.reason || "invalid_markdown",
        retryMode: "full",
        targetPath,
        hasExecutableBody: false,
        hasTestSignal: false,
        details: { targetPath, role: normalizedRole, contentLength: text.length, language: detectedLanguage }
      };
    }
    return {
      success: true,
      reason: null,
      retryMode: "patch",
      targetPath,
      hasExecutableBody: false,
      hasTestSignal: false,
      details: { targetPath, role: normalizedRole, contentLength: text.length, language: detectedLanguage }
    };
  }

  let ast = null;
  let importOnly = false;
  let hasExecutable = text.trim().length > 0;
  let hasTestSignal = hasExecutableTestSignal(text);
  if (supportsJavaScriptStructuralParse) {
    try {
      ast = parseJavaScript(text, {
        sourceType: "unambiguous",
        allowReturnOutsideFunction: true,
        plugins: ["jsx", "typescript", "classProperties", "classPrivateProperties", "classPrivateMethods", "dynamicImport", "importMeta", "topLevelAwait"]
      });
    } catch {
      ast = null;
    }

    if (!ast) {
      return {
        success: false,
        reason: "unparseable_content",
        retryMode: "full",
        targetPath,
        hasExecutableBody: false,
        hasTestSignal: false,
        details: { targetPath, role: normalizedRole, contentLength: text.length }
      };
    }

    const topLevelNodes = Array.isArray(ast.program?.body) ? ast.program.body : [];
    importOnly = topLevelNodes.every(node => !node || node.type === "ImportDeclaration" || node.type === "EmptyStatement");
    hasExecutable = hasExecutableBody(ast);
    hasTestSignal = hasExecutableTestSignal(text);
  }
  const previousExports = extractExportNames(originalText);
  const nextExports = extractExportNames(text);

  const missingExports = [];
  for (const exp of Array.isArray(requiredExports) ? requiredExports : []) {
    const name = String(exp || "").trim();
    if (!name) continue;
    if (!nextExports.includes(name) && !new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) {
      missingExports.push(name);
    }
  }

  const missingReferences = [];
  for (const ref of Array.isArray(requiredReferences) ? requiredReferences : []) {
    const name = String(ref || "").trim();
    if (!name) continue;
    if (!new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) {
      missingReferences.push(name);
    }
  }

  if (normalizedRole === "test") {
    if ((supportsJavaScriptStructuralParse && (importOnly || !hasExecutable || !hasTestSignal)) || (!supportsJavaScriptStructuralParse && !text.trim())) {
      return {
        success: false,
        reason: "import_only_or_partial_test_file",
        retryMode: "full",
        targetPath,
        hasExecutableBody: hasExecutable,
        hasTestSignal,
        details: {
          targetPath,
          role: normalizedRole,
          contentLength: text.length,
          previousExportCount: previousExports.length,
          nextExportCount: nextExports.length,
          importOnly,
          framework: frameworkValidation?.framework || null
        }
      };
    }
  } else if (normalizedRole === "implementation") {
    if (previousExports.length > 0 && nextExports.length === 0 && !hasExecutable) {
      return {
        success: false,
        reason: "implementation_lost_executable_surface",
        retryMode: "full",
        targetPath,
        hasExecutableBody: hasExecutable,
        hasTestSignal,
        details: {
          targetPath,
          role: normalizedRole,
          contentLength: text.length,
          previousExportCount: previousExports.length,
          nextExportCount: nextExports.length
        }
      };
    }
  }

  if (missingExports.length > 0 || missingReferences.length > 0) {
    return {
      success: false,
      reason: missingExports.length > 0
        ? `missing_required_exports: ${missingExports.join(", ")}`
        : `missing_required_references: ${missingReferences.join(", ")}`,
      retryMode: "full",
      targetPath,
      hasExecutableBody: hasExecutable,
      hasTestSignal,
      details: {
        targetPath,
        role: normalizedRole,
        contentLength: text.length,
        missingExports,
        missingReferences
      }
    };
  }

  return {
    success: true,
    reason: null,
    retryMode: "patch",
    targetPath,
    hasExecutableBody: hasExecutable,
    hasTestSignal,
    details: {
      targetPath,
      role: normalizedRole,
      contentLength: text.length,
      importOnly,
      framework: frameworkValidation?.framework || null
    }
  };
}

export function buildDeltaRetryPrompt(deltas, frameworkContext = {}) {
  const blocks = [];
  const framework = String(frameworkContext?.framework || "generic-js-test").trim();
  const frameworkContract = frameworkContext?.frameworkContract || null;
  const frameworkHints = frameworkContext?.frameworkHints || null;
  for (const delta of deltas) {
    const lines = [];
    lines.push(`You are repairing one file only.`);
    lines.push(``);
    lines.push(`File:`);
    lines.push(delta.targetPath);
    lines.push(``);
    lines.push(`Preserve existing content exactly unless instructed.`);
    lines.push(``);

    if (frameworkContract) {
      lines.push(`Framework contract:`);
      lines.push(`- framework: ${frameworkContract.framework || framework}`);
      lines.push(`- kind: ${frameworkContract.kind || 'runnable'}`);
      for (const required of frameworkContract.requiredImports || []) {
        lines.push(`- required: ${required}`);
      }
      for (const forbidden of frameworkContract.forbiddenCalls || []) {
        lines.push(`- forbidden call: ${forbidden}`);
      }
      for (const forbidden of frameworkContract.forbiddenImports || []) {
        lines.push(`- forbidden import: ${forbidden}`);
      }
      lines.push(``);
    }

    if (frameworkHints) {
      lines.push(`Framework guidance:`);
      lines.push(`- framework: ${frameworkHints.framework || framework}`);
      lines.push(`- kind: ${frameworkHints.kind || 'style-only'}`);
      if (frameworkHints.importStyle) lines.push(`- importStyle: ${frameworkHints.importStyle}`);
      if (frameworkHints.assertions) lines.push(`- assertions: ${frameworkHints.assertions}`);
      if (frameworkHints.forbidden) lines.push(`- forbidden: ${frameworkHints.forbidden}`);
      lines.push(``);
    }

    if (delta.missingExports.length > 0) {
      lines.push(`Validation delta:`);
      lines.push(`Missing exports:`);
      for (const exp of delta.missingExports) lines.push(`- ${exp}`);
      lines.push(``);
    }

    if (delta.missingReferences.length > 0) {
      lines.push(`Validation delta:`);
      lines.push(`Missing references:`);
      for (const ref of delta.missingReferences) lines.push(`- ${ref}`);
      lines.push(``);
    }

    if (delta.frameworkIssues.length > 0) {
      lines.push(`Framework issues:`);
      for (const issue of delta.frameworkIssues) lines.push(`- ${issue}`);
      lines.push(``);
    }

    if (delta.placeholderIssues.length > 0) {
      lines.push(`Placeholder issues:`);
      for (const issue of delta.placeholderIssues) lines.push(`- ${issue}`);
      lines.push(``);
    }

    if (delta.frameworkIssues.length > 0 || delta.missingExports.length > 0 || delta.missingReferences.length > 0) {
      lines.push(`Return JSON only:`);
      lines.push(`{`);
      lines.push(`  "patches": [`);

      if (delta.missingExports.length > 0) {
        lines.push(`    {`);
        lines.push(`      "path": "${delta.targetPath}",`);
        lines.push(`      "operation": "append",`);
        lines.push(`      "content": "..."`);
        lines.push(`    }`);
      }

      if (delta.missingReferences.length > 0) {
        lines.push(`    {`);
        lines.push(`      "path": "${delta.targetPath}",`);
        lines.push(`      "operation": "append",`);
        lines.push(`      "content": "..."`);
        lines.push(`    }`);
      }

      if (delta.frameworkIssues.length > 0) {
        lines.push(`    {`);
        lines.push(`      "path": "${delta.targetPath}",`);
        lines.push(`      "operation": "replace_imports",`);
        lines.push(`      "content": "..."`);
        lines.push(`    }`);
      }

      lines.push(`  ]`);
      lines.push(`}`);
      lines.push(``);
      lines.push(`Do NOT return full files. Only return patches.`);
    }

    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n---\n\n");
}

export function parseDeltaRetryResponse(rawResponse, expectedPaths) {
  const parsed = parseJsonPayload(rawResponse);
  if (!parsed || typeof parsed !== "object") return null;

  const normalized = normalizeDeltaPatchList(parsed, expectedPaths);
  if (normalized.schema === "invalid") {
    logDeltaRetry("DELTA_RETRY_PATCH_REJECTED", {
      schema: normalized.schema,
      reason: normalized.errors[0] || "Unsupported delta retry schema"
    });
    return {
      hasPatches: false,
      patches: [],
      hasFiles: false,
      files: [],
      errors: normalized.errors,
      schema: normalized.schema,
      patchCount: 0
    };
  }

  const files = Array.isArray(parsed.files) ? parsed.files : [];
  const hasPatches = normalized.patches.length > 0;

  return {
    hasPatches,
    patches: normalized.patches,
    hasFiles: files.length > 0,
    files,
    errors: normalized.errors,
    schema: normalized.schema,
    patchCount: normalized.patches.length
  };
}
