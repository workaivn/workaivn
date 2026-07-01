function isAbsoluteOrEscapingPath(targetPath = "") {
  const value = String(targetPath || "").replace(/\\/g, "/").trim();
  return /^([A-Za-z]:\/|\/)/.test(value) || value.includes("../");
}

export function validateBlueprint(blueprint = {}, workspaceContext = {}) {
  const issues = [];
  const pages = Array.isArray(blueprint.pages) ? blueprint.pages : [];
  const components = Array.isArray(blueprint.components) ? blueprint.components : [];
  const filePlan = Array.isArray(blueprint.filePlan) ? blueprint.filePlan : [];
  const scaffoldPlan = Array.isArray(blueprint.scaffoldPlan) ? blueprint.scaffoldPlan : [];
  const validation = blueprint.validation || {};
  const validationCommand = String(validation.command || blueprint.validationCommand || "").trim();
  const validationChecks = Array.isArray(validation.checks) ? validation.checks : [];

  if (pages.length === 0) issues.push({ type: "missing_pages" });
  if (components.length === 0) issues.push({ type: "missing_components" });
  if (!String(blueprint?.routes?.length ? blueprint.routes[0]?.route : blueprint?.entryPoint || "").trim()) {
    issues.push({ type: "missing_route_or_entry" });
  }
  if (!validationCommand && validationChecks.length === 0) {
    issues.push({ type: "missing_validation_command" });
  }
  if (filePlan.some(item => isAbsoluteOrEscapingPath(item.path))) {
    issues.push({ type: "invalid_absolute_path" });
  }
  if (scaffoldPlan.length === 0) issues.push({ type: "missing_scaffold_plan" });

  return {
    ok: issues.length === 0,
    issues
  };
}

