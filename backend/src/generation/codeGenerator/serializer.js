export function serializeGenerationResult(result = {}) {
  return {
    taskId: result.taskId || null,
    status: result.status || "INVALID",
    tool: result.tool || null,
    targetPath: result.targetPath || "",
    content: typeof result.content === "string" ? result.content : "",
    patch: typeof result.patch === "string" ? result.patch : "",
    reason: result.reason || "",
    expectedExports: Array.isArray(result.expectedExports) ? result.expectedExports : [],
    expectedImports: Array.isArray(result.expectedImports) ? result.expectedImports : [],
    validationHints: Array.isArray(result.validationHints) ? result.validationHints : [],
    evidence: Array.isArray(result.evidence) ? result.evidence : [],
    confidence: Number.isFinite(result.confidence) ? result.confidence : 0
  };
}

