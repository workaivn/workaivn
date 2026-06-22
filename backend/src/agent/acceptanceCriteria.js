const FEATURE_PATTERNS = {
  website: /\bwebsite\b|trang\s*web|tạo\s*web/i,
  app: /\bapp\b|ứng\s*dụng|application/i,
  cart: /giỏ\s*hàng|\bcart\b|shopping\s*cart/i,
  payment: /thanh\s*toán|\bpayment\b|checkout/i,
  qr: /\bqr\b|qr\s*code|mã\s*qr/i,
  sepay: /\bsepay\b/i
};

export function buildAcceptanceCriteria(prompt = "") {
  const objective = String(prompt || "").trim();
  const requestedFeatures = Object.entries(FEATURE_PATTERNS)
    .filter(([, pattern]) => pattern.test(objective))
    .map(([feature]) => feature);
  const isProductBuild = requestedFeatures.some(feature =>
    ["website", "app", "cart", "payment", "qr", "sepay"].includes(feature)
  );

  return {
    objective,
    taskClass: isProductBuild ? "product_build" : "coding",
    requestedFeatures,
    requiresWorkspaceChange: true,
    requiresExistingStackInspection: isProductBuild,
    requiresPackageJsonInspection: isProductBuild,
    requiresValidationCommand: true,
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
    `- Persist real workspace changes: ${criteria.requiresWorkspaceChange ? "required" : "optional"}`,
    `- Run a validation command: ${criteria.requiresValidationCommand ? "required" : "optional"}`
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

