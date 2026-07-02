import { buildContextInvariantReport } from "./ContextInvariant.js";

export function validateContextConsistency(input = {}) {
  const report = buildContextInvariantReport(input);
  console.log("[CONTEXT_INVARIANT_CHECK]", {
    valid: report.valid,
    violationCount: report.violations.length,
    warningCount: report.warnings.length
  });
  if (report.valid) {
    console.log("[CONTEXT_INVARIANT_PASS]", {
      scanId: input?.facts?.scanId || input?.context?.facts?.scanId || null
    });
  } else {
    console.log("[CONTEXT_INVARIANT_VIOLATION]", {
      violations: report.violations,
      warnings: report.warnings
    });
  }
  return report;
}

export { buildContextInvariantReport };
