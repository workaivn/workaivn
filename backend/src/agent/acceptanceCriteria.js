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
    /\b(?:không\s+cần|ko\s+cần|chỉ\s+cần|trả\s+lời)\b/i,
    /^(?:repeat|say|echo|summarize|tổng\s+kết|lặp\s+lại)\b/i
  ],
  search: [
    /\b(?:tìm|search|find|where\s+is|show\s+me|locate)\b/i,
    /\b(?:cho\s+biết|liệt\s+kê|list|what\s+(?:is|are)\s+(?:the|a|an))\b.*\b(?:file|folder|directory|thư\s+mục)\b/i,
    /\b(?:version|phiên\s+bản)\b/i
  ],
  analysis: [
    /\b(?:phân\s+tích|analyze|analyse|inspect|review|check|kiểm\s+tra|xem\s+xét)\b/i,
    /\b(?:đọc|read|show|display|print|dump).*\b(?:file|nội\s+dung|content)\b/i,
    /\b(?:what\s+(?:is|are|does)|how\s+(?:is|are|does|many))\b(?!.*(?:add|create|write|modify))/i,
    /\b(?:explain\s+(?:what|this|the|why|how))/i
  ]
};

export function classifyTaskType(prompt) {
  const text = String(prompt || "").trim();
  if (!text) return "CHAT";

  // CODING override: if prompt contains any coding/change intent, it must be CODING
  // CODING intent wins UNLESS the prompt explicitly says do not modify files.
  const explicitlyReadOnly = /\b(?:do\s+not\s+(?:modify|change|edit|write|create|run)|không\s+(?:sửa|thay\s+đổi|chạy))\b/i.test(text);

  const codingActions = [
    /\b(?:add|create|write|implement|thêm|tạo)\b/i,
    /\b(?:fix|fixbug|sửa)\b/i,
    /\b(?:update|cập\s*nhật)\b/i,
    /\b(?:change|modify|replace|refactor|thay)\b/i,
    /\b(?:remove|delete|xóa)\b/i,
    /\b(?:patch|apply\s*patch)\b/i,
    /\b(?:run[\s\S]*?\b(?:command|script|test|npm|node|python|bash|docker))\b/i,
    /\b(?:chạy\s+(?:npm|test|lệnh|script))\b/i,
    /\b(?:sau\s+khi\s+(?:sửa|thay\s+đổi|edit))\b/i,
    /\b(?:after\s+(?:modifying|editing|changing))\b/i
  ];
  for (const pattern of codingActions) {
    if (pattern.test(text) && !explicitlyReadOnly) return "CODING";
  }

  if (explicitlyReadOnly) {
    // If only asks for direct answer with no reads, it's CHAT
    if (/^(?:reply|answer|respond|say|trả\s+lời|chỉ\s+cần)\b/i.test(text) || text.split(/\s+/).length <= 5) return "CHAT";
    // If asks to list/search/find and says do not modify → SEARCH
    if (/\b(?:tìm|search|find|list|liệt\s+kê|where\s+is|show\s+me|locate)\b/i.test(text)) return "SEARCH";
    // If asks to read/explain/summarize and says do not modify → ANALYSIS
    return "ANALYSIS";
  }

  // Check in priority order: CHAT → SEARCH → ANALYSIS
  // Strong CHAT patterns: direct reply/answer intent
  const strongChatPatterns = [
    /^(?:reply|answer|respond|say)\b/i,
    /\b(?:exactly|chính\s*xác)\s+one\s+line\b/i,
    /\b(?:one|single)\s+line\b/i
  ];
  if (strongChatPatterns.some(p => p.test(text))) return "CHAT";

  for (const lc of ["chat", "search", "analysis"]) {
    for (const pattern of TASK_TYPE_PATTERNS[lc]) {
      if (pattern.test(text)) return lc.toUpperCase();
    }
  }

  // Short prompts with no action words default to chat
  if (text.split(/\s+/).length <= 3) return "CHAT";

  return "CODING";
}

export function buildAcceptanceCriteria(prompt = "") {
  const objective = String(prompt || "").trim();
  const taskType = classifyTaskType(objective);
  const requestedFeatures = Object.entries(FEATURE_PATTERNS)
    .filter(([, pattern]) => pattern.test(objective))
    .map(([feature]) => feature);
  const isProductBuild = taskType === "CODING" && requestedFeatures.some(feature =>
    ["website", "app", "cart", "payment", "qr", "sepay"].includes(feature)
  );

  const requiresWorkspaceChange = taskType === "CODING";
  const requiresValidationCommand = taskType === "CODING";
  const requiresFileRead = taskType === "ANALYSIS" || taskType === "SEARCH";
  const requiresSearchResult = taskType === "SEARCH";

  // New: Extract explicitly requested files from prompt
  const requestedFiles = (() => {
    const files = new Set();
    const text = objective;
    const FILE_RX = /\b([A-Za-z0-9_./\\-]+\.(?:json|js|jsx|mjs|cjs|ts|tsx|css|scss|html|md|txt|yml|yaml))\b/gi;
    let m;
    while ((m = FILE_RX.exec(text)) !== null) {
      const fp = m[1]
        .replace(/\\\\/g, "/")
        .replace(/\\/g, "/")
        .replace(/^\.\//, "");
      files.add(fp);
    }
    return [...files];
  })();

  // New: taskMode classification (qa | read_only | coding)
  const qaSignals = [
    /\breply\s+only\b/i,
    /\bexactly\s+one\s+line\b/i,
    /\bonly\s+the\s+number\b/i,
    /\bjust\s+(?:say|answer|reply)\b/i
  ];
  const saysDoNotModify = /\bdo\s+not\s+(?:modify|change|edit|write|create)\b|\bkhông\s+(?:sửa|thay\s*đổi|viết|tạo)\b/i.test(objective);
  let taskMode;
  if (taskType === "CODING") {
    taskMode = "coding";
  } else if (qaSignals.some(rx => rx.test(objective)) || taskType === "CHAT") {
    taskMode = "qa";
  } else if (saysDoNotModify || taskType === "ANALYSIS" || taskType === "SEARCH") {
    taskMode = "read_only";
  } else {
    // Default to coding to avoid misclassifying write intents that include file names
    taskMode = "coding";
  }

  return {
    objective,
    taskType,
    taskClass: taskType === "CODING" && isProductBuild ? "product_build" : taskType,
    taskMode,
    requestedFiles,
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
    `- Task type: ${criteria.taskType || "CODING"}`,
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

