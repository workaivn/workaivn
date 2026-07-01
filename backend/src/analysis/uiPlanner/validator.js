function validateUIPlan(plan = {}) {
  const issues = [];
  const pages = Array.isArray(plan.pages) ? plan.pages : [];
  for (const page of pages) {
    if (!page.id) issues.push({ type: "missing_page_id", page });
    if (!page.path) issues.push({ type: "missing_page_path", page });
  }
  return {
    ok: issues.length === 0,
    issues
  };
}

export { validateUIPlan };

