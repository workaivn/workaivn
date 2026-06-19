/**
 * PromptNormalizer - Rule-based prompt normalization
 * Transforms raw user input into structured prompts optimized for agents
 */

/**
 * Normalize prompt based on task type
 * @param {string} inputPrompt - Raw prompt from user
 * @param {string} taskType - Type of task (build_feature, fix_bug, refactor, etc.)
 * @returns {string} - Normalized prompt
 */
export function normalizePrompt(inputPrompt, taskType = "default") {
  let normalized = inputPrompt.trim();

  // Remove extra whitespace
  normalized = normalized.replace(/\s+/g, " ");

  // Apply task-specific normalization
  switch (taskType) {
    case "build_feature":
      normalized = normalizeBuildFeature(normalized);
      break;

    case "fix_bug":
      normalized = normalizeBugFix(normalized);
      break;

    case "refactor":
      normalized = normalizeRefactor(normalized);
      break;

    case "review":
      normalized = normalizeCodeReview(normalized);
      break;

    case "documentation":
      normalized = normalizeDocumentation(normalized);
      break;

    case "phase_plan":
      normalized = normalizePhasePlan(normalized);
      break;

    default:
      normalized = normalizeDefault(normalized);
  }

  return normalized;
}

/**
 * Normalize "Build Feature" prompts
 */
function normalizeBuildFeature(prompt) {
  let normalized = prompt;

  // Add required sections if missing
  if (!prompt.includes("requirements")) {
    normalized = `Build Feature Requirements:\n${normalized}`;
  }

  if (!prompt.includes("API") && !prompt.includes("endpoint")) {
    normalized += "\nInclude API endpoints if applicable.";
  }

  if (!prompt.includes("test") && !prompt.includes("unit")) {
    normalized += "\nInclude test cases or suggestions.";
  }

  return normalized;
}

/**
 * Normalize "Fix Bug" prompts
 */
function normalizeBugFix(prompt) {
  let normalized = prompt;

  // Add diagnostic context
  if (!prompt.includes("error") && !prompt.includes("bug")) {
    normalized = `Bug Report: ${normalized}`;
  }

  if (!prompt.includes("reproduce") && !prompt.includes("steps")) {
    normalized += "\nProvide steps to reproduce if known.";
  }

  if (!prompt.includes("expected") || !prompt.includes("actual")) {
    normalized += "\nClarify expected vs actual behavior.";
  }

  return normalized;
}

/**
 * Normalize "Refactor" prompts
 */
function normalizeRefactor(prompt) {
  let normalized = prompt;

  if (!prompt.includes("goal") && !prompt.includes("improve")) {
    normalized = `Refactor Goal: ${normalized}`;
  }

  if (!prompt.includes("pattern") && !prompt.includes("style")) {
    normalized += "\nMaintain consistent coding patterns and style.";
  }

  if (!prompt.includes("backward") && !prompt.includes("compatibility")) {
    normalized += "\nEnsure backward compatibility if refactoring APIs.";
  }

  return normalized;
}

/**
 * Normalize "Code Review" prompts
 */
function normalizeCodeReview(prompt) {
  let normalized = prompt;

  if (!prompt.includes("review") && !prompt.includes("check")) {
    normalized = `Code Review: ${normalized}`;
  }

  if (!prompt.includes("best practices") && !prompt.includes("standards")) {
    normalized += "\nCheck against best practices and coding standards.";
  }

  if (!prompt.includes("security") && !prompt.includes("vulnerability")) {
    normalized += "\nFlag any potential security concerns.";
  }

  if (!prompt.includes("performance")) {
    normalized += "\nSuggest performance improvements where applicable.";
  }

  return normalized;
}

/**
 * Normalize "Documentation" prompts
 */
function normalizeDocumentation(prompt) {
  let normalized = prompt;

  if (!prompt.includes("document") && !prompt.includes("comment")) {
    normalized = `Documentation Task: ${normalized}`;
  }

  if (!prompt.includes("format") && !prompt.includes("markdown")) {
    normalized += "\nUse clear markdown formatting.";
  }

  if (!prompt.includes("example")) {
    normalized += "\nInclude usage examples if applicable.";
  }

  if (!prompt.includes("API") && !prompt.includes("parameter")) {
    normalized += "\nDocument all API parameters and return values.";
  }

  return normalized;
}

/**
 * Normalize "Phase Plan" prompts
 */
function normalizePhasePlan(prompt) {
  let normalized = prompt;

  if (!prompt.includes("phase") && !prompt.includes("plan")) {
    normalized = `Project Plan: ${normalized}`;
  }

  if (!prompt.includes("phase") || !prompt.includes("step")) {
    normalized += "\nBreak down into clear phases with deliverables.";
  }

  if (!prompt.includes("timeline") && !prompt.includes("estimate")) {
    normalized += "\nProvide time estimates for each phase.";
  }

  if (!prompt.includes("dependency") && !prompt.includes("prerequisite")) {
    normalized += "\nIdentify dependencies between phases.";
  }

  if (!prompt.includes("test")) {
    normalized += "\nInclude testing/validation for each phase.";
  }

  return normalized;
}

/**
 * Default normalization
 */
function normalizeDefault(prompt) {
  let normalized = prompt;

  if (normalized.length > 5000) {
    normalized = normalized.substring(0, 5000) + "...";
  }

  return normalized;
}

/**
 * Extract variables from template
 * @param {string} template - Template string with {{variable}} placeholders
 * @returns {Array<string>} - List of variable names
 */
export function extractTemplateVariables(template) {
  const regex = /\{\{(\w+)\}\}/g;
  const variables = [];
  let match;

  while ((match = regex.exec(template)) !== null) {
    if (!variables.includes(match[1])) {
      variables.push(match[1]);
    }
  }

  return variables;
}

/**
 * Fill template with variables
 * @param {string} template - Template with {{variable}} placeholders
 * @param {Object} variables - Object with variable values
 * @returns {string} - Filled template
 */
export function fillTemplate(template, variables = {}) {
  let result = template;

  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    result = result.replace(regex, value || "");
  }

  return result;
}
