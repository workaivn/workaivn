import { EXECUTION_ALLOWED_TOOLS } from "./types.js";
import { unique } from "./utils.js";
import { validateTaskGraph } from "./taskGraph.js";

export function validateExecutionPlan(plan = {}) {
  const graph = { nodes: Array.isArray(plan.tasks) ? plan.tasks : [] };
  const graphValidation = validateTaskGraph(graph);
  const errors = [...graphValidation.errors];

  for (const task of graph.nodes) {
    if (task?.tool && !EXECUTION_ALLOWED_TOOLS.includes(String(task.tool).toUpperCase())) {
      errors.push({ type: "invalid_tool", taskId: task.id, tool: task.tool });
    }
    if (!task?.kind) {
      errors.push({ type: "missing_kind", taskId: task?.id || null });
    }
  }

  return {
    valid: errors.length === 0,
    errors: unique(errors.map(error => JSON.stringify(error))).map(text => JSON.parse(text))
  };
}

export { validateTaskGraph } from "./taskGraph.js";
