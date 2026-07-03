const DOMAIN_LEAK_PATTERNS = [
  "goalType_mapping",
  "landingSignals",
  "bootstrap_profile",
  "profileId",
  "template",
  "react-vite-ts",
  "generic-static-html",
  "static_component_map",
  /landing_page|hero|pricing|testimonials|faq|cta|footer|navbar|features/i
];

const EXECUTION_CONTEXT_KEYS = new Set([
  "facts",
  "derived",
  "execution",
  "requestedFiles",
  "plannedNewFiles",
  "executionCandidates",
  "TaskGraph"
]);

function matchesDomainLeak(value = "") {
  const str = String(value || "");
  return DOMAIN_LEAK_PATTERNS.some(pattern => {
    if (pattern instanceof RegExp) return pattern.test(str);
    return str.includes(pattern);
  });
}

export function scanForDomainKnowledgeLeak(candidate = {}, context = {}) {
  const leaks = [];

  const scanValue = (value, path) => {
    if (!value) return;
    const str = typeof value === "string" ? value : JSON.stringify(value);
    if (matchesDomainLeak(str)) {
      leaks.push({ path, pattern: typeof value === "string" ? value : "(structured)" });
    }
  };

  for (const [key, val] of Object.entries(candidate)) {
    if (key === "evidence" || key === "metadata" || key === "promotion") {
      scanValue(val, `candidate.${key}`);
    } else {
      scanValue(val, `candidate.${key}`);
    }
  }

  if (context.facts || context.derived || context.execution || context.requestedFiles || context.plannedNewFiles || context.executionCandidates) {
    for (const key of Object.keys(context)) {
      if (EXECUTION_CONTEXT_KEYS.has(key)) {
        const val = context[key];
        if (Array.isArray(val)) {
          for (const item of val) {
            scanValue(item, `context.${key}`);
          }
        } else if (typeof val === "object" && val !== null) {
          scanValue(val, `context.${key}`);
        }
      }
    }
  }

  return leaks;
}

export function assertNoDomainKnowledgeLeak(candidate = {}, context = {}, operation = "unknown") {
  const leaks = scanForDomainKnowledgeLeak(candidate, context);
  if (leaks.length > 0) {
    const leak = leaks[0];
    console.log("[PLANNER_DOMAIN_KNOWLEDGE_LEAK_DETECTED]", {
      operation,
      path: leak.path,
      pattern: leak.pattern,
      candidateOrigin: candidate.origin || candidate.authoritySource || null,
      action: "blocked"
    });
    return {
      blocked: true,
      reason: `Domain knowledge leak detected at ${leak.path}`,
      leaks
    };
  }
  return { blocked: false, leaks: [] };
}
