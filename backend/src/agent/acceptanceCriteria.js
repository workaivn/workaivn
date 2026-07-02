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

const WRITE_INTENT_PATTERNS = [
  /\b(?:create|build|implement|make|add|update|modify|edit|replace|write|fix|patch|change|rename|delete|remove|refactor|develop|append|prepend|insert)\b/i,
  /\blanding\s+page\b/i,
  /\b(?:dashboard|login|crud|feature|api|component|page|screen|form)\b/i
];

const CLEAR_READ_ONLY_PATTERN =
  /\bdo\s+not\s+(?:modify|change|edit|write)(?:\s+(?:any\s+)?(?:files?|code))?\b|\bdo\s+not\s+modify\s+files?\b|\bkhÃ´ng\s+(?:sá»­a|thay\s*Ä‘á»•i|viáº¿t)\b/i;

export const REQUESTED_FILE_KIND = Object.freeze({
  EXPLICIT_CREATE: 'EXPLICIT_CREATE',
  EXPLICIT_MODIFICATION: 'EXPLICIT_MODIFICATION',
  REFERENCE_ONLY: 'REFERENCE_ONLY',
  CONDITIONAL: 'CONDITIONAL',
  DISCOVER_IF_EXISTS: 'DISCOVER_IF_EXISTS',
  DERIVED: 'DERIVED'
});

function normalizeRequestedFilePath(value = '') {
  return String(value || '')
    .replace(/\\\\/g, '/')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .trim();
}

function classifyRequestedFileKind(objective, file) {
  const text = String(objective || '');
  const normalizedFile = normalizeRequestedFilePath(file);
  const lowerText = text.toLowerCase();
  const lowerFile = normalizedFile.toLowerCase();
  const fileIndex = lowerText.indexOf(lowerFile);
  const window = fileIndex >= 0
    ? lowerText.slice(Math.max(0, fileIndex - 120), Math.min(lowerText.length, fileIndex + lowerFile.length + 120))
    : lowerText;
  const local = `${window}\n${lowerText}`;

  const isPackageJson = /(^|\/)package\.json$/i.test(normalizedFile);
  const isConditional = isPackageJson && /\b(?:unless\s+(?:absolutely\s+)?necessary|only\s+if\s+necessary|if\s+necessary|if\s+needed)\b/i.test(local);
  const isReferenceOnly = /\b(?:use|read|inspect|check|review|open|view|show|display|look\s+at)\b[\s\S]{0,40}\b(?:if\s+it\s+exists|if\s+exists)\b/i.test(local)
    || /\b(?:if\s+it\s+exists|if\s+exists)\b[\s\S]{0,40}\b(?:use|read|inspect|check|review|open|view|show|display|look\s+at)\b/i.test(local);
  const isDerived = /\binfer\b[\s\S]{0,40}\bpackage\.json\b/i.test(local)
    || (isPackageJson && /\binfer\b/i.test(local));
  const isDiscoverIfExists = isPackageJson && (
    /\bdetect\s+framework\b[\s\S]{0,60}\bpackage\.json\b/i.test(local)
    || /\bframework\b[\s\S]{0,60}\bpackage\.json\b/i.test(local)
    || /\bdetect\s+framework\s+automatically\b/i.test(local)
  );
  const writeCreate = /\b(?:create|build|implement|make|add|write|generate|construct)\b/i.test(window);
  const writeModify = /\b(?:update|modify|edit|patch|change|rename|delete|remove|refactor|fix|replace|append|prepend|insert)\b/i.test(window);

  if (isDerived) return REQUESTED_FILE_KIND.DERIVED;
  if (isDiscoverIfExists) return REQUESTED_FILE_KIND.DISCOVER_IF_EXISTS;
  if (isConditional || (isPackageJson && /\bdo\s+not\s+modify\b/i.test(local))) return REQUESTED_FILE_KIND.CONDITIONAL;
  if (isReferenceOnly) return REQUESTED_FILE_KIND.REFERENCE_ONLY;
  if (writeCreate) return REQUESTED_FILE_KIND.EXPLICIT_CREATE;
  if (writeModify) return REQUESTED_FILE_KIND.EXPLICIT_MODIFICATION;
  return REQUESTED_FILE_KIND.REFERENCE_ONLY;
}

export function classifyRequestedFiles(objective = '', requestedFiles = []) {
  const files = [...new Set((Array.isArray(requestedFiles) ? requestedFiles : []).map(file => normalizeRequestedFilePath(file)).filter(Boolean))];
  return files.map(file => {
    const kind = classifyRequestedFileKind(objective, file);
    const detail = {
      path: file,
      kind,
      authoritySource: kind === REQUESTED_FILE_KIND.DERIVED
        ? 'verified_planning_context'
        : 'explicit_user_request',
      conditional: kind === REQUESTED_FILE_KIND.CONDITIONAL,
      explicit: kind !== REQUESTED_FILE_KIND.DERIVED,
      verified: false
    };

    console.log('[REQUESTED_FILE_CLASSIFIED]', {
      path: file,
      kind,
      authoritySource: detail.authoritySource,
      conditional: detail.conditional,
      explicit: detail.explicit
    });

    console.log('[REQUESTED_KIND]', {
      path: file,
      kind
    });

    if (kind === REQUESTED_FILE_KIND.REFERENCE_ONLY) {
      console.log('[REFERENCE_ONLY_FILE]', { path: file });
    } else if (kind === REQUESTED_FILE_KIND.CONDITIONAL) {
      console.log('[CONDITIONAL_FILE]', { path: file });
    } else if (kind === REQUESTED_FILE_KIND.DERIVED) {
      console.log('[DERIVED_FILE_BLOCKED]', { path: file });
    }

    return detail;
  });
}

export function classifyTaskType(prompt) {
  const text = String(prompt || "").trim();
  if (!text) return "CHAT";

  // CODING override: if prompt contains any coding/change intent, it must be CODING.
  // "Do not create a new project" is a scope constraint, not a read-only request.
  const explicitlyReadOnly = CLEAR_READ_ONLY_PATTERN.test(text);
  const writeIntentText = text.replace(CLEAR_READ_ONLY_PATTERN, " ");

  if (WRITE_INTENT_PATTERNS.some(pattern => pattern.test(writeIntentText))) return "CODING";

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
    if (pattern.test(writeIntentText) && !explicitlyReadOnly) return "CODING";
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

function findMatchedKeywords(objective, taskClass) {
  const text = String(objective || '');
  const keywordMap = {
    UI_BUILD: ['landing page', 'homepage', 'hero', 'dashboard', 'admin page', 'component', 'react page', 'vue page', 'flutter page', 'tailwind', 'css', 'layout', 'responsive', 'theme', 'navigation', 'card', 'button', 'banner', 'marketing page'],
    BUGFIX: ['fix', 'bug', 'patch', 'error', 'crash', 'broken', 'not working', 'failed'],
    REFACTOR: ['refactor', 'restructure', 'clean up', 'reorganize', 'rewrite'],
    CONFIG_CHANGE: ['config', 'setup', 'install', 'environment', 'env variable'],
    LIBRARY_CHANGE: ['add library', 'add package', 'add dependency', 'install library', 'install package'],
    PRODUCT_BUILD: ['complete product', 'complete application', 'full application', 'new SaaS', 'new CMS', 'new ERP', 'new CRM', 'large system', 'multi-module'],
    BACKEND_FEATURE: ['api', 'endpoint', 'server', 'backend', 'database', 'schema', 'route', 'controller', 'middleware'],
    FULLSTACK_FEATURE: ['frontend + backend', 'full stack']
  };
  const keywords = keywordMap[taskClass] || [];
  const matched = keywords.filter(kw => text.toLowerCase().includes(kw.toLowerCase()));
  return matched;
}

function classifyTaskClass(objective, taskType) {
  if (taskType !== 'CODING') return taskType;
  const text = String(objective || '');

  // BUGFIX — fix/patch/bug keywords (highest priority)
  if (/\b(?:fix|bug|patch|error|crash|broken|not\s+working|failed)\b/i.test(text)) return 'BUGFIX';

  // REFACTOR — restructure/rewrite keywords
  if (/\b(?:refactor|restructure|clean\s+up|reorganize|rewrite)\b/i.test(text)) return 'REFACTOR';

  // CONFIG_CHANGE — setup/install/configure keywords
  if (/\b(?:config(?:ure)?|setup|install|environment|env\s+variable)\b/i.test(text)) return 'CONFIG_CHANGE';

  // LIBRARY_CHANGE — add/remove/install library/package
  if (/\b(?:add\s+(?:a\s+)?(?:library|package|dependency)|install\s+(?:a\s+)?(?:library|package|dependency)|remove\s+(?:a\s+)?(?:library|package|dependency))\b/i.test(text)) return 'LIBRARY_CHANGE';

  // PRODUCT_BUILD — very restrictive: only for "complete product" type requests
  const productPatterns = [
    /\bcomplete\s+(?:product|application|system|platform|solution)\b/i,
    /\bfull\s+(?:application|stack|system|platform)\b/i,
    /\bnew\s+(?:SaaS|CMS|ERP|CRM|platform|startup|ecommerce|e-commerce)\b/i,
    /\blarge\s+(?:system|project|application|platform)\b/i,
    /\bmulti[-\s]module\s+(?:project|application|system)\b/i,
    /\bcomplete\s+(?:frontend|front-end)\s*\+\s*(?:backend|back-end)\b/i,
    /\becommerce|e-commerce\b/i,
    /\bwebsite\s+bán\s+hàng\b/i,
  ];
  if (productPatterns.some(p => p.test(text))) return 'PRODUCT_BUILD';
  // Also treat requests with multiple commerce features (cart + payment/qr/sepay) as PRODUCT_BUILD
  const commerceFeatureCount = [
    /\b(?:giỏ\s*hàng|cart)\b/i,
    /\b(?:thanh\s*toán|payment|checkout)\b/i,
    /\bqr\s*(?:code)?\b/i,
    /\bsepay\b/i
  ].filter(p => p.test(text)).length;
  if (commerceFeatureCount >= 2 && /\b(?:website|web|shop|store|bán\s+hàng|ecommerce|e-commerce)\b/i.test(text)) return 'PRODUCT_BUILD';

  // FULLSTACK_FEATURE — both backend and frontend keywords present
  const hasBackend = /\b(?:api|endpoint|server\s+side|backend|database|schema|route|controller|service|middleware|repository)\b/i.test(text);
  const hasFrontend = /\b(?:ui|frontend|component|page|layout|landing\s+page|homepage|hero|theme|css|tailwind|responsive|navigation)\b/i.test(text);
  if (hasBackend && hasFrontend) return 'FULLSTACK_FEATURE';

  // BACKEND_FEATURE — API/server keywords without frontend keywords
  if (hasBackend) return 'BACKEND_FEATURE';

  // UI_BUILD — explicit UI/page/component keywords
  const uiPatterns = [
    /\b(?:create|build|design|implement|develop|redesign)\b[\s\S]{0,80}\b(?:ui|frontend|page|component|screen|dashboard|admin\s+page|layout|form|card|button|navbar|navigation|css|tailwind|responsive|theme)\b/i,
    /\blanding\s+page\b/, /\bhomepage\b/, /\bhero\b/,
    /\bdashboard\b/, /\badmin\s+page\b/,
    /\.(?:jsx|tsx|css|scss)\b/,
    /\bReact\s+page\b/, /\bVue\s+page\b/,
    /\bFlutter\s+page\b/, /\bTailwind\b/,
    /\bresponsive\b/, /\btheme\b/,
    /\bnavigation\b/,
    /\bmarketing\s+page\b/,
  ];
  if (uiPatterns.some(p => p.test(text))) return 'UI_BUILD';

  // Default: passthrough taskType for non-specific CODING tasks
  return taskType;
}

export function buildAcceptanceCriteria(prompt = "") {
  const objective = String(prompt || "").trim();
  const taskType = classifyTaskType(objective);
  const taskClass = classifyTaskClass(objective, taskType);
  const matchedKeywords = findMatchedKeywords(objective, taskClass);
  console.log('[TASK_CLASSIFIER]', {
    prompt: objective.substring(0, 120),
    taskClass,
    taskType,
    confidence: taskClass !== taskType ? 'high' : 'low',
    matchedKeywords
  });

  const requestedFeatures = Object.entries(FEATURE_PATTERNS)
    .filter(([, pattern]) => pattern.test(objective))
    .map(([feature]) => feature);
  const isProductBuild = taskClass === 'PRODUCT_BUILD';
  const isUIBuild = taskClass === 'UI_BUILD';

  const requiresWorkspaceChange = taskType === "CODING";
  const requiresValidationCommand = taskType === "CODING";
  const requiresFileRead = taskType === "ANALYSIS" || taskType === "SEARCH";
  const requiresSearchResult = taskType === "SEARCH";

  // New: Extract explicitly requested files from prompt
  const requestedFiles = (() => {
    const files = new Set();
    const text = objective;
    const isScriptInstruction = /\b(?:add|set|update|modify|change)\s+(?:npm\s+)?script\b/i.test(text);
    const FILE_RX = /\b([A-Za-z0-9_./\\-]+\.(?:json|js|jsx|mjs|cjs|ts|tsx|css|scss|html|md|txt|yml|yaml))\b/gi;
    let m;
    while ((m = FILE_RX.exec(text)) !== null) {
      const fp = m[1]
        .replace(/\\\\/g, "/")
        .replace(/\\/g, "/")
        .replace(/^\.\//, "");
      // Script values like "node src/app.js" should not be promoted to workspace file targets.
      // Those are validation/runtime commands, not files the planner should edit.
      if (isScriptInstruction && /[\\/]/.test(fp) && !/(^|\/)package\.json$/i.test(fp)) {
        continue;
      }
      files.add(fp);
    }
    return [...files];
  })();
  const requestedFileDetails = classifyRequestedFiles(objective, requestedFiles);

  // New: taskMode classification (qa | read_only | coding)
  const qaSignals = [
    /\breply\s+only\b/i,
    /\bexactly\s+one\s+line\b/i,
    /\bonly\s+the\s+number\b/i,
    /\bjust\s+(?:say|answer|reply)\b/i
  ];
  const saysDoNotModify = CLEAR_READ_ONLY_PATTERN.test(objective);
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
    taskClass: taskClass.toLowerCase(),
    taskMode,
    requestedFiles,
    requestedFileDetails,
    requestedFeatures,
    requiresWorkspaceChange,
    requiresValidationCommand,
    requiresFileRead,
    requiresSearchResult,
    requiresExistingStackInspection: isProductBuild,
    requiresPackageJsonInspection: isProductBuild || isUIBuild,
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

