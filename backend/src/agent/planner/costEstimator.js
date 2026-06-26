export const CostCategory = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  VERY_HIGH: 'VERY_HIGH'
});

const CATEGORY_VALUE = Object.freeze({
  [CostCategory.LOW]: 1,
  [CostCategory.MEDIUM]: 3,
  [CostCategory.HIGH]: 5,
  [CostCategory.VERY_HIGH]: 7
});

const TOOL_ESTIMATES = Object.freeze({
  READ_FILE: Object.freeze({
    time: CostCategory.LOW,
    tokens: CostCategory.LOW,
    io: CostCategory.LOW,
    cpu: CostCategory.LOW,
    memory: CostCategory.LOW,
    risk: CostCategory.LOW
  }),
  APPLY_PATCH: Object.freeze({
    time: CostCategory.MEDIUM,
    tokens: CostCategory.MEDIUM,
    io: CostCategory.LOW,
    cpu: CostCategory.LOW,
    memory: CostCategory.MEDIUM,
    risk: CostCategory.MEDIUM
  }),
  WRITE_FILE: Object.freeze({
    time: CostCategory.MEDIUM,
    tokens: CostCategory.MEDIUM,
    io: CostCategory.LOW,
    cpu: CostCategory.LOW,
    memory: CostCategory.MEDIUM,
    risk: CostCategory.MEDIUM
  }),
  RUN_TERMINAL: Object.freeze({
    time: CostCategory.HIGH,
    tokens: CostCategory.HIGH,
    io: CostCategory.MEDIUM,
    cpu: CostCategory.HIGH,
    memory: CostCategory.HIGH,
    risk: CostCategory.HIGH
  }),
  LIST_FILES: Object.freeze({
    time: CostCategory.LOW,
    tokens: CostCategory.LOW,
    io: CostCategory.LOW,
    cpu: CostCategory.LOW,
    memory: CostCategory.LOW,
    risk: CostCategory.LOW
  }),
  SEARCH_CODE: Object.freeze({
    time: CostCategory.LOW,
    tokens: CostCategory.LOW,
    io: CostCategory.LOW,
    cpu: CostCategory.LOW,
    memory: CostCategory.LOW,
    risk: CostCategory.LOW
  }),
  VALIDATE_PATCH: Object.freeze({
    time: CostCategory.MEDIUM,
    tokens: CostCategory.MEDIUM,
    io: CostCategory.LOW,
    cpu: CostCategory.LOW,
    memory: CostCategory.LOW,
    risk: CostCategory.MEDIUM
  }),
  CODING: Object.freeze({
    time: CostCategory.MEDIUM,
    tokens: CostCategory.HIGH,
    io: CostCategory.LOW,
    cpu: CostCategory.LOW,
    memory: CostCategory.MEDIUM,
    risk: CostCategory.MEDIUM
  })
});

export function getDefaultEstimates(tool) {
  const estimates = TOOL_ESTIMATES[tool] || TOOL_ESTIMATES.CODING;
  return { ...estimates };
}

export function calculateCost(estimates) {
  const time = CATEGORY_VALUE[estimates.time] || 1;
  const cpu = CATEGORY_VALUE[estimates.cpu] || 1;
  const risk = CATEGORY_VALUE[estimates.risk] || 1;
  const score = time + cpu + risk;
  const category = scoreToCategory(score);
  return { score, category };
}

export function estimateForTool(tool) {
  const estimates = getDefaultEstimates(tool);
  const { score, category } = calculateCost(estimates);
  return { estimates, score, category };
}

export function costBreakdown(estimates) {
  const { score, category } = calculateCost(estimates);
  return {
    time: estimates.time,
    tokens: estimates.tokens,
    io: estimates.io,
    cpu: estimates.cpu,
    memory: estimates.memory,
    risk: estimates.risk,
    score,
    category
  };
}

function scoreToCategory(score) {
  if (score <= 3) return CostCategory.LOW;
  if (score <= 7) return CostCategory.MEDIUM;
  if (score <= 11) return CostCategory.HIGH;
  return CostCategory.VERY_HIGH;
}
