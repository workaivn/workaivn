const KNOWN_FRAMEWORKS = new Set([
  "node:test",
  "jest",
  "vitest",
  "mocha",
  "generic-js-test"
]);

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
    return { framework: normalized, kind, runnable: kind === "runnable" };
  }
  if (!availability) {
    return {
      framework: normalized,
      kind: normalized === "generic-js-test" ? "style-only" : "runnable",
      runnable: normalized !== "generic-js-test"
    };
  }
  if (normalized === "generic-js-test") {
    return { framework: normalized, kind: "style-only", runnable: false };
  }
  const source = String(availability?.source || "").trim().toLowerCase();
  const runnable = source === "package.json" || source === "test_command" || source === "dependencies";
  return {
    framework: normalized,
    kind: runnable ? "runnable" : (source === "existing_test_files" ? "style-only" : "unknown"),
    runnable
  };
}

function hasImportFromModule(text, moduleName, specifier = null, isDefault = false) {
  const escapedModule = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const modulePattern = `from\\s+["']${escapedModule}["']`;

  if (!specifier) {
    return new RegExp(`import\\s+.*?${modulePattern}`).test(text);
  }

  const escapedSpecifier = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  if (isDefault) {
    const defaultPattern = `import\\s+(?:\\*\\s+as\\s+${escapedSpecifier}|\\b${escapedSpecifier}\\b)\\s+${modulePattern}`;
    return new RegExp(defaultPattern).test(text);
  }

  const namedPattern = `import\\s+\\{[^}]*\\b${escapedSpecifier}\\b[^}]*\\}\\s+${modulePattern}`;
  const defaultPattern = `import\\s+\\b${escapedSpecifier}\\b\\s+${modulePattern}`;
  return new RegExp(`${namedPattern}|${defaultPattern}`).test(text);
}

function hasForbiddenImport(text, forbidden) {
  if (!forbidden) return false;
  const source = String(text || "");

  if (forbidden.includes(" from ")) {
    const [name, module] = forbidden.split(" from ").map(s => s.trim());
    if (!name || !module) return false;
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedModule = module.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = `import\\s+\\{[^}]*\\b${escapedName}\\b[^}]*\\}\\s+from\\s+["']${escapedModule}["']`;
    return new RegExp(pattern).test(source);
  }

  return source.includes(forbidden);
}

function hasForbiddenCall(text, call) {
  const source = String(text || "");
  const callName = String(call || "").replace(/\($/, "").trim();
  if (!callName) return false;
  const escapedName = callName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escapedName}\\s*\\(`).test(source);
}

function buildNodeTestContract() {
  const framework = "node:test";
  const imports = [
    'import { test } from "node:test";',
    'import assert from "node:assert/strict";'
  ];
  const allowedAssertions = [
    "assert.equal(actual, expected)",
    "assert.deepEqual(actual, expected)",
    "assert.throws(() => fn(), /message/)",
    "assert.ok(value)"
  ];
  const forbiddenImports = ["expect from node:test"];
  const forbiddenGlobals = ["expect"];
  const forbiddenCalls = ["expect("];
  const examples = [
    'import { test } from "node:test";\nimport assert from "node:assert/strict";\n\ntest("add", () => {\n  assert.equal(add(1, 2), 3);\n});'
  ];
  const hardRules = [
    "Do not import expect from node:test.",
    "Do not call expect().",
    "Use test() from node:test.",
    "Use assert from node:assert/strict."
  ];

  return {
    framework,
    kind: "runnable",
    runnable: true,
    role: "test",
    imports,
    allowedGlobals: [],
    allowedAssertions,
    forbiddenImports,
    forbiddenGlobals,
    forbiddenCalls,
    examples,
    hardRules,
    requiredImports: imports,
    forbiddenTokens: [
      "expect(",
      'expect } from "node:test"'
    ],
    allowedAssertionPrefix: "assert.",
    forbiddenAssertionPatterns: [/\bexpect\s*\(/]
  };
}

function buildVitestContract() {
  const framework = "vitest";
  const imports = [
    'import { test, expect } from "vitest";'
  ];
  const allowedAssertions = [
    "expect(actual).toBe(expected)",
    "expect(actual).toEqual(expected)",
    "expect(fn).toThrow()"
  ];
  const forbiddenImports = ["node:test"];
  const forbiddenGlobals = [];
  const forbiddenCalls = [];
  const examples = [
    'import { test, expect } from "vitest";\n\ntest("add", () => {\n  expect(add(1, 2)).toBe(3);\n});'
  ];
  const hardRules = [
    "Import test helpers from vitest.",
    "Do not import from node:test.",
    "Use Vitest matchers and hooks directly from vitest."
  ];

  return {
    framework,
    kind: "runnable",
    runnable: true,
    role: "test",
    imports,
    allowedGlobals: ["describe", "it", "test", "expect"],
    allowedAssertions,
    forbiddenImports,
    forbiddenGlobals,
    forbiddenCalls,
    examples,
    hardRules,
    requiredImports: imports,
    forbiddenTokens: [
      'from "node:test"',
      "from 'node:test'"
    ],
    allowedAssertionPrefix: "expect(",
    forbiddenAssertionPatterns: []
  };
}

function buildJestContract() {
  const framework = "jest";
  const imports = [];
  const allowedAssertions = [
    "expect(actual).toBe(expected)",
    "expect(actual).toEqual(expected)",
    "expect(fn).toThrow()"
  ];
  const forbiddenImports = ["node:test", "expect from node:test", "test from node:test"];
  const forbiddenGlobals = [];
  const forbiddenCalls = [];
  const examples = [
    'describe("math", () => {\n  it("adds", () => {\n    expect(add(1, 2)).toBe(3);\n  });\n});'
  ];
  const hardRules = [
    "Use Jest globals or import from @jest/globals.",
    "Do not import expect from node:test.",
    "Do not import test from node:test unless package uses node:test."
  ];

  return {
    framework,
    kind: "runnable",
    runnable: true,
    role: "test",
    imports,
    allowedGlobals: ["describe", "it", "test", "expect"],
    allowedAssertions,
    forbiddenImports,
    forbiddenGlobals,
    forbiddenCalls,
    examples,
    hardRules,
    requiredImports: imports,
    forbiddenTokens: [
      'from "node:test"',
      "from 'node:test'"
    ],
    allowedAssertionPrefix: "expect(",
    forbiddenAssertionPatterns: []
  };
}

function buildMochaContract() {
  const framework = "mocha";
  const imports = [
    "Use Mocha globals for describe(), it(), before(), and after().",
    "Use assert or chai for assertions depending on detected dependencies."
  ];
  const allowedAssertions = [
    "assert.equal(actual, expected)",
    "assert.deepEqual(actual, expected)",
    "expect(actual).to.equal(expected)"
  ];
  const forbiddenImports = ["node:test"];
  const forbiddenGlobals = [];
  const forbiddenCalls = [];
  const examples = [
    'describe("math", () => {\n  it("adds", () => {\n    assert.equal(add(1, 2), 3);\n  });\n});'
  ];
  const hardRules = [
    "Use Mocha globals for describe(), it(), before(), and after().",
    "Use assert or chai for assertions.",
    "Do not import from node:test unless project uses node:test."
  ];

  return {
    framework,
    role: "test",
    imports,
    allowedGlobals: ["describe", "it", "before", "after"],
    allowedAssertions,
    forbiddenImports,
    forbiddenGlobals,
    forbiddenCalls,
    examples,
    hardRules,
    requiredImports: [],
    forbiddenTokens: [
      'from "node:test"',
      "from 'node:test'"
    ],
    allowedAssertionPrefix: null,
    forbiddenAssertionPatterns: []
  };
}

function buildGenericContract() {
  const framework = "generic-js-test";
  const imports = [
    "Use the existing project test style without introducing a new framework."
  ];
  const allowedAssertions = [
    "Keep assertions lightweight and consistent with nearby tests."
  ];
  const forbiddenImports = [];
  const forbiddenGlobals = [];
  const forbiddenCalls = [];
  const examples = [];
  const hardRules = [
    "Do not mix multiple test frameworks in one file.",
    "Prefer node:test + node:assert/strict only if Node test runner is available."
  ];

  return {
    framework,
    kind: "style-only",
    runnable: false,
    role: "test",
    imports,
    allowedGlobals: ["test", "describe", "it"],
    allowedAssertions,
    forbiddenImports,
    forbiddenGlobals,
    forbiddenCalls,
    examples,
    hardRules,
    requiredImports: [],
    forbiddenTokens: [],
    allowedAssertionPrefix: null,
    forbiddenAssertionPatterns: []
  };
}

export function buildFrameworkGenerationContract({
  framework = "generic-js-test",
  moduleSystem = "unknown",
  targetPath = "",
  role = "unknown",
  availability = null
} = {}) {
  if (role !== "test") {
    return null;
  }

  const normalized = normalizeFramework(framework);
  const frameworkState = classifyFrameworkMode(normalized, availability);
  console.log("[FRAMEWORK_API_CONTRACT_BUILT]", {
    framework: normalized,
    kind: frameworkState.kind,
    runnable: frameworkState.runnable,
    targetPath: targetPath || null
  });

  if (!frameworkState.runnable) {
    return buildGenericContract();
  }

  if (normalized === "node:test") {
    return buildNodeTestContract();
  }
  if (normalized === "vitest") {
    return buildVitestContract();
  }
  if (normalized === "jest") {
    return buildJestContract();
  }
  if (normalized === "mocha") {
    return buildMochaContract();
  }

  return buildGenericContract();
}

export function checkFrameworkContract(content = "", contract = null) {
  if (!contract) {
    console.log("[FRAMEWORK_CONTRACT_MISSING]");
    return { pass: false, violations: ["missing_contract"] };
  }

  const text = String(content || "");
  const violations = [];
  const framework = contract.framework || "unknown";

  for (const required of contract.requiredImports || []) {
    if (required.includes('"node:test"') || required.includes("'node:test'")) {
      if (!hasImportFromModule(text, "node:test", "test")) {
        violations.push(`Missing required import: ${required}`);
      }
    } else if (required.includes('"node:assert/strict"') || required.includes("'node:assert/strict'")) {
      if (!hasImportFromModule(text, "node:assert/strict", "assert", true)) {
        violations.push(`Missing required import: ${required}`);
      }
    } else if (required.includes('"vitest"') || required.includes("'vitest'")) {
      if (!hasImportFromModule(text, "vitest", "test")) {
        violations.push(`Missing required import: ${required}`);
      }
    } else if (!text.includes(required)) {
      violations.push(`Missing required import: ${required}`);
    }
  }

  for (const forbidden of contract.forbiddenImports || []) {
    if (hasForbiddenImport(text, forbidden)) {
      violations.push(`Forbidden import: ${forbidden}`);
    }
  }

  for (const call of contract.forbiddenCalls || []) {
    if (hasForbiddenCall(text, call)) {
      violations.push(`Forbidden call: ${call}`);
    }
  }

  for (const pattern of contract.forbiddenAssertionPatterns || []) {
    if (pattern.test(text)) {
      violations.push(`Forbidden assertion pattern: ${pattern.source}`);
    }
  }

  const uniqueViolations = [...new Set(violations)];

  if (uniqueViolations.some(v => /expect\(\)|expect\(|toBe\(/i.test(v))) {
    console.log("[FRAMEWORK_ASSERTION_API_REJECTED]", {
      framework,
      violations: uniqueViolations.filter(v => /expect\(\)|expect\(|toBe\(/i.test(v))
    });
  }
  if (uniqueViolations.some(v => /import|framework/i.test(v))) {
    console.log("[FRAMEWORK_API_MISMATCH]", {
      framework,
      violations: uniqueViolations.filter(v => /import|framework/i.test(v))
    });
  }

  if (uniqueViolations.length === 0) {
    console.log("[FRAMEWORK_CONTRACT_CHECK_PASS]", { framework });
    return { pass: true, violations: [] };
  }

  console.log("[FRAMEWORK_CONTRACT_CHECK_FAIL]", {
    framework,
    violations: uniqueViolations
  });
  return { pass: false, violations: uniqueViolations };
}

export const FrameworkContractBuilder = {
  buildFrameworkGenerationContract,
  checkFrameworkContract,
  normalizeFramework
};
