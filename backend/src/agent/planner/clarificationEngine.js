const FILE_PATH_RX = /\b(?:[A-Za-z]:\\|\.{1,2}[\\/]|[A-Za-z0-9_.-]+[\\/])?[A-Za-z0-9_.-]+\.(?:js|jsx|ts|tsx|mjs|cjs|json|css|scss|html|md|txt|yml|yaml)\b/i;
const COMMAND_RX = /\b(?:npm|node|npx|pnpm|yarn|bun|pytest|go\s+test|cargo)\b/i;
const VAGUE_RX = /^(?:fix|update|improve|repair)\s+it\b/i;
const DEPLOY_RX = /\bdeploy\b/i;
const DEPLOY_TARGET_RX = /\b(?:production|prod|staging|dev|development|localhost|render|vercel|railway|docker|server|cloud)\b/i;

export function analyzeClarification(prompt) {
  const text = String(prompt || "").trim();
  if (!text) {
    return {
      needsClarification: true,
      confidence: 1,
      reason: "Empty prompt requires clarification"
    };
  }

  if (VAGUE_RX.test(text)) {
    return {
      needsClarification: true,
      confidence: 0.95,
      reason: "Prompt is too vague to act on safely"
    };
  }

  if (DEPLOY_RX.test(text) && !DEPLOY_TARGET_RX.test(text)) {
    return {
      needsClarification: true,
      confidence: 0.9,
      reason: "Deploy target or environment is missing"
    };
  }

  if (/^read\s+package\.json\b/i.test(text)) {
    return {
      needsClarification: false,
      confidence: 0.99,
      reason: "Clear read task"
    };
  }

  if (/^run\s+npm\s+test\b/i.test(text)) {
    return {
      needsClarification: false,
      confidence: 0.99,
      reason: "Clear command task"
    };
  }

  if (FILE_PATH_RX.test(text) || COMMAND_RX.test(text)) {
    return {
      needsClarification: false,
      confidence: 0.9,
      reason: "Concrete target detected"
    };
  }

  if (/\b(?:create|build|implement|make|add|update|modify|edit|replace)\b/i.test(text)) {
    return {
      needsClarification: false,
      confidence: 0.85,
      reason: "Actionable task with concrete intent"
    };
  }

  return {
    needsClarification: true,
    confidence: 0.75,
    reason: "Prompt lacks a concrete target"
  };
}
