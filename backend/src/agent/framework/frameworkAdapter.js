import { parse as parseJavaScript } from "@babel/parser";
import {
  buildFrameworkGenerationContract,
  checkFrameworkContract
} from "./frameworkContractBuilder.js";

const KNOWN_FRAMEWORKS = new Set(["node:test", "jest", "vitest", "mocha", "generic-js-test"]);

function normalizeText(value = "") {
  return String(value || "").replace(/\r\n/g, "\n");
}

function normalizeFramework(value = "") {
  const framework = String(value || "").trim().toLowerCase();
  if (!framework) return "generic-js-test";
  if (framework === "node:test" || framework === "node-test" || framework === "node_test") return "node:test";
  if (framework === "vitest") return "vitest";
  if (framework === "jest") return "jest";
  if (framework === "mocha") return "mocha";
  if (framework === "generic" || framework === "generic-js-test" || framework === "js-test" || framework === "generic_test") {
    return "generic-js-test";
  }
  return KNOWN_FRAMEWORKS.has(framework) ? framework : "generic-js-test";
}

function classifyFrameworkMode(framework, availability = null) {
  const normalized = normalizeFramework(framework);
  const kind = String(availability?.kind || availability?.mode || "").trim().toLowerCase();
  if (kind === "runnable" || kind === "style-only" || kind === "unknown") {
    return {
      framework: normalized,
      kind,
      runnable: kind === "runnable",
      styleOnly: kind === "style-only",
      unknown: kind === "unknown"
    };
  }

  if (!availability) {
    return {
      framework: normalized,
      kind: normalized === "generic-js-test" ? "style-only" : "runnable",
      runnable: normalized !== "generic-js-test",
      styleOnly: normalized === "generic-js-test",
      unknown: false
    };
  }

  if (normalized === "generic-js-test") {
    const hasEvidence = Boolean(availability?.validationCommand || availability?.source === "existing_test_files" || availability?.source === "test_command");
    return {
      framework: normalized,
      kind: hasEvidence ? "style-only" : "unknown",
      runnable: false,
      styleOnly: hasEvidence,
      unknown: !hasEvidence
    };
  }

  const source = String(availability?.source || "").trim().toLowerCase();
  const runnable = source === "package.json" || source === "test_command" || source === "dependencies";
  const styleOnly = source === "existing_test_files";
  return {
    framework: normalized,
    kind: runnable ? "runnable" : (styleOnly ? "style-only" : "unknown"),
    runnable,
    styleOnly,
    unknown: !runnable && !styleOnly
  };
}

function detectFrameworkFromScript(testScript = "") {
  const script = String(testScript || "").toLowerCase();
  if (!script) return null;
  if (/\bnode\s+--test\b/.test(script) || /\bnode:test\b/.test(script)) return "node:test";
  if (/\bvitest\b/.test(script)) return "vitest";
  if (/\bjest\b/.test(script)) return "jest";
  if (/\bmocha\b/.test(script)) return "mocha";
  return null;
}

function detectFrameworkFromDependencies(packageJson = {}) {
  const deps = new Set([
    ...Object.keys(packageJson?.dependencies || {}),
    ...Object.keys(packageJson?.devDependencies || {})
  ].map(dep => String(dep || "").toLowerCase()));
  if (deps.has("vitest")) return "vitest";
  if (deps.has("jest")) return "jest";
  if (deps.has("mocha")) return "mocha";
  return null;
}

function detectFrameworkFromFiles(nearbyFiles = []) {
  const text = (Array.isArray(nearbyFiles) ? nearbyFiles : [])
    .flatMap(entry => [
      String(entry?.file || entry?.path || ""),
      String(entry?.contentPreview || ""),
      String(entry?.content || "")
    ])
    .join("\n")
    .toLowerCase();
  if (!text.trim()) return null;
  if (/\bnode:test\b/.test(text) || /\bnode\s+--test\b/.test(text)) return "node:test";
  if (/\bvitest\b/.test(text)) return "vitest";
  if (/\bjest\b/.test(text)) return "jest";
  if (/\bmocha\b/.test(text)) return "mocha";
  return null;
}

function detectFrameworkFromCommands(testCommands = []) {
  for (const command of Array.isArray(testCommands) ? testCommands : []) {
    const text = String(command || "").toLowerCase();
    if (!text.trim()) continue;
    if (/\bnode\s+--test\b/.test(text) || /\bnode:test\b/.test(text)) return "node:test";
    if (/\bvitest\b/.test(text)) return "vitest";
    if (/\bjest\b/.test(text)) return "jest";
    if (/\bmocha\b/.test(text)) return "mocha";
  }
  return null;
}

function buildTestFrameworkAvailability(framework, { packageJson = null, testCommands = [], nearbyFiles = [], projectScan = {} } = {}) {
  const normalized = normalizeFramework(framework);
  const script = String(packageJson?.scripts?.test || "").trim();
  const detectedCommand = detectFrameworkFromCommands(testCommands)
    || detectFrameworkFromCommands(Array.isArray(projectScan?.testCommands) ? projectScan.testCommands : []);
  const detectedFileFramework = detectFrameworkFromFiles(nearbyFiles);
  const validationCommand = script || detectedCommand || detectedFileFramework || null;
  const runnable = normalized === "node:test"
    ? true
    : normalized === "generic-js-test"
      ? false
      : Boolean(script || detectedCommand);
  const source = script
    ? "package.json"
    : detectedCommand
      ? "test_command"
      : detectedFileFramework
        ? "existing_test_files"
        : "generic";
  const kind = classifyFrameworkMode(normalized, {
    kind: runnable ? "runnable" : (normalized === "generic-js-test" ? (validationCommand ? "style-only" : "unknown") : (source === "existing_test_files" ? "style-only" : "unknown")),
    validationCommand,
    source
  }).kind;
  const reason = normalized === "generic-js-test"
    ? (kind === "style-only" ? "generic_style_with_command" : "generic_style_only")
    : (runnable ? (script ? "package_json_script" : "detected_framework") : "style_only_framework");

  const availability = {
    framework: normalized,
    kind,
    runnable,
    source,
    reason,
    validationCommand
  };

  console.log("[TEST_FRAMEWORK_AVAILABILITY]", availability);
  return availability;
}

export function detectFramework(projectInfo = {}) {
  const packageJson = projectInfo?.packageJson && typeof projectInfo.packageJson === "object"
    ? projectInfo.packageJson
    : null;
  const projectScan = projectInfo?.projectScan && typeof projectInfo.projectScan === "object"
    ? projectInfo.projectScan
    : {};
  const nearbyFiles = Array.isArray(projectInfo?.nearbyFiles) ? projectInfo.nearbyFiles : [];
  const testCommands = Array.isArray(projectInfo?.testCommands)
    ? projectInfo.testCommands
    : Array.isArray(projectScan?.testCommands)
      ? projectScan.testCommands
      : [];

  const script = String(packageJson?.scripts?.test || "");
  const scriptFramework = detectFrameworkFromScript(script);
  if (scriptFramework) {
    return {
      framework: scriptFramework,
      source: "package.json",
      evidence: { testScript: script },
      availability: buildTestFrameworkAvailability(scriptFramework, { packageJson, testCommands, nearbyFiles, projectScan })
    };
  }

  const dependencyFramework = packageJson ? detectFrameworkFromDependencies(packageJson) : null;
  if (dependencyFramework) {
    return {
      framework: dependencyFramework,
      source: "package.json",
      evidence: { dependencies: true },
      availability: buildTestFrameworkAvailability(dependencyFramework, { packageJson, testCommands, nearbyFiles, projectScan })
    };
  }

  const fileFramework = detectFrameworkFromFiles(nearbyFiles);
  if (fileFramework) {
    return {
      framework: fileFramework,
      source: "existing_test_files",
      evidence: { nearbyFiles: nearbyFiles.length },
      availability: buildTestFrameworkAvailability(fileFramework, { packageJson, testCommands, nearbyFiles, projectScan })
    };
  }

  const commandFramework = detectFrameworkFromCommands(testCommands);
  if (commandFramework) {
    return {
      framework: commandFramework,
      source: "test_command",
      evidence: { testCommands: [...testCommands].slice(0, 8) },
      availability: buildTestFrameworkAvailability(commandFramework, { packageJson, testCommands, nearbyFiles, projectScan })
    };
  }

  return {
    framework: "generic-js-test",
    source: "generic",
    evidence: {},
    availability: buildTestFrameworkAvailability("generic-js-test", { packageJson, testCommands, nearbyFiles, projectScan })
  };
}

// ============================================================
// AST-BASED FRAMEWORK VALIDATION
// ============================================================

function parseJavaScriptSource(content = "") {
  try {
    return parseJavaScript(String(content || ""), {
      sourceType: "unambiguous",
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

function extractImports(ast) {
  const imports = [];
  for (const node of ast.program.body) {
    if (node.type !== "ImportDeclaration") continue;
    const module = node.source.value;
    const names = node.specifiers.map(spec => {
      if (spec.type === "ImportDefaultSpecifier") return spec.local.name;
      if (spec.type === "ImportNamespaceSpecifier") return "*";
      if (spec.type === "ImportSpecifier") return spec.imported.name;
      return null;
    }).filter(Boolean);
    imports.push({ module, names });
  }
  return imports;
}

function extractRequireCalls(ast) {
  const requires = [];
  function walk(nodes) {
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      if (node.type === "CallExpression" && node.callee?.name === "require" && node.arguments?.[0]?.type === "StringLiteral") {
        requires.push(node.arguments[0].value);
      }
      for (const key of Object.keys(node)) {
        if (["type", "start", "end", "loc", "leadingComments", "trailingComments", "comments", "extra"].includes(key)) continue;
        const child = node[key];
        if (Array.isArray(child)) walk(child);
        else if (child && typeof child.type === "string") walk([child]);
      }
    }
  }
  walk(ast.program.body);
  return requires;
}

function extractTopLevelDeclarations(ast) {
  const locals = new Set();
  for (const node of ast.program.body) {
    if (node.type === "FunctionDeclaration" && node.id?.name) locals.add(node.id.name);
    if (node.type === "VariableDeclaration") {
      for (const decl of node.declarations) {
        if (decl.id?.type === "Identifier") locals.add(decl.id.name);
        else if (decl.id?.type === "ObjectPattern") {
          for (const prop of decl.id.properties) {
            if (prop.type === "RestElement") continue;
            if (prop.key?.name) locals.add(prop.key.name);
            else if (prop.value?.name) locals.add(prop.value.name);
          }
        }
      }
    }
    if (node.type === "ClassDeclaration" && node.id?.name) locals.add(node.id.name);
  }
  return locals;
}

function extractGlobalCalls(ast, locals) {
  const calls = new Set();
  function walk(nodes) {
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      if (node.type === "CallExpression" && node.callee?.type === "Identifier") {
        if (!locals.has(node.callee.name)) {
          calls.add(node.callee.name);
        }
      }
      for (const key of Object.keys(node)) {
        if (["type", "start", "end", "loc", "leadingComments", "trailingComments", "comments", "extra"].includes(key)) continue;
        const child = node[key];
        if (Array.isArray(child)) walk(child);
        else if (child && typeof child.type === "string") walk([child]);
      }
    }
  }
  walk(ast.program.body);
  return calls;
}

function detectFrameworkApiMismatch(content, framework, availability = null) {
  const normalized = normalizeFramework(framework);
  const text = normalizeText(content);
  const source = String(availability?.source || "").trim().toLowerCase();
  const runnable = availability ? availability.kind === "runnable" || availability.runnable === true : true;
  const allowsFrameworkApis = normalized !== "generic-js-test" && runnable;

  const frameworkMarkers = [
    { framework: "node:test", patterns: [/\bfrom\s+["']node:test["']/, /\brequire\s*\(\s*["']node:test["']\s*\)/, /\bexpect\s*\(/, /\bexpect\s*\.\s*toBe\s*\(/], api: "node:test" },
    { framework: "vitest", patterns: [/\bfrom\s+["']vitest["']/, /\bfrom\s+["']@vitest\/globals["']/, /\bexpect\s*\(/], api: "vitest" },
    { framework: "jest", patterns: [/\bfrom\s+["']@jest\/globals["']/, /\bexpect\s*\(/], api: "jest" },
    { framework: "mocha", patterns: [/\bdescribe\s*\(/, /\bit\s*\(/, /\bbefore\s*\(/, /\bafter\s*\(/], api: "mocha" }
  ];

  const mismatches = [];
  const assertionRejections = [];

  if (normalized === "generic-js-test") {
    for (const entry of frameworkMarkers) {
      if (entry.patterns.some(rx => rx.test(text))) {
        mismatches.push(entry.api);
      }
    }
    if (/\bexpect\s*\(/.test(text) || /\bexpect\s*\.\s*toBe\s*\(/.test(text)) {
      assertionRejections.push("expect");
    }
    return { mismatches, assertionRejections };
  }

  if (normalized === "jest" && !runnable) {
    if (/\bexpect\s*\(/.test(text) || /\bexpect\s*\.\s*toBe\s*\(/.test(text)) {
      assertionRejections.push("expect");
    }
    mismatches.push("jest unavailable");
  }

  if (normalized === "vitest" && !runnable) {
    if (/\bexpect\s*\(/.test(text) || /\bexpect\s*\.\s*toBe\s*\(/.test(text)) {
      assertionRejections.push("expect");
    }
    mismatches.push("vitest unavailable");
  }

  if (normalized === "node:test") {
    if (/\bfrom\s+["']vitest["']/.test(text) || /\bfrom\s+["']@jest\/globals["']/.test(text) || /\bfrom\s+["']jest["']/.test(text)) {
      mismatches.push("framework import mismatch");
    }
    if (/\bexpect\s*\(/.test(text) || /\bexpect\s*\.\s*toBe\s*\(/.test(text)) {
      assertionRejections.push("expect");
    }
  }

  if (normalized === "vitest") {
    if (/\bfrom\s+["']node:test["']/.test(text)) {
      mismatches.push("framework import mismatch");
    }
  }

  if (normalized === "jest") {
    if (/\bfrom\s+["']node:test["']/.test(text)) {
      mismatches.push("framework import mismatch");
    }
  }

  if (source === "existing_test_files" && normalized !== "node:test" && /\bexpect\s*\(/.test(text)) {
    assertionRejections.push("expect");
  }

  return { mismatches, assertionRejections };
}

function validateNodeTest(content, availability = null) {
  const ast = parseJavaScriptSource(content);
  if (!ast) {
    return {
      success: false,
      framework: "node:test",
      reason: "content_cannot_parse",
      suggestion: "Generated content could not be parsed as JavaScript",
      found: ["parse_error"],
      imports: [],
      illegalImports: [],
      illegalGlobals: [],
      illegalCalls: [],
      illegalAssertions: [],
      repairInstructions: ["Ensure valid JavaScript syntax"]
    };
  }

  const imports = extractImports(ast);
  const requires = extractRequireCalls(ast);
  const locals = extractTopLevelDeclarations(ast);
  const calls = extractGlobalCalls(ast, locals);

  const illegalImports = [];
  const illegalCalls = [];
  const allImportedModules = new Set([...imports.map(i => i.module), ...requires]);
  const hasTestImport = imports.some(imp => imp.module === "node:test" && imp.names.includes("test"));
  const hasAssertImport = imports.some(imp => imp.module === "node:assert/strict" && imp.names.includes("assert"));

  for (const imp of imports) {
    if (imp.module === "node:test") {
      for (const name of imp.names) {
        if (name !== "test") {
          illegalImports.push(`${name} from ${imp.module}`);
        }
      }
    }
  }

  const FORBIDDEN_CALLS = new Set(["expect"]);
  for (const name of calls) {
    if (FORBIDDEN_CALLS.has(name)) {
      illegalCalls.push(name);
    }
  }

  if (/\bexpect\s*\.\s*toBe\s*\(/.test(content)) {
    illegalCalls.push("expect().toBe");
  }

  if (!hasTestImport) {
    illegalImports.push("test from node:test");
  }
  if (!hasAssertImport) {
    illegalImports.push("assert from node:assert/strict");
  }

  const allIllegal = illegalImports.length > 0 || illegalCalls.length > 0;
  const success = !allIllegal;

  const repairInstructions = [];
  if (illegalImports.length > 0) {
    for (const imp of illegalImports) {
      if (imp.startsWith("expect")) {
        repairInstructions.push(`Replace ${imp} with import from "node:assert/strict"`);
      } else {
        repairInstructions.push(`Remove illegal import: ${imp}`);
      }
    }
  }
  if (illegalCalls.includes("expect")) {
    repairInstructions.push("Replace expect() with assert.*");
  }
  const result = {
    success,
    framework: "node:test",
    imports,
    illegalImports: [...new Set(illegalImports)],
    illegalGlobals: [],
    illegalCalls: [...new Set(illegalCalls)],
    illegalAssertions: [],
    repairInstructions,
    found: success
      ? ["test", "assert"]
      : [...new Set([...illegalImports, ...illegalCalls.map(n => `${n}()`), ...(illegalCalls.includes("expect") ? ["assert"] : [])])]
  };

  const apiMismatch = detectFrameworkApiMismatch(content, "node:test", availability);
  if (!success || apiMismatch.mismatches.length > 0) {
    console.log("[FRAMEWORK_API_MISMATCH]", {
      framework: "node:test",
      mismatches: [...new Set([
        ...apiMismatch.mismatches,
        ...(illegalImports.length > 0 ? ["test api mismatch"] : []),
        ...(illegalCalls.length > 0 ? ["test api mismatch"] : [])
      ])]
    });
  }
  if (apiMismatch.assertionRejections.length > 0) {
    console.log("[FRAMEWORK_ASSERTION_API_REJECTED]", {
      framework: "node:test",
      rejected: [...new Set(apiMismatch.assertionRejections)]
    });
  }

  if (!success) {
    result.reason = "Illegal import(s) and/or call(s) detected";
    result.suggestion = repairInstructions.length > 0 ? repairInstructions.join(". ") : "Use test() with node:assert/strict assertions";
  }

  return result;
}

function validateJest(content, availability = null) {
  const ast = parseJavaScriptSource(content);
  if (!ast) {
    return { success: false, framework: "jest", reason: "content_cannot_parse", suggestion: "Generated content could not be parsed as JavaScript", found: ["parse_error"] };
  }

  const imports = extractImports(ast);
  const requires = extractRequireCalls(ast);
  const allModules = new Set([...imports.map(i => i.module), ...requires]);

  const apiMismatch = detectFrameworkApiMismatch(content, "jest", availability);
  const hasNodeTest = allModules.has("node:test");
  const runnable = availability ? availability.kind === "runnable" || availability.runnable === true : true;

  if (!runnable || hasNodeTest || apiMismatch.mismatches.length > 0) {
    if (apiMismatch.mismatches.length > 0) {
      console.log("[FRAMEWORK_API_MISMATCH]", {
        framework: "jest",
        mismatches: [...new Set(apiMismatch.mismatches)]
      });
    }
    if (apiMismatch.assertionRejections.length > 0) {
      console.log("[FRAMEWORK_ASSERTION_API_REJECTED]", {
        framework: "jest",
        rejected: [...new Set(apiMismatch.assertionRejections)]
      });
    }
    return {
      success: false,
      framework: "jest",
      reason: runnable ? "framework_mismatch" : "framework_unavailable",
      suggestion: 'Use Jest globals or import from @jest/globals',
      found: [...new Set([...(hasNodeTest ? ["node:test"] : []), ...apiMismatch.mismatches, ...apiMismatch.assertionRejections])]
    };
  }

  return { success: true, framework: "jest", found: ["describe", "it", "test", "expect"] };
}

function validateVitest(content, availability = null) {
  const ast = parseJavaScriptSource(content);
  if (!ast) {
    return { success: false, framework: "vitest", reason: "content_cannot_parse", suggestion: "Generated content could not be parsed as JavaScript", found: ["parse_error"] };
  }

  const imports = extractImports(ast);
  const requires = extractRequireCalls(ast);
  const allModules = new Set([...imports.map(i => i.module), ...requires]);

  const apiMismatch = detectFrameworkApiMismatch(content, "vitest", availability);
  const hasNodeTest = allModules.has("node:test");
  const runnable = availability ? availability.kind === "runnable" || availability.runnable === true : true;
  if (!runnable || hasNodeTest || apiMismatch.mismatches.length > 0 || apiMismatch.assertionRejections.length > 0) {
    if (apiMismatch.mismatches.length > 0) {
      console.log("[FRAMEWORK_API_MISMATCH]", {
        framework: "vitest",
        mismatches: [...new Set(apiMismatch.mismatches)]
      });
    }
    if (apiMismatch.assertionRejections.length > 0) {
      console.log("[FRAMEWORK_ASSERTION_API_REJECTED]", {
        framework: "vitest",
        rejected: [...new Set(apiMismatch.assertionRejections)]
      });
    }
    return {
      success: false,
      framework: "vitest",
      reason: runnable ? "framework_mismatch" : "framework_unavailable",
      suggestion: 'Import test helpers from vitest',
      found: [...new Set([...(hasNodeTest ? ["node:test"] : []), ...apiMismatch.mismatches, ...apiMismatch.assertionRejections])]
    };
  }

  return { success: true, framework: "vitest", found: ["vitest"] };
}

function validateMocha(content) {
  const ast = parseJavaScriptSource(content);
  if (!ast) {
    return { success: false, framework: "mocha", reason: "content_cannot_parse", suggestion: "Generated content could not be parsed as JavaScript", found: ["parse_error"] };
  }

  const imports = extractImports(ast);
  const requires = extractRequireCalls(ast);
  const allModules = new Set([...imports.map(i => i.module), ...requires]);

  const hasNodeTest = allModules.has("node:test");
  if (hasNodeTest) {
    return {
      success: false,
      framework: "mocha",
      reason: "framework_mismatch",
      suggestion: 'Use Mocha globals or chai assertions',
      found: ["node:test"]
    };
  }

  return { success: true, framework: "mocha", found: ["describe", "it", "before", "after", "assert", "chai"] };
}

function validateGeneric(content, availability = null) {
  const ast = parseJavaScriptSource(content);
  if (!ast) {
    return { success: true, framework: "generic-js-test", found: [] };
  }

  const imports = extractImports(ast);
  const allModules = imports.map(i => i.module);
  const apiMismatch = detectFrameworkApiMismatch(content, "generic-js-test", availability);
  const hasNodeTest = allModules.includes("node:test");
  const hasOtherFramework = allModules.some(m => m === "vitest" || m === "@jest/globals" || m === "chai" || m === "jest");

  if (hasNodeTest && hasOtherFramework) {
    return {
      success: false,
      framework: "generic-js-test",
      reason: "framework_mismatch",
      suggestion: "Keep the test file on one framework only",
      found: ["node:test", "other-test-lib"]
    };
  }

  if (apiMismatch.mismatches.length > 0 || apiMismatch.assertionRejections.length > 0) {
    if (apiMismatch.mismatches.length > 0) {
      console.log("[FRAMEWORK_API_MISMATCH]", {
        framework: "generic-js-test",
        mismatches: [...new Set(apiMismatch.mismatches)]
      });
    }
    if (apiMismatch.assertionRejections.length > 0) {
      console.log("[FRAMEWORK_ASSERTION_API_REJECTED]", {
        framework: "generic-js-test",
        rejected: [...new Set(apiMismatch.assertionRejections)]
      });
    }
    return {
      success: false,
      framework: "generic-js-test",
      reason: "framework_mismatch",
      suggestion: "Keep the test file on one framework only",
      found: [...new Set([...apiMismatch.mismatches, ...apiMismatch.assertionRejections])]
    };
  }

  return { success: true, framework: "generic-js-test", found: [] };
}

export function validateFramework(content = "", framework = "generic-js-test", availability = null) {
  const normalized = normalizeFramework(framework);
  const text = normalizeText(content);
  let result;
  if (normalized === "node:test") {
    result = validateNodeTest(text, availability);
  } else if (normalized === "jest") {
    result = validateJest(text, availability);
  } else if (normalized === "vitest") {
    result = validateVitest(text, availability);
  } else if (normalized === "mocha") {
    result = validateMocha(text);
  } else {
    result = validateGeneric(text, availability);
  }

  if (result.success) {
    console.log("[FRAMEWORK_VALIDATION_PASS]", {
      framework: normalized,
      found: result.found || [],
      imports: result.imports
    });
  } else {
    console.log("[FRAMEWORK_VALIDATION_FAIL]", {
      framework: normalized,
      reason: result.reason,
      illegalImports: result.illegalImports,
      illegalCalls: result.illegalCalls,
      repairInstructions: result.repairInstructions,
      suggestion: result.suggestion
    });
  }

  return result;
}

export function buildGenerationHints(framework = "generic-js-test", availability = null) {
  const normalized = normalizeFramework(framework);
  const frameworkState = classifyFrameworkMode(normalized, availability);
  let hints;
  if (normalized === "node:test" && frameworkState.runnable) {
    hints = {
      framework: normalized,
      kind: frameworkState.kind,
      importStyle: 'Use import test from "node:test" or import { test } from "node:test".',
      assertions: 'Use import assert from "node:assert/strict" or import * as assert from "node:assert/strict".',
      forbidden: "Do not use expect().toBe() or expect() with node:test."
    };
  } else if (normalized === "jest" && frameworkState.runnable) {
    hints = {
      framework: normalized,
      kind: frameworkState.kind,
      importStyle: 'Use Jest globals or import { describe, it, test, expect } from "@jest/globals".',
      assertions: "Use describe(), it(), test(), expect(), beforeEach(), and afterEach().",
      forbidden: 'Do not import from "node:test".'
    };
  } else if (normalized === "vitest" && frameworkState.runnable) {
    hints = {
      framework: normalized,
      kind: frameworkState.kind,
      importStyle: 'Use import { describe, it, test, expect } from "vitest".',
      assertions: "Use Vitest matchers and hooks directly from vitest.",
      forbidden: 'Do not import from "node:test".'
    };
  } else if (normalized === "mocha" && frameworkState.runnable) {
    hints = {
      framework: normalized,
      kind: frameworkState.kind,
      importStyle: "Use Mocha globals for describe(), it(), before(), and after().",
      assertions: "Use assert or chai for assertions.",
      forbidden: 'Do not import from "node:test".'
    };
  } else {
    hints = {
      framework: "generic-js-test",
      kind: frameworkState.kind,
      importStyle: "Use the existing project test style without introducing a new framework.",
      assertions: "Keep assertions lightweight and consistent with nearby tests.",
      forbidden: "Do not mix multiple test frameworks in one file."
    };
  }

  console.log("[FRAMEWORK_GENERATION_HINTS]", hints);
  return hints;
}

export const FrameworkAdapter = {
  detectFramework,
  detect: detectFramework,
  validateFramework,
  validate: validateFramework,
  buildGenerationHints,
  normalizeFramework,
  buildFrameworkGenerationContract,
  checkFrameworkContract
};
