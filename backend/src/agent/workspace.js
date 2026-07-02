import fs from "fs/promises";
import vm from "node:vm";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { parse as parseJavaScript } from "@babel/parser";
import {
  FrameworkAdapter,
  buildGenerationHints,
  detectFramework
} from "./framework/frameworkAdapter.js";
import { validateStructuralContent } from "./writeCoordinator/validationDelta.js";

export { FrameworkAdapter };

const frameworkLogDedupe = new Set();

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, "../..");
export const MANAGED_WORKSPACE_ROOT = path.resolve(BACKEND_ROOT, "..", "storage", "workspaces");

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "uploads",
  "generated",
  "dist",
  "build",
  "coverage"
]);

function logFrameworkEvent(eventName, payload = {}, taskId = null, pathValue = "", framework = "") {
  const key = [eventName, taskId || "", String(pathValue || ""), String(framework || "")].join("::");
  if (frameworkLogDedupe.has(key)) return false;
  frameworkLogDedupe.add(key);
  console.log(`[${eventName}]`, payload);
  return true;
}
const BLOCKED_FILE_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  "id_rsa",
  "id_ed25519"
]);
const SOURCE_ROOT_MARKERS = new Set([
  "src",
  "app",
  "backend",
  "frontend",
  "server",
  "client",
  "api"
]);
const APP_ROOT_MARKERS = new Set([
  "src",
  "app",
  "backend",
  "frontend",
  "server",
  "client",
  "api",
  "pages",
  "routes"
]);
const TEST_ROOT_MARKERS = new Set([
  "tests",
  "test",
  "__tests__",
  "spec",
  "specs"
]);
const SOURCE_FILE_RX = /\.(?:js|jsx|ts|tsx|mjs|cjs|php|py|cs|cshtml|aspx|dart|html|json|css|scss|sass|md|txt|yml|yaml)$/i;
const TEST_FILE_RX = /(?:^|\/)(?:tests?|__tests__|specs?)(?:\/|$)|\.(?:test|spec)\.(?:js|jsx|ts|tsx|mjs|cjs|php|py|cs|cshtml|aspx)$/i;
const SYSTEM_PATHS = [
  "c:\\windows",
  "c:\\program files",
  "c:\\program files (x86)",
  "c:\\programdata",
  "/etc",
  "/bin",
  "/sbin",
  "/usr",
  "/var",
  "/system",
  "/library"
];

const ESM_EXPORT_RX = /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\b|\bexport\s*\{|\bimport\s+[^'"]+from\s+['"]/i;
const COMMONJS_RX = /\bmodule\.exports\b|\bexports\.[A-Za-z_$][\w$]*\b|\brequire\s*\(/i;
const CODE_FILE_RX = /\.(?:js|jsx|ts|tsx|mjs|cjs|mts|cts)$/i;
const PYTHON_RX = /\.(?:py|pyw)$/i;
const PHP_RX = /\.(?:php|phtml)$/i;
const ASPNET_RX = /\.(?:cs|cshtml|aspx)$/i;
const JAVA_RX = /\.(?:java|jsp|jspx)$/i;
const STATIC_RX = /\.(?:html|htm|css|scss|sass)$/i;

const LANGUAGE_BY_EXT = [
  { rx: /\.(?:mjs|cjs|js|jsx|ts|tsx|mts|cts)$/i, language: "javascript" },
  { rx: PYTHON_RX, language: "python" },
  { rx: PHP_RX, language: "php" },
  { rx: ASPNET_RX, language: "aspnet" },
  { rx: JAVA_RX, language: "java" },
  { rx: STATIC_RX, language: "static" },
  { rx: /\.(?:json|jsonc|json5)$/i, language: "json" },
  { rx: /\.(?:md|markdown|rst)$/i, language: "markdown" },
  { rx: /\.(?:yml|yaml|txt)$/i, language: "data" }
];

const PROJECT_MARKER_HINTS = [
  { file: "package.json", projectType: "node" },
  { file: "composer.json", projectType: "php" },
  { file: "pyproject.toml", projectType: "python" },
  { file: "requirements.txt", projectType: "python" },
  { file: ".csproj", projectType: "aspnet" },
  { file: "web.config", projectType: "aspnet" },
  { file: "pom.xml", projectType: "java" },
  { file: "build.gradle", projectType: "java" },
  { file: "index.php", projectType: "php" },
  { file: "index.html", projectType: "static_html" }
];

function toPosixPath(value) {
  return String(value || "").replace(/\\/g, "/").trim();
}

function normalizeForComparison(value) {
  const normalized = path.resolve(String(value || "")).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isInsidePath(parent, child) {
  const normalizedParent = normalizeForComparison(parent);
  const normalizedChild = normalizeForComparison(child);
  return normalizedChild === normalizedParent ||
    normalizedChild.startsWith(`${normalizedParent}${path.sep}`);
}

export function normalizeWorkspaceRelativePath(candidatePath, workspaceRoot = "") {
  const raw = String(candidatePath ?? "").trim();
  if (!raw) return "";

  let normalized = raw.replace(/\\/g, "/").trim();
  if (!normalized) return "";

  if (/^file:\/\//i.test(normalized)) {
    try {
      normalized = fileURLToPath(normalized).replace(/\\/g, "/").trim();
    } catch {
      return "";
    }
  }

  normalized = normalized.replace(/^\.\/+/, "");

  const root = String(workspaceRoot || "").trim();
  if (!root) {
    const posix = path.posix.normalize(normalized);
    if (!posix || posix === "." || posix === "./") return posix === "./" ? "." : posix;
    if (posix === ".." || posix.startsWith("../")) return "";
    if (path.isAbsolute(posix) || /^[A-Za-z]:\//.test(posix)) return "";
    return posix.replace(/^\.\//, "") || ".";
  }

  const rootResolved = path.resolve(root);
  const looksAbsolute = path.isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized);
  const candidateResolved = looksAbsolute
    ? path.resolve(normalized)
    : path.resolve(rootResolved, normalized);

  if (!isInsidePath(rootResolved, candidateResolved)) {
    return "";
  }

  return path.relative(rootResolved, candidateResolved).replace(/\\/g, "/") || ".";
}

function isBlockedFileName(name) {
  const normalized = String(name || "").toLowerCase();
  return BLOCKED_FILE_NAMES.has(normalized) || /^\.env(?:\.|$)/i.test(normalized);
}

function detectLanguageFromPath(targetPath = "") {
  const normalized = toPosixPath(targetPath);
  for (const entry of LANGUAGE_BY_EXT) {
    if (entry.rx.test(normalized)) return entry.language;
  }
  return "unknown";
}

function detectProjectTypeFromMarkers(projectScan = {}, files = []) {
  if (projectScan?.projectType && projectScan.projectType !== "generic") {
    return projectScan.projectType;
  }

  const normalized = new Set((files || []).map(value => toPosixPath(value).toLowerCase()));
  for (const hint of PROJECT_MARKER_HINTS) {
    if (normalized.has(hint.file.toLowerCase())) return hint.projectType;
  }

  return projectScan?.projectType || "generic";
}

function extractRequiredSymbolsFromText(text = "") {
  const source = String(text || "");
  const symbols = new Set();
  const patterns = [
    /\bexport\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/g,
    /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /\bclass\s+([A-Za-z_$][\w$]*)\b/g,
    /\bdef\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /\b(?:public\s+)?class\s+([A-Za-z_$][\w$]*)\b/g,
    /\bimport\s*\{\s*([^}]+)\s*\}\s*from\b/g,
    /\buse\s+([A-Za-z_\\][\w\\]*)\b/g
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const groups = match.slice(1).filter(Boolean);
      for (const group of groups) {
        String(group)
          .split(",")
          .map(value => value.trim())
          .forEach(value => {
            const symbol = value.replace(/\s+as\s+.+$/i, "").trim();
            if (symbol && /^[A-Za-z_$\\][\w$\\]*$/.test(symbol)) {
              symbols.add(symbol.split("\\").pop());
            }
          });
      }
    }
  }

  return [...symbols];
}

function extractReferenceGraphFromContent(content = "", language = "unknown") {
  const text = String(content || "");
  const graph = {
    imports: [],
    exports: [],
    includes: [],
    scripts: [],
    styles: []
  };

  if (language === "javascript") {
    graph.imports = [...new Set([
      ...(text.match(/import\s+[^'"]+\s+from\s+['"]([^'"]+)['"]/g) || []).map(line => line.replace(/^.*from\s+['"]([^'"]+)['"].*$/, "$1")),
      ...(text.match(/require\(\s*['"]([^'"]+)['"]\s*\)/g) || []).map(line => line.replace(/^.*require\(\s*['"]([^'"]+)['"]\s*\).*$/, "$1"))
    ])];
    graph.exports = [...new Set([
      ...(text.match(/export\s+(?:default\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g) || []).map(line => line.replace(/^.*export\s+(?:default\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*).*$/, "$1")),
      ...(text.match(/module\.exports\s*=\s*\{([\s\S]*?)\}/g) || []).map(line => line.replace(/^.*module\.exports\s*=\s*\{([\s\S]*?)\}.*$/, "$1"))
    ])];
  } else if (language === "python") {
    graph.imports = [...new Set([
      ...(text.match(/^\s*import\s+(.+)$/gm) || []).map(line => line.replace(/^\s*import\s+/, "").trim()),
      ...(text.match(/^\s*from\s+([A-Za-z0-9_.]+)\s+import\s+(.+)$/gm) || []).map(line => line.replace(/^\s*from\s+([A-Za-z0-9_.]+)\s+import\s+(.+)$/gm, "$1:$2"))
    ])];
  } else if (language === "php") {
    graph.includes = [...new Set([
      ...(text.match(/^\s*(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]\s*\)?/gim) || []).map(line => line.replace(/^.*['"]([^'"]+)['"].*$/, "$1"))
    ])];
    graph.imports = [...new Set([
      ...(text.match(/^\s*use\s+([^;]+);/gim) || []).map(line => line.replace(/^.*use\s+([^;]+);.*$/, "$1"))
    ])];
  } else if (language === "aspnet") {
    graph.imports = [...new Set([
      ...(text.match(/^\s*using\s+([^;]+);/gim) || []).map(line => line.replace(/^\s*using\s+([^;]+);/gim, "$1"))
    ])];
  } else if (language === "java") {
    graph.imports = [...new Set([
      ...(text.match(/^\s*import\s+([^;]+);/gim) || []).map(line => line.replace(/^\s*import\s+([^;]+);/gim, "$1"))
    ])];
  } else if (language === "static") {
    graph.scripts = [...new Set([
      ...(text.match(/<script[^>]+src=["']([^"']+)["']/gim) || []).map(line => line.replace(/^.*src=["']([^"']+)["'].*$/, "$1"))
    ])];
    graph.styles = [...new Set([
      ...(text.match(/<link[^>]+href=["']([^"']+)["']/gim) || []).map(line => line.replace(/^.*href=["']([^"']+)["'].*$/, "$1"))
    ])];
  }

  return graph;
}

function collectNearbyFiles(files = [], targetPath = "", limit = 8) {
  const normalizedTarget = toPosixPath(targetPath);
  const targetDir = path.posix.dirname(normalizedTarget || ".");
  const normalizedFiles = (files || []).map(file => toPosixPath(file)).filter(Boolean);
  const sameDir = normalizedFiles.filter(file => path.posix.dirname(file) === targetDir);
  const sameStem = normalizedTarget
    ? normalizedFiles.filter(file => path.posix.basename(file).toLowerCase().includes(path.posix.basename(normalizedTarget).split(".")[0].toLowerCase()))
    : [];
  return [...new Set([...sameDir, ...sameStem])].slice(0, limit);
}

const TEST_ONLY_SYMBOLS = new Set(["it", "describe", "test", "expect", "beforeEach", "afterEach", "before", "after", "strict"]);
const FRAMEWORK_MODULE_TOKENS = new Set(["strict", "assert"]);
const PLACEHOLDER_RX = /\b(?:TODO|FIXME|TBD|PLACEHOLDER|REPLACE_ME|YOUR_CODE_HERE|XXX)\b/i;

export function classifyWriteTargetRole(targetPath = "", projectContext = {}) {
  const normalized = toPosixPath(targetPath).toLowerCase();
  if (!normalized) return "unknown";
  if (/^package\.json$/i.test(normalized)) return "package";
  if (/\.(?:md|markdown|rst)$/i.test(normalized)) return "markdown";
  if (/\.(?:json|jsonc|json5)$/i.test(normalized)) return "json";
  if (/(?:^|\/)(?:tests?|__tests__|specs?)(?:\/|$)/.test(normalized)) return "test";
  if (/(?:^|\/)(?:tests?|__tests__)(?:\/|$)/.test(normalized)) return "test";
  if (/\.(?:test|spec)\.(?:m?js|cjs|jsx|tsx|ts)$/.test(normalized)) return "test";
  if (/^(?:\.?(?:eslintrc|prettierrc|babelrc|editorconfig)|tsconfig|vite\.config|jest\.config|mocha\.config|webpack\.config|rollup\.config|eslint\.config|next\.config)(?:\.[A-Za-z0-9]+)?$/i.test(path.posix.basename(normalized))) {
    return "config";
  }
  if (/^(?:\.?env(?:\..+)?)$/i.test(path.posix.basename(normalized))) return "config";
  if (projectContext?.projectType === "json") return "json";
  return "implementation";
}

function extractExplicitImplementationSymbols(text = "") {
  const source = String(text || "");
  const symbols = new Set();
  const patterns = [
    /\b(?:implement|create|add|write|build|make|generate|modify|update|change|fix|replace|append|prepend|insert|rename)\b(?:\s+(?:the|a|an))?\s+([A-Za-z_$][\w$]*(?:\s*[\/,&+]\s*[A-Za-z_$][\w$]*){1,12})/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const raw = String(match[1] || "");
      if (/\.[A-Za-z0-9]{1,8}\b/.test(raw) || /(?:^|\/)(?:src|app|backend|frontend|server|client|api)\//i.test(raw)) {
        continue;
      }
      for (const token of raw.split(/\s*(?:\/|,|&|\+|\band\b)\s*/i)) {
        const cleaned = token.trim().replace(/[.;:]+$/g, "");
        if (!cleaned) continue;
        if (/[\\/\.]/.test(cleaned)) continue;
        if (/^(?:src|app|backend|frontend|server|client|api|tests?|specs?|package|json)$/i.test(cleaned)) continue;
        if (/^[A-Za-z_$][\w$]*$/.test(cleaned)) {
          symbols.add(cleaned);
        }
      }
    }
  }

  return [...symbols];
}

function isTestConstructSymbol(symbol = "") {
  return TEST_ONLY_SYMBOLS.has(String(symbol || "").trim());
}

function isFrameworkModuleToken(symbol = "") {
  return FRAMEWORK_MODULE_TOKENS.has(String(symbol || "").trim());
}

function sanitizeValidationSymbols(symbols = []) {
  return [...new Set(
    (Array.isArray(symbols) ? symbols : [])
      .map(value => String(value || "").trim())
      .filter(Boolean)
      .filter(symbol => !isTestConstructSymbol(symbol))
      .filter(symbol => !isFrameworkModuleToken(symbol))
      .filter(symbol => !/^(?:src|app|backend|frontend|server|client|api|tests?|specs?|package|json)$/i.test(symbol))
  )];
}

function extractRoleSpecificRequirements({
  role = "implementation",
  prompt = "",
  existingTargetContent = ""
} = {}) {
  const source = [String(prompt || ""), String(existingTargetContent || "")]
    .filter(Boolean)
    .join("\n");
  const symbols = sanitizeValidationSymbols([
    ...extractExplicitImplementationSymbols(source),
    ...extractRequiredSymbolsFromText(source)
  ]);

  if (role === "test") {
    return {
      mustReference: symbols,
      mustExport: [],
      mustContainAny: [],
      mustContainAll: [],
      rejectPlaceholders: true
    };
  }

  if (role === "package" || role === "json" || role === "markdown") {
    return {
      mustReference: [],
      mustExport: [],
      mustContainAny: [],
      mustContainAll: [],
      rejectPlaceholders: true
    };
  }

  return {
    mustReference: [],
    mustExport: symbols,
    mustContainAny: [],
    mustContainAll: [],
    rejectPlaceholders: true
  };
}

// Framework detection and validation now live in framework/frameworkAdapter.js.

export function buildWriteValidationPolicy({
  targetPath = "",
  role = "unknown",
  projectContext = {},
  explicitPromptRequirements = null,
  packageJson = null,
  detectedTestFramework = "generic-js-test",
  prompt = "",
  existingTargetContent = ""
} = {}) {
  const resolvedRole = role !== "unknown" ? role : classifyWriteTargetRole(targetPath, projectContext);
  const source = [
    Array.isArray(explicitPromptRequirements) && explicitPromptRequirements.length > 0
      ? explicitPromptRequirements.join("\n")
      : "",
    String(prompt || ""),
    String(existingTargetContent || "")
  ].filter(Boolean).join("\n");

  const roleRequirements = extractRoleSpecificRequirements({
    role: resolvedRole,
    prompt: source,
    existingTargetContent
  });
  const language = detectLanguageFromPath(targetPath);
  const moduleSystem = (
    projectContext?.moduleSystem ||
    projectContext?.detectedModuleSystem ||
    projectContext?.moduleSystemHint ||
    "unknown"
  );

  const policy = {
    targetPath: toPosixPath(targetPath),
    role: resolvedRole,
    language,
    moduleSystem,
    testFramework: detectedTestFramework || "generic-js-test",
    mustParse: resolvedRole !== "markdown",
    mustCompile: false,
    mustExport: roleRequirements.mustExport || [],
    mustReference: roleRequirements.mustReference || [],
    mustContainAny: roleRequirements.mustContainAny || [],
    mustContainAll: roleRequirements.mustContainAll || [],
    allowExtraSymbols: true,
    rejectPlaceholders: roleRequirements.rejectPlaceholders !== false,
    packageJson: packageJson || null
  };

  return policy;
}

export async function buildWriteContext({
  workspaceRoot,
  targetPath = "",
  existingTargetContent = null,
  projectScan = {},
  prompt = "",
  requiredSymbols = [],
  workspaceFiles = null,
  nearbyFiles = null,
  taskId = null
} = {}) {
  const root = workspaceRoot ? getWorkspaceRoot(workspaceRoot) : "";
  const files = Array.isArray(workspaceFiles) && workspaceFiles.length > 0
    ? workspaceFiles.map(value => toPosixPath(value))
    : (root ? await listWorkspaceFiles(root, { limit: 5000 }).catch(() => []) : []);
  const normalizedTarget = toPosixPath(targetPath);
  const targetPrompt = String(prompt || "");
  const packageJson = root ? await readJsonIfExists(path.join(root, "package.json")) : null;
  const existingContent = existingTargetContent !== null
    ? String(existingTargetContent)
    : (root && normalizedTarget
      ? await fs.readFile(path.resolve(root, normalizedTarget), "utf8").catch(() => null)
      : null);
  const language = detectLanguageFromPath(normalizedTarget);
  const projectType = detectProjectTypeFromMarkers(projectScan, files);
  const scan = projectScan && Object.keys(projectScan).length > 0
    ? projectScan
    : (root ? await import("./projectScanner.js").then(mod => mod.scanProject(root)).catch(() => ({})) : {});
  const nearby = (Array.isArray(nearbyFiles) && nearbyFiles.length > 0 ? nearbyFiles : collectNearbyFiles(files, normalizedTarget)).filter(Boolean);
  const nearbyStyles = [];
  for (const file of nearby.slice(0, 5)) {
    const content = root ? await fs.readFile(path.resolve(root, file), "utf8").catch(() => null) : null;
    if (content) {
      nearbyStyles.push({
        file,
        referenceGraph: extractReferenceGraphFromContent(content, detectLanguageFromPath(file)),
        contentPreview: String(content).slice(0, 500)
      });
    }
  }

  const graph = extractReferenceGraphFromContent(existingContent || "", language);
  const isTestLikeTarget = /(?:^|\/)(?:__tests__|tests?)\/|(?:^|\/).+\.(?:test|spec)\.[jt]sx?$|(?:^|\/)(?:test|spec)\.[jt]sx?$/i.test(normalizedTarget);
  const frameworkDetection = isTestLikeTarget
    ? detectFramework({
        packageJson,
        projectScan: scan,
        nearbyFiles: nearbyStyles
      })
    : { framework: "generic-js-test", source: "skipped", evidence: { reason: "not_test_file" } };
  if (isTestLikeTarget) {
    logFrameworkEvent("FRAMEWORK_DETECTED", {
      targetPath: normalizedTarget,
      framework: frameworkDetection.framework,
      source: frameworkDetection.source
    }, taskId, normalizedTarget, frameworkDetection.framework);
    if (frameworkDetection.availability) {
      console.log("[TEST_FRAMEWORK_AVAILABILITY]", {
        taskId: taskId || null,
        targetPath: normalizedTarget,
        framework: frameworkDetection.availability.framework,
        runnable: frameworkDetection.availability.runnable,
        source: frameworkDetection.availability.source,
        reason: frameworkDetection.availability.reason,
        validationCommand: frameworkDetection.availability.validationCommand || null
      });
    }
  } else {
    logFrameworkEvent("FRAMEWORK_DETECTION_SKIPPED", {
      targetPath: normalizedTarget,
      reason: "not_test_file"
    }, taskId, normalizedTarget, "generic-js-test");
  }
  const validationPolicy = buildWriteValidationPolicy({
    targetPath: normalizedTarget,
    role: classifyWriteTargetRole(normalizedTarget, { projectType }),
    projectContext: {
      projectType,
      moduleSystem: await detectWorkspaceModuleSystem(root, normalizedTarget, {
        layout: scan,
        workspaceFiles: files
      }).catch(() => "unknown")
    },
    explicitPromptRequirements: sanitizeValidationSymbols([
      ...extractExplicitImplementationSymbols(targetPrompt),
      ...extractRequiredSymbolsFromText(existingContent || "")
    ]),
    packageJson,
    detectedTestFramework: frameworkDetection.framework,
    prompt: targetPrompt,
    existingTargetContent: existingContent || "",
    projectScan: scan
  });
  const validationSymbols = validationPolicy.role === "test"
    ? validationPolicy.mustReference
    : validationPolicy.mustExport;
  const inferredRequiredSymbols = [
    ...new Set([
      ...(Array.isArray(requiredSymbols) ? requiredSymbols : []),
      ...(Array.isArray(validationSymbols) ? validationSymbols : [])
    ].map(value => String(value || "").trim()).filter(Boolean))
  ];

  return {
    workspaceRoot: root || workspaceRoot || "",
    targetPath: normalizedTarget,
    existingTargetContent: existingContent,
    projectScan: scan || projectScan || {},
    projectType,
    detectedLanguage: language,
    moduleSystem: validationPolicy.moduleSystem,
    detectedTestFramework: frameworkDetection.framework,
    detectedTestFrameworkSource: frameworkDetection.source,
    detectedTestFrameworkAvailability: frameworkDetection.availability || null,
    packageJson,
    fileRole: validationPolicy.role,
    referenceGraph: graph,
    validationPolicy,
    requiredSymbols: inferredRequiredSymbols,
    validationSource: targetPrompt,
    nearbyFiles: nearby,
    nearbyStyleConventions: nearbyStyles,
    prompt: targetPrompt
  };
}

async function readJsonIfExists(filePath) {
  const text = await fs.readFile(filePath, "utf8").catch(() => null);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function detectModuleSystemFromContent(content) {
  const text = String(content || "");
  const hasEsm = ESM_EXPORT_RX.test(text);
  const hasCommonJs = COMMONJS_RX.test(text);

  if (hasEsm && !hasCommonJs) return "esm";
  if (hasCommonJs && !hasEsm) return "commonjs";
  if (hasEsm && hasCommonJs) return "mixed";
  return null;
}

function splitTopLevelCommaSeparated(text) {
  const source = String(text || "");
  const parts = [];
  let current = "";
  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    current += char;

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }

    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{" || char === "[" || char === "(") depth += 1;
    else if (char === "}" || char === "]" || char === ")") depth = Math.max(0, depth - 1);
    else if (char === "," && depth === 0) {
      parts.push(current.slice(0, -1).trim());
      current = "";
    }
  }

  const tail = current.trim();
  if (tail) parts.push(tail);
  return parts.filter(Boolean);
}

function replaceBalancedBlock(text, startIndex, openChar = "{", closeChar = "}") {
  const source = String(text || "");
  let depth = 0;
  let quote = "";
  let escaped = false;
  let openPos = -1;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (openPos === -1) {
      if (char === openChar) {
        openPos = index;
        depth = 1;
      }
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }

    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
    } else if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return {
          start: openPos,
          end: index,
          inner: source.slice(openPos + 1, index)
        };
      }
    }
  }

  return null;
}

function transformCommonJsProperty(propText) {
  const text = String(propText || "").trim().replace(/;$/, "");
  if (!text) return null;

  let match = text.match(/^([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)\s*\{([\s\S]*)\}$/);
  if (match) {
    return `export function ${match[1]}(${match[2]}) {${match[3]}}`;
  }

  match = text.match(/^async\s+([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)\s*\{([\s\S]*)\}$/);
  if (match) {
    return `export async function ${match[1]}(${match[2]}) {${match[3]}}`;
  }

  match = text.match(/^([A-Za-z_$][\w$]*)\s*:\s*(async\s+)?function\s*\(([\s\S]*)\)\s*\{([\s\S]*)\}$/);
  if (match) {
    const asyncPrefix = match[2] ? "async " : "";
    return `export ${asyncPrefix}function ${match[1]}(${match[3]}) {${match[4]}}`;
  }

  match = text.match(/^([A-Za-z_$][\w$]*)\s*:\s*(async\s+)?\(([\s\S]*)\)\s*=>\s*\{([\s\S]*)\}$/);
  if (match) {
    const asyncPrefix = match[2] ? "async " : "";
    return `export const ${match[1]} = ${asyncPrefix}(${match[3]}) => {${match[4]}};`;
  }

  match = text.match(/^([A-Za-z_$][\w$]*)\s*:\s*(async\s+)?\(([\s\S]*)\)\s*=>\s*([\s\S]+)$/);
  if (match) {
    const asyncPrefix = match[2] ? "async " : "";
    return `export const ${match[1]} = ${asyncPrefix}(${match[3]}) => ${match[4].trim()};`;
  }

  match = text.match(/^([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)$/);
  if (match) {
    if (match[1] === match[2]) {
      return `export { ${match[1]} };`;
    }
    return `export const ${match[1]} = ${match[2]};`;
  }

  match = text.match(/^([A-Za-z_$][\w$]*)$/);
  if (match) {
    return `export { ${match[1]} };`;
  }

  match = text.match(/^([A-Za-z_$][\w$]*)\s*:\s*(.+)$/);
  if (match) {
    return `export const ${match[1]} = ${match[2].trim()};`;
  }

  return null;
}

function transformCommonJsModuleToEsm(content) {
  const source = String(content || "");
  const exportMatch = source.match(/module\.exports\s*=\s*\{/);
  if (!exportMatch) {
    return null;
  }

  const start = source.indexOf("{", exportMatch.index);
  const block = replaceBalancedBlock(source, start);
  if (!block) return null;

  const props = splitTopLevelCommaSeparated(block.inner);
  const transformedProps = [];
  for (const prop of props) {
    const transformed = transformCommonJsProperty(prop);
    if (!transformed) return null;
    transformedProps.push(transformed);
  }

  const before = source.slice(0, exportMatch.index).trimEnd();
  const after = source.slice(block.end + 1).trimStart().replace(/^;\s*/, "");
  const pieces = [];
  if (before) pieces.push(before);
  if (transformedProps.length) pieces.push(transformedProps.join("\n"));
  if (after) pieces.push(after);
  return pieces.join("\n").trim() + "\n";
}

async function collectModuleSyntaxHints(workspaceRoot, targetPath, { limit = 200, workspaceFiles = null } = {}) {
  const targetBase = path.posix.basename(toPosixPath(targetPath));
  const files = Array.isArray(workspaceFiles) && workspaceFiles.length > 0
    ? workspaceFiles
    : await listWorkspaceFiles(workspaceRoot, { limit: Math.max(limit, 500) }).catch(() => []);

  const hints = [];
  const codeFiles = files.filter(file => CODE_FILE_RX.test(String(file || "")));

  for (const file of codeFiles.slice(0, limit)) {
    if (targetPath && toPosixPath(file) === toPosixPath(targetPath)) continue;
    if (targetBase && !toPosixPath(file).includes(targetBase)) continue;
    const absolute = path.resolve(workspaceRoot, file);
    const content = await fs.readFile(absolute, "utf8").catch(() => null);
    if (!content) continue;
    const syntax = detectModuleSystemFromContent(content);
    if (syntax) {
      hints.push({ file: toPosixPath(file), syntax });
    }
  }

  return hints;
}

export async function detectWorkspaceModuleSystem(workspaceRoot, targetPath = "", { layout = null, workspaceFiles = null } = {}) {
  const root = getWorkspaceRoot(workspaceRoot);
  const normalizedTarget = toPosixPath(targetPath);
  const ext = path.extname(normalizedTarget).toLowerCase();

  if (ext === ".mjs" || ext === ".mts") return "esm";
  if (ext === ".cjs" || ext === ".cts") return "commonjs";

  const pkg = await readJsonIfExists(path.join(root, "package.json"));
  if (pkg?.type === "module") return "esm";
  if (pkg?.type === "commonjs") return "commonjs";

  if (normalizedTarget) {
    const exact = path.resolve(root, normalizedTarget);
    const content = await fs.readFile(exact, "utf8").catch(() => null);
    const detected = detectModuleSystemFromContent(content);
    if (detected === "esm" || detected === "commonjs") return detected;
  }

  const hints = await collectModuleSyntaxHints(root, normalizedTarget, { workspaceFiles });
  const esmCount = hints.filter(hint => hint.syntax === "esm").length;
  const cjsCount = hints.filter(hint => hint.syntax === "commonjs").length;
  if (esmCount > cjsCount) return "esm";
  if (cjsCount > esmCount) return "commonjs";

  return "unknown";
}

export async function normalizeGeneratedModuleContent({
  workspaceRoot,
  targetPath = "",
  content = "",
  layout = null,
  workspaceFiles = null,
  writeContext: providedWriteContext = null
} = {}) {
  return validateGeneratedWriteContent({
    workspaceRoot,
    targetPath,
    content,
    projectScan: layout,
    workspaceFiles,
    writeContext: providedWriteContext || undefined,
    policySource: providedWriteContext ? "coordinator" : null
  });
}

function containsLanguageConflict(text = "", language = "unknown") {
  const source = String(text || "");
  if (!source.trim()) return false;

  const jsMarkers = /module\.exports\b|\bexports\.[A-Za-z_$][\w$]*\b|\brequire\s*\(|\bexport\s+(?:default\s+)?(?:function|class|const|let|var)\b/i;
  const pyMarkers = /(^|\n)\s*(?:def|class|import|from)\s+[A-Za-z_][\w.]*/i;
  const phpMarkers = /<\?php|\bfunction\s+[A-Za-z_][\w]*\s*\(|\buse\s+[^;]+;|\brequire(?:_once)?\s*\(/i;
  const aspNetMarkers = /\bnamespace\s+[A-Za-z_][\w.]*|\busing\s+[A-Za-z_][\w.]*;|\bpublic\s+(?:partial\s+)?class\s+[A-Za-z_][\w]*/i;
  const javaMarkers = /\bpackage\s+[A-Za-z_][\w.]*;|\bimport\s+[A-Za-z_][\w.]*;|\bpublic\s+class\s+[A-Za-z_][\w]*/i;
  if (language === "python") return jsMarkers.test(source) || phpMarkers.test(source) || aspNetMarkers.test(source) || javaMarkers.test(source);
  if (language === "php") return jsMarkers.test(source) || pyMarkers.test(source) || aspNetMarkers.test(source) || javaMarkers.test(source);
  if (language === "aspnet") return jsMarkers.test(source) || pyMarkers.test(source) || phpMarkers.test(source) || javaMarkers.test(source);
  if (language === "java") return jsMarkers.test(source) || pyMarkers.test(source) || phpMarkers.test(source) || aspNetMarkers.test(source);
  if (language === "static") return jsMarkers.test(source) || pyMarkers.test(source) || phpMarkers.test(source) || aspNetMarkers.test(source) || javaMarkers.test(source);
  if (language === "javascript" || language === "typescript") return false;
  return false;
}

function validateClarificationEngineContent({ content = "", writeContext = {} } = {}) {
  const requiredSymbols = Array.isArray(writeContext?.requiredSymbols) ? writeContext.requiredSymbols : [];
  const prompt = String(writeContext?.prompt || "");
  const shouldValidate =
    requiredSymbols.some(symbol => String(symbol).trim() === "analyzeClarification") ||
    /analyzeclarification/i.test(prompt);

  if (!shouldValidate) return null;

  const source = String(content || "");

  const hasNamedExport =
    /export\s+(?:async\s+)?function\s+analyzeClarification\b/i.test(source) ||
    /export\s+(?:const|let|var)\s+analyzeClarification\b/i.test(source) ||
    /export\s*\{\s*analyzeClarification\b/i.test(source);

  let evaluableSource = source;
  if (!hasNamedExport) {
    const transformed = transformCommonJsModuleToEsm(source);
    if (transformed) {
      evaluableSource = transformed;
    } else {
      return {
        success: false,
        error: "clarificationEngine must export analyzeClarification",
        writeContext
      };
    }
  }

  const samples = [
    ["Read package.json", false],
    ["Run npm test", false],
    ["Run npm test -- plannerPhase419", false],
    ["Fix it", true],
    ["Update it", true]
  ];

  const stripped = evaluableSource
    .replace(/export\s+default\s+analyzeClarification\s*;?/gi, "")
    .replace(/export\s+(?:async\s+)?function\s+analyzeClarification\b/gi, "function analyzeClarification")
    .replace(/export\s+(?:const|let|var)\s+analyzeClarification\b/gi, "const analyzeClarification")
    .replace(/export\s*\{\s*analyzeClarification\s*\};?/gi, "")
    .replace(/export\s*\{\s*analyzeClarification\s+as\s+default\s*\};?/gi, "");

  let fn = null;
  try {
    const context = vm.createContext({});
    const script = new vm.Script(`${stripped}\n;this.__clarify = typeof analyzeClarification === 'function' ? analyzeClarification : null;`);
    script.runInContext(context, { timeout: 250 });
    fn = context.__clarify;
  } catch (error) {
    return {
      success: false,
      error: `clarificationEngine validation failed: ${error.message}`,
      writeContext
    };
  }

  if (typeof fn !== "function") {
    return {
      success: false,
      error: "clarificationEngine must export analyzeClarification",
      writeContext
    };
  }

  try {
    for (const [input, expected] of samples) {
      const result = fn(input);
      if (!result || typeof result !== "object") {
        return {
          success: false,
          error: "clarificationEngine must return an object with needsClarification",
          writeContext
        };
      }
      if (Boolean(result.needsClarification) !== expected) {
        return {
          success: false,
          error: `clarificationEngine returned the wrong clarification decision for "${input}"`,
          writeContext
        };
      }
    }
  } catch (error) {
    return {
      success: false,
      error: `clarificationEngine validation execution failed: ${error.message}`,
      writeContext
    };
  }

  return null;
}

function parseJavaScriptSource(content = "", { sourceType = "unambiguous" } = {}) {
  try {
    return parseJavaScript(String(content || ""), {
      sourceType,
      allowReturnOutsideFunction: true,
      plugins: [
        "jsx",
        "typescript",
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

function collectExportedSymbolsFromAst(ast) {
  const symbols = new Set();
  if (!ast?.program?.body) return [];

  const collectNode = (node) => {
    if (!node) return;
    if (node.type === "Identifier" && node.name) {
      symbols.add(node.name);
      return;
    }
    if (node.type === "VariableDeclaration") {
      for (const declaration of node.declarations || []) {
        collectNode(declaration.id);
      }
      return;
    }
    if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id?.name) {
      symbols.add(node.id.name);
    }
  };

  for (const node of ast.program.body) {
    if (node.type === "ExportNamedDeclaration") {
      collectNode(node.declaration);
      for (const specifier of node.specifiers || []) {
        const exported = specifier.exported?.name || specifier.exported?.value;
        if (exported) symbols.add(String(exported));
      }
      continue;
    }

    if (node.type === "ExportDefaultDeclaration") {
      const declaration = node.declaration;
      if (declaration?.type === "Identifier" && declaration.name) {
        symbols.add(declaration.name);
      } else if (declaration?.id?.name) {
        symbols.add(declaration.id.name);
      }
      continue;
    }

    if (node.type === "ExpressionStatement" && node.expression?.type === "AssignmentExpression") {
      const left = node.expression.left;
      const right = node.expression.right;
      if (left?.type === "MemberExpression" && !left.computed) {
        const objectName = left.object?.name;
        const propertyName = left.property?.name;
        if (objectName === "exports" && propertyName) {
          symbols.add(propertyName);
        }
        if (objectName === "module" && left.property?.name === "exports" && right?.type === "ObjectExpression") {
          for (const prop of right.properties || []) {
            if (prop?.type === "ObjectProperty" || prop?.type === "Property") {
              const key = prop.key?.name || prop.key?.value;
              if (key) symbols.add(String(key));
            } else if (prop?.type === "ObjectMethod" && prop.key?.name) {
              symbols.add(prop.key.name);
            }
          }
        }
      }
    }
  }

  return [...symbols];
}

function hasPlaceholderText(content = "") {
  const text = String(content || "");
  return PLACEHOLDER_RX.test(text) || /\b(?:your code here|replace me|insert code here)\b/i.test(text);
}

function buildFrameworkValidationError(frameworkValidation = {}) {
  const parts = [];
  if (Array.isArray(frameworkValidation.illegalImports) && frameworkValidation.illegalImports.length > 0) {
    parts.push(`Illegal import: ${frameworkValidation.illegalImports.join(", ")}`);
  }
  if (Array.isArray(frameworkValidation.illegalCalls) && frameworkValidation.illegalCalls.length > 0) {
    parts.push(`Illegal call: ${frameworkValidation.illegalCalls.map(n => `${n}()`).join(", ")}`);
  }
  if (Array.isArray(frameworkValidation.repairInstructions) && frameworkValidation.repairInstructions.length > 0) {
    parts.push(frameworkValidation.repairInstructions.join(". "));
  }
  if (parts.length === 0) {
    return frameworkValidation.reason || "FRAMEWORK_VALIDATION_FAIL";
  }
  return parts.join(". ");
}

export function validateGeneratedContentWithPolicy(content, policy = {}, frameworkAvailability = null) {
  const nextContent = String(content ?? "");
  const resolvedPolicy = policy && typeof policy === "object" ? policy : {};
  const role = String(resolvedPolicy.role || "unknown");
  const language = String(resolvedPolicy.language || detectLanguageFromPath(resolvedPolicy.targetPath || ""));
  const mustParse = resolvedPolicy.mustParse !== false;
  const mustExport = Array.isArray(resolvedPolicy.mustExport) ? sanitizeValidationSymbols(resolvedPolicy.mustExport) : [];
  const mustReference = Array.isArray(resolvedPolicy.mustReference) ? sanitizeValidationSymbols(resolvedPolicy.mustReference) : [];
  const mustContainAny = Array.isArray(resolvedPolicy.mustContainAny) ? [...new Set(resolvedPolicy.mustContainAny.map(value => String(value || "").trim()).filter(Boolean))] : [];
  const mustContainAll = Array.isArray(resolvedPolicy.mustContainAll) ? [...new Set(resolvedPolicy.mustContainAll.map(value => String(value || "").trim()).filter(Boolean))] : [];

  if (!nextContent.trim()) {
    return { success: false, error: "WRITE_FILE requires non-empty content", policy: resolvedPolicy };
  }

  if (resolvedPolicy.rejectPlaceholders !== false && hasPlaceholderText(nextContent)) {
    return { success: false, error: "Generated content contains placeholder text", policy: resolvedPolicy };
  }

  if (language === "json" || role === "package") {
    if (mustParse) {
      try {
        JSON.parse(nextContent);
      } catch (error) {
        return { success: false, error: `Generated JSON content is invalid: ${error.message}`, policy: resolvedPolicy };
      }
    }
    return { success: true, content: nextContent, policy: resolvedPolicy };
  }

  if (language === "markdown") {
    return { success: true, content: nextContent, policy: resolvedPolicy };
  }

  if (language === "javascript" || language === "typescript") {
    const ast = parseJavaScriptSource(nextContent, { sourceType: "unambiguous" });
    if (mustParse && !ast) {
      return { success: false, error: "Generated content could not be parsed as JavaScript", policy: resolvedPolicy };
    }

    const exportedSymbols = ast ? collectExportedSymbolsFromAst(ast) : [];
    if (mustExport.length > 0) {
      const missingExports = mustExport.filter(symbol => !exportedSymbols.includes(symbol) && !new RegExp(`\\b${String(symbol).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(nextContent));
      if (missingExports.length > 0) {
        return {
          success: false,
          error: `Generated content is missing required export(s): ${missingExports.join(", ")}`,
          policy: resolvedPolicy
        };
      }
    }

    let frameworkValidation = null;

    if (role === "test") {
      frameworkValidation = FrameworkAdapter.validateFramework(nextContent, resolvedPolicy.testFramework, frameworkAvailability);
      if (frameworkValidation && frameworkValidation.success === false) {
        const errorMsg = buildFrameworkValidationError(frameworkValidation);
        return {
          success: false,
          error: errorMsg,
          reason: frameworkValidation.reason || "framework_mismatch",
          suggestion: frameworkValidation.suggestion || null,
          frameworkValidation,
          policy: resolvedPolicy
        };
      }
    }

    if (mustReference.length > 0) {
      const missingReferences = mustReference.filter(symbol => !new RegExp(`\\b${String(symbol).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(nextContent));
      if (missingReferences.length > 0) {
        return {
          success: false,
          error: `Generated content is missing required reference(s): ${missingReferences.join(", ")}`,
          policy: resolvedPolicy
        };
      }
    }

    if (mustContainAll.length > 0) {
      const missingTokens = mustContainAll.filter(token => !nextContent.includes(token));
      if (missingTokens.length > 0) {
        return {
          success: false,
          error: `Generated content is missing required content: ${missingTokens.join(", ")}`,
          policy: resolvedPolicy
        };
      }
    }

    if (mustContainAny.length > 0) {
      const hasAny = mustContainAny.some(token => nextContent.includes(token));
      if (!hasAny) {
        return {
          success: false,
          error: `Generated content is missing required test construct(s): ${mustContainAny.join(", ")}`,
          policy: resolvedPolicy
        };
      }
    }

    return { success: true, content: nextContent, policy: resolvedPolicy, exportedSymbols, frameworkValidation };
  }

  if (mustExport.length > 0) {
    const missingExports = mustExport.filter(symbol => !new RegExp(`\\b${String(symbol).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(nextContent));
    if (missingExports.length > 0) {
      return {
        success: false,
        error: `Generated content is missing required export(s): ${missingExports.join(", ")}`,
        policy: resolvedPolicy
      };
    }
  }

  if (mustReference.length > 0) {
    const missingReferences = mustReference.filter(symbol => !new RegExp(`\\b${String(symbol).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(nextContent));
    if (missingReferences.length > 0) {
      return {
        success: false,
        error: `Generated content is missing required reference(s): ${missingReferences.join(", ")}`,
        policy: resolvedPolicy
      };
    }
  }

  if (mustContainAll.length > 0) {
    const missingTokens = mustContainAll.filter(token => !nextContent.includes(token));
    if (missingTokens.length > 0) {
      return {
        success: false,
        error: `Generated content is missing required content: ${missingTokens.join(", ")}`,
        policy: resolvedPolicy
      };
    }
  }

  if (mustContainAny.length > 0) {
    const hasAny = mustContainAny.some(token => nextContent.includes(token));
    if (!hasAny) {
      return {
        success: false,
        error: `Generated content is missing required test construct(s): ${mustContainAny.join(", ")}`,
        policy: resolvedPolicy
      };
    }
  }

  let frameworkValidation = null;

  if (role === "test") {
    frameworkValidation = FrameworkAdapter.validateFramework(nextContent, resolvedPolicy.testFramework, frameworkAvailability);
    if (frameworkValidation && !frameworkValidation.success) {
      const errorMsg = buildFrameworkValidationError(frameworkValidation);
      return {
        success: false,
        error: errorMsg,
        reason: frameworkValidation.reason || "framework_mismatch",
        suggestion: frameworkValidation.suggestion,
        frameworkValidation,
        policy: resolvedPolicy
      };
    }
  }

  return { success: true, content: nextContent, policy: resolvedPolicy, frameworkValidation };
}

export async function validateGeneratedWriteContent({
  task = null,
  workspaceRoot,
  targetPath = "",
  content = "",
  projectScan = {},
  existingTargetContent = null,
  requiredSymbols = [],
  prompt = "",
  workspaceFiles = null,
  nearbyFiles = null,
  validationSource = null,
  writeContext: providedWriteContext = null,
  frameworkHintsEmitted = false,
  policySource = null,
  coordinatorValidationFileSet = null,
  frameworkAvailability = null,
  deferValidation = false
} = {}) {
  // WriteCoordinator owns ValidationPolicy creation. The Executor (validation step)
  // must CONSUME the already-built writeContext instead of rebuilding it, so that
  // framework detection + policy construction happen exactly once per write task.
  const reuseContext = !!providedWriteContext;
  const writeContext = reuseContext
    ? providedWriteContext
    : await buildWriteContext({
        workspaceRoot,
        targetPath,
        existingTargetContent,
        projectScan,
        requiredSymbols,
        prompt,
        workspaceFiles,
        nearbyFiles,
        taskId: task?.id || null
      });

  const nextContent = String(content ?? "");
  const policy = writeContext.validationPolicy || buildWriteValidationPolicy({
    targetPath,
    role: classifyWriteTargetRole(targetPath, { projectType: writeContext.projectType }),
    projectContext: {
      projectType: writeContext.projectType,
      moduleSystem: writeContext.moduleSystem || "unknown"
    },
    prompt: writeContext.prompt || prompt || "",
    existingTargetContent: writeContext.existingTargetContent || "",
    packageJson: writeContext.packageJson || null,
    detectedTestFramework: writeContext.detectedTestFramework || "generic-js-test"
  });
  const contextSource = String(writeContext.validationSource || writeContext.prompt || "");
  const normalizedTargetPath = String(targetPath || "").replace(/\\/g, "/");
  if (reuseContext) {
    // Policy was already built by the WriteCoordinator (or single-file generator).
    // Reuse it instead of rebuilding — emit a REUSED marker so callers can verify
    // the Executor never reconstructs ValidationPolicy when one already exists.
    console.log("[WRITE_VALIDATION_POLICY_REUSED]", {
      taskId: task?.id || null,
      targetPath: normalizedTargetPath,
      role: policy.role,
      framework: policy.testFramework || "generic-js-test",
      source: policySource || "reused"
    });
  } else {
    const validationLog = {
      taskId: task?.id || null,
      targetPath: normalizedTargetPath,
      role: policy.role,
      language: policy.language,
      moduleSystem: policy.moduleSystem,
      testFramework: policy.testFramework,
      mustExport: [...(policy.mustExport || [])],
      mustReference: [...(policy.mustReference || [])],
      mustContainAny: [...(policy.mustContainAny || [])],
      mustContainAll: [...(policy.mustContainAll || [])],
      rejectPlaceholders: policy.rejectPlaceholders !== false,
      source: validationSource || (contextSource ? "target_prompt" : "unknown")
    };
    console.log("[WRITE_VALIDATION_POLICY]", validationLog);
  }
  // FrameworkGenerationHints must only be constructed inside prompt construction.
  // When the coordinator prompt already emitted hints (frameworkHintsEmitted=true),
  // do NOT regenerate them here — only log the rule metadata once, without
  // triggering a second [FRAMEWORK_GENERATION_HINTS] emission.
  if (policy.role === "test") {
    const rulesLog = {
      targetPath: normalizedTargetPath,
      framework: policy.testFramework || "generic-js-test"
    };
    if (!frameworkHintsEmitted) {
      rulesLog.hints = buildGenerationHints(policy.testFramework || "generic-js-test", frameworkAvailability || writeContext.detectedTestFrameworkAvailability || null);
    }
    console.log("[FRAMEWORK_RULES]", rulesLog);
  }

  if (deferValidation === true) {
    console.log("[NEED_CONTENT_CREATED]", {
      taskId: task?.id || null,
      targetPath: normalizedTargetPath,
      role: policy.role,
      source: policySource || "deferred"
    });
    console.log("[CONTENT_GENERATED]", {
      taskId: task?.id || null,
      targetPath: normalizedTargetPath,
      contentLength: nextContent.length,
      source: policySource || "deferred"
    });
    return {
      success: true,
      content: nextContent,
      writeContext,
      policy,
      frameworkValidation: null,
      deferredValidation: true
    };
  }

  const policyValidation = validateGeneratedContentWithPolicy(nextContent, policy, writeContext.detectedTestFrameworkAvailability || frameworkAvailability || null);
  if (!policyValidation.success) {
    if (policy.role === "test") {
      console.log("[WRITE_TEST_FRAMEWORK_VALIDATION_FAILED]", {
        targetPath: String(targetPath || "").replace(/\\/g, "/"),
        testFramework: policy.testFramework || "generic-js-test",
        reason: policyValidation.reason || policyValidation.error || "Test framework validation failed",
        suggestion: policyValidation.suggestion || policyValidation.frameworkValidation?.suggestion || null
      });
    }
    return {
      success: false,
      error: policyValidation.error,
      writeContext,
      policy,
      reason: policyValidation.reason || null,
      suggestion: policyValidation.suggestion || null,
      frameworkValidation: policyValidation.frameworkValidation || null
    };
  }

  if (containsLanguageConflict(nextContent, policy.language)) {
    return {
      success: false,
      error: `Generated content is incompatible with the detected ${policy.language || writeContext.projectType || "project"} language`,
      writeContext,
      policy
    };
  }

  const clarificationValidation = validateClarificationEngineContent({
    content: nextContent,
    writeContext
  });
  if (clarificationValidation) {
    return clarificationValidation;
  }

  const structuralValidation = validateStructuralContent({
    targetPath,
    content: nextContent,
    previousContent: writeContext.existingTargetContent || existingTargetContent || "",
    role: policy.role || classifyWriteTargetRole(targetPath, { projectType: writeContext.projectType }),
    requiredExports: policy.mustExport || [],
    requiredReferences: policy.mustReference || [],
    frameworkValidation: policyValidation.frameworkValidation || null
  });
  console.log("[WRITE_CONTENT_STRUCTURAL_CHECK]", {
    targetPath: String(targetPath || "").replace(/\\/g, "/"),
    role: policy.role || classifyWriteTargetRole(targetPath, { projectType: writeContext.projectType }),
    success: structuralValidation.success,
    reason: structuralValidation.reason || null,
    retryMode: structuralValidation.retryMode || null,
    hasExecutableBody: structuralValidation.hasExecutableBody === true,
    hasTestSignal: structuralValidation.hasTestSignal === true
  });
  if (!structuralValidation.success) {
    console.log("[WRITE_CONTENT_STRUCTURAL_REJECTED]", {
      targetPath: String(targetPath || "").replace(/\\/g, "/"),
      reason: structuralValidation.reason || "structural_validation_failed"
    });
    return {
      success: false,
      error: structuralValidation.reason || "Structural validation failed",
      writeContext,
      policy,
      reason: structuralValidation.reason || null,
      suggestion: structuralValidation.details?.framework || null,
      frameworkValidation: policyValidation.frameworkValidation || null
    };
  }

  if (policy.language === "javascript" || policy.language === "typescript") {
    const moduleSystem = await detectWorkspaceModuleSystem(workspaceRoot, targetPath, {
      layout: projectScan,
      workspaceFiles
    });
    const contentSystem = detectModuleSystemFromContent(nextContent);
    if (moduleSystem === "esm") {
      if (contentSystem === "commonjs" || /module\.exports\b|\bexports\.[A-Za-z_$][\w$]*\b/i.test(nextContent)) {
        const transformed = transformCommonJsModuleToEsm(nextContent);
        if (!transformed) {
          return {
            success: false,
            error: "Generated CommonJS content is incompatible with the detected ESM module system",
            writeContext,
            policy,
            moduleSystem
          };
        }
        return {
          success: true,
          content: transformed,
          writeContext,
          policy,
          moduleSystem,
          transformed: transformed !== nextContent,
          frameworkValidation: policyValidation.frameworkValidation || null
        };
      }
    } else if (moduleSystem === "commonjs") {
      if (contentSystem === "esm") {
        return {
          success: false,
          error: "Generated ESM content is incompatible with the detected CommonJS module system",
          writeContext,
          policy,
          moduleSystem
        };
      }
    }

    return {
      success: true,
      content: nextContent,
      writeContext,
      policy,
      moduleSystem: moduleSystem || "unknown",
      transformed: false,
      frameworkValidation: policyValidation.frameworkValidation || null
    };
  }

  return {
    success: true,
    content: nextContent,
    writeContext,
    policy,
    language: policy.language,
    projectType: writeContext.projectType,
    transformed: false,
    frameworkValidation: policyValidation.frameworkValidation || null
  };
}

function normalizeRelativeWorkspacePath(requestedPath = ".") {
  const normalizedInput = String(requestedPath ?? ".").replace(/\\/g, "/").trim() || ".";

  if (path.isAbsolute(normalizedInput) || /^[A-Za-z]:\//.test(normalizedInput)) {
    throw new Error("File path must be relative to the selected workspace");
  }

  const normalized = path.posix.normalize(normalizedInput);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Path escapes selected workspace: ${requestedPath}`);
  }

  const segments = normalized.split("/").filter(Boolean);
  if (
    segments.some(segment => IGNORED_DIRECTORIES.has(segment.toLowerCase())) ||
    segments.some(segment => isBlockedFileName(segment))
  ) {
    throw new Error(`Path is not available to the agent: ${requestedPath}`);
  }

  return normalized;
}

function uniquePush(list, value, seen = new Set()) {
  const normalized = String(value || "").replace(/\\/g, "/").trim();
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  list.push(normalized);
}

function buildRequestedPathCandidates(requestedPath, layout = null) {
  const normalized = normalizeRelativeWorkspacePath(requestedPath);
  const segments = normalized.split("/").filter(Boolean);
  const suffixes = [];

  for (let index = 0; index < segments.length; index += 1) {
    suffixes.push(segments.slice(index).join("/"));
  }

  const layoutRoots = [
    ...(layout?.sourceRoots || []),
    ...(layout?.moduleRoots || []),
    ...(layout?.appRoots || []),
    ...(layout?.testRoots || []),
    ...(layout?.existingTopLevelDirs || [])
  ]
    .map(root => String(root || "").replace(/\\/g, "/").trim())
    .filter(Boolean);

  const seen = new Set();
  const candidates = [];

  uniquePush(candidates, normalized, seen);

  if (segments.length <= 1) {
    return candidates;
  }

  for (const suffix of suffixes) {
    uniquePush(candidates, suffix, seen);
    for (const root of layoutRoots) {
      if (root === ".") continue;
      if (suffix === root || suffix.startsWith(`${root}/`)) {
        uniquePush(candidates, suffix, seen);
      } else {
        uniquePush(candidates, `${root}/${suffix}`, seen);
      }
    }
  }

  return candidates;
}

async function pathExists(targetPath) {
  const stats = await fs.stat(targetPath).catch(() => null);
  return !!stats;
}

async function hasExistingAncestor(root, targetPath) {
  let current = path.dirname(targetPath);
  while (current && isInsidePath(root, current)) {
    const stats = await fs.stat(current).catch(() => null);
    if (stats?.isDirectory()) return true;
    if (path.resolve(current) === path.resolve(root)) return true;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return false;
}

function getNormalizedLayoutRoots(layout = null, files = []) {
  const roots = [];
  const seen = new Set();
  const add = (value) => {
    const normalized = String(value || "").replace(/\\/g, "/").trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    roots.push(normalized);
  };

  for (const root of [
    ...(layout?.sourceRoots || []),
    ...(layout?.moduleRoots || []),
    ...(layout?.appRoots || []),
    ...(layout?.testRoots || []),
    ...(layout?.existingTopLevelDirs || [])
  ]) {
    add(root);
  }

  if (roots.length === 0 && files.length > 0) {
    for (const file of files) {
      const top = String(file || "").replace(/\\/g, "/").split("/").filter(Boolean)[0];
      if (top && !top.startsWith(".")) add(top);
    }
  }

  return roots;
}

export async function normalizeWorkspacePaths(workspaceRoot, requestedPaths = [], layout = null, { allowMissing = true } = {}) {
  const list = Array.isArray(requestedPaths) ? requestedPaths : [requestedPaths];
  const normalized = [];

  for (const requestedPath of list) {
    const value = String(requestedPath || "").trim();
    if (!value) continue;
    try {
      const resolved = await resolveWorkspacePathSafe(workspaceRoot, value, { allowMissing, layout });
      uniquePush(normalized, resolved.relativePath, new Set(normalized.map(item => item.toLowerCase())));
    } catch {
      uniquePush(normalized, value.replace(/\\/g, "/"), new Set(normalized.map(item => item.toLowerCase())));
    }
  }

  return normalized;
}

export function getWorkspaceMode() {
  return String(process.env.WORKSPACE_MODE || "local").trim().toLowerCase() === "remote"
    ? "remote"
    : "local";
}

export function isRemoteWorkspaceMode() {
  return getWorkspaceMode() === "remote";
}

export async function ensureManagedWorkspaceRoot() {
  await fs.mkdir(MANAGED_WORKSPACE_ROOT, { recursive: true });
  return fs.realpath(MANAGED_WORKSPACE_ROOT);
}

export function getAllowedWorkspaceRoots() {
  const configured = String(
    process.env.WORKSPACE_ROOTS ||
    process.env.AGENT_WORKSPACE_ROOT ||
    ""
  );
  const developmentFallback = process.env.NODE_ENV !== "production"
    ? path.resolve(BACKEND_ROOT, "../..")
    : "";

  return (configured || developmentFallback)
    .split(/[;\r\n]+/)
    .map(root => root.trim())
    .filter(Boolean)
    .map(root => path.resolve(root));
}

export function getWorkspaceRoot(requestedRoot = "") {
  if (!requestedRoot) {
    throw new Error("Workspace root is required");
  }
  return path.resolve(requestedRoot);
}

export function assertWorkspaceRootAllowed(rootPath, { allowManaged = true } = {}) {
  const resolved = path.resolve(String(rootPath || ""));
  const comparable = normalizeForComparison(resolved);

  if (SYSTEM_PATHS.some(systemPath => {
    const normalizedSystem = process.platform === "win32"
      ? systemPath.toLowerCase()
      : systemPath;
    return comparable === normalizedSystem ||
      comparable.startsWith(`${normalizedSystem}${path.sep}`);
  })) {
    throw new Error("System folders cannot be used as project workspaces");
  }

  const allowedRoots = getAllowedWorkspaceRoots();
  const allowed = allowedRoots.some(root => isInsidePath(root, resolved));
  const managed = allowManaged && isInsidePath(MANAGED_WORKSPACE_ROOT, resolved);

  if (isRemoteWorkspaceMode() && !managed) {
    throw new Error("Remote mode only allows managed workspaces created from ZIP or Git.");
  }

  if (!allowed && !managed) {
    throw new Error(
      "Workspace path is outside WORKSPACE_ROOTS. Configure an allowed parent folder first."
    );
  }

  return resolved;
}

export async function validateWorkspaceRoot(rootPath, options = {}) {
  const resolved = assertWorkspaceRootAllowed(rootPath, options);
  const stats = await fs.stat(resolved).catch(() => null);

  if (!stats?.isDirectory()) {
    throw new Error("Workspace root does not exist or is not a directory");
  }

  return fs.realpath(resolved);
}

function assertRelativePathAllowed(relativePath) {
  const normalizedInput = String(relativePath ?? ".").replace(/\\/g, "/").trim() || ".";

  if (path.isAbsolute(normalizedInput) || /^[A-Za-z]:\//.test(normalizedInput)) {
    throw new Error("File path must be relative to the selected workspace");
  }

  const normalized = path.posix.normalize(normalizedInput);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Path escapes selected workspace: ${relativePath}`);
  }

  const segments = normalized.split("/").filter(Boolean);
  if (
    segments.some(segment => IGNORED_DIRECTORIES.has(segment.toLowerCase())) ||
    segments.some(segment => isBlockedFileName(segment))
  ) {
    throw new Error(`Path is not available to the agent: ${relativePath}`);
  }

  return normalized;
}

export function resolveWorkspacePath(workspaceRoot, requestedPath = ".") {
  const root = getWorkspaceRoot(workspaceRoot);
  const normalized = assertRelativePathAllowed(requestedPath);
  const absolutePath = path.resolve(root, normalized);

  if (!isInsidePath(root, absolutePath)) {
    throw new Error(`Path escapes selected workspace: ${requestedPath}`);
  }

  return {
    root,
    absolutePath,
    relativePath: path.relative(root, absolutePath).replace(/\\/g, "/") || "."
  };
}

export async function resolveWorkspacePathSafe(
  workspaceRoot,
  requestedPath = ".",
  { allowMissing = false, layout = null } = {}
) {
  const root = getWorkspaceRoot(workspaceRoot);
  const normalized = normalizeWorkspaceRelativePath(requestedPath, root);
  if (!normalized) {
    throw new Error("File path escapes selected workspace and must be relative to the selected workspace");
  }
  console.log("[WRITE_PATH_NORMALIZED]", {
    requestedPath: String(requestedPath || ""),
    normalizedPath: normalized,
    workspaceRoot: root
  });
  const exactAbsolutePath = path.resolve(root, normalized);
  const workspaceFiles = await listWorkspaceFiles(root, { limit: 5000 }).catch(() => []);
  const layoutRoots = getNormalizedLayoutRoots(layout, workspaceFiles);

  const candidateRelativePaths = buildRequestedPathCandidates(normalized, layout)
    .filter((item, index, array) => array.indexOf(item) === index);

  const resolved = { root, absolutePath: exactAbsolutePath, relativePath: normalized };
  const exactExists = await pathExists(exactAbsolutePath);
  if (exactExists) {
    const realRoot = await fs.realpath(root);
    const realTarget = await fs.realpath(exactAbsolutePath);
    if (!isInsidePath(realRoot, realTarget)) {
      throw new Error(`Resolved path escapes selected workspace: ${requestedPath}`);
    }
    return {
      root: realRoot,
      absolutePath: realTarget,
      relativePath: path.relative(realRoot, realTarget).replace(/\\/g, "/") || "."
    };
  }

  for (const relativeCandidate of candidateRelativePaths) {
    const candidateAbsolute = path.resolve(root, relativeCandidate);
    const candidateHasDirectory = relativeCandidate.includes("/");
    const matchedFile = workspaceFiles.find(file => {
      const normalizedFile = String(file || "").replace(/\\/g, "/");
      return normalizedFile === relativeCandidate || (candidateHasDirectory && normalizedFile.endsWith(`/${relativeCandidate}`));
    });
    if (matchedFile) {
      const realRoot = await fs.realpath(root);
      const realTarget = await fs.realpath(path.resolve(root, matchedFile));
      if (!isInsidePath(realRoot, realTarget)) continue;
      if (normalizeWorkspaceRelativePath(matchedFile, root) !== normalized) {
        console.log("[WRITE_PATH_CANONICALIZED]", {
          requestedPath: normalized,
          canonicalPath: normalizeWorkspaceRelativePath(matchedFile, root),
          verifiedMapping: true
        });
      }
      return {
        root: realRoot,
        absolutePath: realTarget,
        relativePath: path.relative(realRoot, realTarget).replace(/\\/g, "/") || "."
      };
    }
  }

  if (allowMissing) {
    for (const relativeCandidate of candidateRelativePaths) {
      const candidateAbsolute = path.resolve(root, relativeCandidate);
      const candidateRoot = relativeCandidate.split("/")[0];
      const workspacePrefixAllowed = workspaceFiles.some(file => {
        const normalizedFile = String(file || "").replace(/\\/g, "/").trim();
        return normalizedFile === candidateRoot || normalizedFile.startsWith(`${candidateRoot}/`);
      });
      const layoutPrefixAllowed = layoutRoots.length === 0
        ? true
        : layoutRoots.some(rootHint => {
            const normalizedHint = String(rootHint || "").replace(/\\/g, "/").trim();
            if (!normalizedHint) return false;
            if (normalizedHint === ".") return true;
            return relativeCandidate === normalizedHint ||
              relativeCandidate.startsWith(`${normalizedHint}/`) ||
              candidateRoot === normalizedHint;
          });
      const candidatePrefixAllowed = workspacePrefixAllowed || layoutPrefixAllowed;

      if (!candidatePrefixAllowed) continue;
      if (await hasExistingAncestor(root, candidateAbsolute)) {
        const realRoot = await fs.realpath(root);
        if (relativeCandidate !== normalized) {
          console.log("[WRITE_PATH_CANONICALIZED]", {
            requestedPath: normalized,
            canonicalPath: relativeCandidate,
            verifiedMapping: false
          });
        }
        return {
          root: realRoot,
          absolutePath: candidateAbsolute,
          relativePath: path.relative(realRoot, candidateAbsolute).replace(/\\/g, "/") || "."
        };
      }
    }
  }

  const resolvedStrict = resolveWorkspacePath(workspaceRoot, requestedPath);
  const realRoot = await fs.realpath(resolved.root);
  let realTarget;

  try {
    realTarget = await fs.realpath(resolvedStrict.absolutePath);
  } catch (error) {
    if (!allowMissing || error.code !== "ENOENT") throw error;
    const realParent = await fs.realpath(path.dirname(resolvedStrict.absolutePath));
    realTarget = path.join(realParent, path.basename(resolvedStrict.absolutePath));
  }

  if (!isInsidePath(realRoot, realTarget)) {
    throw new Error(`Resolved path escapes selected workspace: ${requestedPath}`);
  }

  return {
    root: realRoot,
    absolutePath: realTarget,
    relativePath: path.relative(realRoot, realTarget).replace(/\\/g, "/") || "."
  };
}

export async function listWorkspaceFiles(workspaceRoot, { limit = 500 } = {}) {
  const root = await fs.realpath(getWorkspaceRoot(workspaceRoot));
  const files = [];

  async function walk(directory) {
    if (files.length >= limit) return;
    const entries = await fs.readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      if (files.length >= limit) break;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) continue;
      if (entry.isFile() && isBlockedFileName(entry.name)) continue;

      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        files.push(path.relative(root, absolutePath).replace(/\\/g, "/"));
      }
    }
  }

  await walk(root);
  return files;
}

export async function buildWorkspaceTree(workspaceRoot, { limit = 2000 } = {}) {
  const files = await listWorkspaceFiles(workspaceRoot, { limit });
  const root = [];

  for (const filePath of files) {
    const parts = filePath.split("/");
    let level = root;
    let currentPath = "";

    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = index === parts.length - 1;
      let node = level.find(item => item.name === part && item.type === (isFile ? "file" : "folder"));

      if (!node) {
        node = {
          name: part,
          path: currentPath,
          type: isFile ? "file" : "folder",
          ...(isFile ? {} : { children: [] })
        };
        level.push(node);
      }

      if (!isFile) level = node.children;
    });
  }

  function sortNodes(nodes) {
    nodes.sort((left, right) => {
      if (left.type !== right.type) return left.type === "folder" ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
    nodes.forEach(node => {
      if (node.children) sortNodes(node.children);
    });
  }

  sortNodes(root);
  return { tree: root, truncated: files.length >= limit, fileCount: files.length };
}

export async function runGit(workspaceRoot, args) {
  const root = getWorkspaceRoot(workspaceRoot);

  try {
    const result = await execFileAsync("git", ["-C", root, ...args], {
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    });
    return { success: true, stdout: result.stdout || "", stderr: result.stderr || "" };
  } catch (error) {
    return {
      success: false,
      stdout: error.stdout || "",
      stderr: error.stderr || "",
      error: error.message
    };
  }
}

export async function getGitSnapshot(workspaceRoot) {
  const status = await runGit(workspaceRoot, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all"
  ]);
  const changedFiles = status.success
    ? status.stdout.split(/\r?\n/).filter(Boolean).map(line => line.slice(3).trim())
    : [];

  return { isGitRepository: status.success, status: status.stdout, changedFiles };
}

export async function buildWriteContentPrompt({
  writeContext = {},
  targetPath = "",
  language = "",
  moduleSystem = "",
  requiredExports = [],
  requiredSymbols = [],
  importers = [],
  objective = ""
} = {}) {
  const parts = [
    "WRITE CONTENT GENERATION MODE — Do NOT select a tool.",
    "Do NOT return a \"tool\" field.",
    "Generate ONLY the file content.",
    "",
    `Target: ${targetPath}`,
    `Language: ${language}`,
    moduleSystem ? `Module system: ${moduleSystem}` : "",
    "",
    objective ? `User request: ${objective}` : "",
    ""
  ];

  if (writeContext.existingTargetContent) {
    parts.push("Existing file content:");
    parts.push("```");
    parts.push(String(writeContext.existingTargetContent).slice(0, 2000));
    parts.push("```");
    parts.push("");
  }

  if (requiredExports.length > 0) {
    parts.push("Required named exports (must be present):");
    requiredExports.forEach(sym => parts.push(`  - ${sym}`));
    parts.push("");
  }

  if (requiredSymbols.length > 0) {
    parts.push("Required symbols (must be present):");
    requiredSymbols.forEach(sym => parts.push(`  - ${sym}`));
    parts.push("");
  }

  if (importers.length > 0) {
    parts.push("Importers (these files import from this target):");
    importers.forEach(imp => parts.push(`  - ${imp}`));
    parts.push("");
  }

  if (writeContext.nearbyStyleConventions && writeContext.nearbyStyleConventions.length > 0) {
    parts.push("Nearby file conventions (match style):");
    writeContext.nearbyStyleConventions.slice(0, 3).forEach(style => {
      parts.push(`  ${style.file}:`);
      if (style.contentPreview) {
        const preview = String(style.contentPreview).slice(0, 300);
        parts.push(`    ${preview}`);
      }
    });
    parts.push("");
  }

  parts.push("Return ONLY valid JSON with no other text:");
  if (writeContext.existingTargetContent) {
    parts.push('{"content": "..."} — the full updated file content.');
  } else {
    parts.push('{"content": "..."} — the full new file content.');
  }
  parts.push("");
  parts.push("IMPORTANT: Do NOT include a \"tool\" field. Do NOT include markdown fences around the JSON.");

  return parts.filter(Boolean).join("\n");
}

export async function getDiffSummary(workspaceRoot, changedFiles = []) {
  const stat = await runGit(workspaceRoot, ["diff", "--stat", "--", ...changedFiles]);
  const numstat = await runGit(workspaceRoot, ["diff", "--numstat", "--", ...changedFiles]);
  const status = await runGit(workspaceRoot, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    ...changedFiles
  ]);
  const untrackedFiles = status.success
    ? status.stdout.split(/\r?\n/).filter(line => line.startsWith("?? ")).map(line => line.slice(3).trim())
    : [];

  return {
    stat: [
      stat.success ? stat.stdout.trim() : "",
      ...untrackedFiles.map(file => `${file} | new file`)
    ].filter(Boolean).join("\n"),
    numstat: numstat.success ? numstat.stdout.trim() : "",
    untrackedFiles,
    error: stat.success ? null : stat.error
  };
}
