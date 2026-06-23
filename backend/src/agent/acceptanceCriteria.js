const FEATURE_PATTERNS = {
  website: /\bwebsite\b|trang\s*web|tạo\s*web/i,
  app: /\bapp\b|ứng\s*dụng|application/i,
  cart: /giỏ\s*hàng|\bcart\b|shopping\s*cart/i,
  payment: /thanh\s*toán|\bpayment\b|checkout/i,
  qr: /\bqr\b|qr\s*code|mã\s*qr/i,
  sepay: /\bsepay\b/i
};

const TASK_TYPE_PATTERNS = {
  chat: [
    /^(?:hello|hi|hey|chào|hello_workai|xin chào|test)$/i,
    /\b(?:just|only)\s+(?:reply|answer|respond|say)\b/i,
    /^(?:what|who|why|how|when|where)\s+(?:is|are|was|were|do|does|did)\s+(?:you|your)\b/i,
    /\b(?:không\s+cần|ko\s+cần|chỉ\s+cần|trả\s+lời)\b/i
  ],
  search: [
    /\b(?:tìm|search|find|where\s+is|show\s+me|locate)\b/i,
    /\b(?:cho\s+biết|liệt\s+kê|list|what\s+(?:is|are)\s+(?:the|a|an))\b.*\b(?:file|folder|directory|thư\s+mục)\b/i,
    /\b(?:version|phiên\s+bản)\b/i
  ],
  analysis: [
    /\b(?:phân\s+tích|analyze|analyse|inspect|review|check|kiểm\s+tra|xem\s+xét)\b/i,
    /\b(?:đọc|read|show|display|print|dump).*\b(?:file|nội\s+dung|content)\b/i,
    /\b(?:what\s+(?:is|are|does)|how\s+(?:is|are|does|many))\b(?!.*(?:add|create|write|modify))/i
  ],
  coding: [
    /\b(?:thêm|add|sửa|fix|fixbug|create|implement|write|update|xóa|delete|remove|modify|change|refactor|cập\s+nhật)\b/i,
    /\b(?:build|make|generate|produce|develop|code|lập\s+trình)\b/i,
    /\b(?:script|function|class|component|module|route|api|endpoint)\b.*\b(?:add|create|write|implement|thêm|tạo)\b/i
  ]
};

export function classifyTaskType(prompt) {
  const text = String(prompt || "").trim();
  if (!text) return "chat";

  // Check in priority order: chat → search → analysis → coding
  for (const type of ["chat", "search", "analysis", "coding"]) {
    for (const pattern of TASK_TYPE_PATTERNS[type]) {
      if (pattern.test(text)) return type;
    }
  }

  // Short prompts with no action words default to chat
  if (text.split(/\s+/).length <= 3) return "chat";

  return "coding";
}

export function buildAcceptanceCriteria(prompt = "") {
  const objective = String(prompt || "").trim();
  const taskType = classifyTaskType(objective);
  const requestedFeatures = Object.entries(FEATURE_PATTERNS)
    .filter(([, pattern]) => pattern.test(objective))
    .map(([feature]) => feature);
  const isProductBuild = taskType === "coding" && requestedFeatures.some(feature =>
    ["website", "app", "cart", "payment", "qr", "sepay"].includes(feature)
  );

  const requiresWorkspaceChange = taskType === "coding";
  const requiresValidationCommand = taskType === "coding";
  const requiresFileRead = taskType === "analysis" || taskType === "search";
  const requiresSearchResult = taskType === "search";

  return {
    objective,
    taskType,
    taskClass: taskType === "coding" && isProductBuild ? "product_build" : taskType,
    requestedFeatures,
    requiresWorkspaceChange,
    requiresValidationCommand,
    requiresFileRead,
    requiresSearchResult,
    requiresExistingStackInspection: isProductBuild,
    requiresPackageJsonInspection: isProductBuild,
    minimumMeaningfulFiles: isProductBuild ? 8 : 1,
    allowsExistingStackIntegrationAlternative: isProductBuild,
    forbiddenPlaceholders: [
      "to be implemented",
      "not implemented",
      "implementation pending",
      "coming soon"
    ],
    requiredFlows: requestedFeatures.filter(feature =>
      ["cart", "payment", "qr", "sepay"].includes(feature)
    )
  };
}

export function acceptanceCriteriaToPrompt(criteria) {
  const lines = [
    "ACCEPTANCE CRITERIA:",
    `- Task type: ${criteria.taskType || "coding"}`,
    `- Persist real workspace changes: ${criteria.requiresWorkspaceChange ? "required" : "not required"}`,
    `- Run a validation command: ${criteria.requiresValidationCommand ? "required" : "not required"}`
  ];

  if (criteria.requiresExistingStackInspection) {
    lines.push("- Inspect package.json and the existing project stack before implementation.");
    lines.push(
      `- Implement at least ${criteria.minimumMeaningfulFiles} meaningful files, or provide a real multi-layer integration with the existing stack.`
    );
  }

  if (criteria.requiredFlows.length) {
    lines.push(`- Required functional flows: ${criteria.requiredFlows.join(", ")}.`);
  }

  lines.push(`- Forbidden incomplete placeholders: ${criteria.forbiddenPlaceholders.join(", ")}.`);
  return lines.join("\n");
}

