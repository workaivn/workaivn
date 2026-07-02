function normalize(value = "") {
  return String(value || "").replace(/\\/g, "/").trim();
}

function normalizeLower(value = "") {
  return normalize(value).toLowerCase();
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
}

function pascalize(value = "") {
  return String(value || "")
    .replace(/[_/.-]+/g, " ")
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

function slugify(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const STOP_WORDS = new Set([
  "a", "an", "and", "app", "build", "create", "dashboard", "design", "do", "feature",
  "for", "from", "generate", "get", "goal", "help", "if", "in", "interface", "landing",
  "make", "new", "page", "project", "react", "site", "the", "to", "with", "without"
]);

function tokenize(text = "") {
  return String(text || "")
    .replace(/["'`]/g, " ")
    .split(/[^a-zA-Z0-9]+/)
    .map(token => token.trim())
    .filter(Boolean);
}

function extractPromptConcepts(prompt = "") {
  const tokens = tokenize(prompt);
  const phrases = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index];
    if (!current || STOP_WORDS.has(current.toLowerCase())) continue;
    const next = tokens[index + 1];
    if (next && !STOP_WORDS.has(next.toLowerCase())) {
      phrases.push(pascalize(`${current} ${next}`));
    }
    phrases.push(pascalize(current));
  }
  const explicitMatches = String(prompt || "").match(/[A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+)*/g) || [];
  return unique([
    ...explicitMatches.map(value => pascalize(value)),
    ...phrases
  ]).filter(Boolean);
}

function collectGraphConcepts(nodes = []) {
  return unique(
    (Array.isArray(nodes) ? nodes : [])
      .map(node => node?.name || node?.title || node?.label || node?.path || "")
      .map(value => pascalize(value))
      .filter(Boolean)
  );
}

function detectFrameworkHints(workspaceState = {}, prompt = "") {
  const lowerPrompt = normalizeLower(prompt);
  const scan = workspaceState?.scan || {};
  const packageJson = workspaceState?.packageJson || {};
  const dependencyNames = new Set([
    ...Object.keys(packageJson.dependencies || {}),
    ...Object.keys(packageJson.devDependencies || {}),
    ...Object.keys(packageJson.peerDependencies || {})
  ].map(name => normalizeLower(name)));

  const hints = new Set();
  if (scan.projectType) hints.add(String(scan.projectType));
  if (workspaceState.hasNext) hints.add("next");
  if (workspaceState.hasReactVite) hints.add("react-vite");
  if (workspaceState.hasNodeExpress) hints.add("node-express");
  if (workspaceState.hasIndexPhp || workspaceState.hasLaravel) hints.add("php");
  if (workspaceState.hasCsproj) hints.add("aspnet");
  if (workspaceState.hasFastapi) hints.add("python");
  if (workspaceState.hasFlask) hints.add("python");
  if (workspaceState.hasFlutter) hints.add("flutter");
  if (workspaceState.hasStaticHtml) hints.add("static-html");

  if (dependencyNames.has("next")) hints.add("next");
  if (dependencyNames.has("react") || dependencyNames.has("react-dom") || dependencyNames.has("vite")) hints.add("react-vite");
  if (dependencyNames.has("express")) hints.add("node-express");
  if (dependencyNames.has("laravel")) hints.add("php");

  if (/\bnext\.?js\b/.test(lowerPrompt)) hints.add("next");
  if (/\breact\s+vite\b/.test(lowerPrompt) || /\bvite\b/.test(lowerPrompt) || /\breact\b/.test(lowerPrompt)) hints.add("react-vite");
  if (/\bnode\s*[- ]?express\b/.test(lowerPrompt) || /\bexpress\b/.test(lowerPrompt)) hints.add("node-express");
  if (/\bphp\b/.test(lowerPrompt)) hints.add("php");
  if (/\basp\.?net\b|\baspnet\b|\b\.net\b/.test(lowerPrompt)) hints.add("aspnet");
  if (/\bfastapi\b|\bflask\b|\bpython\b/.test(lowerPrompt)) hints.add("python");
  if (/\bflutter\b/.test(lowerPrompt)) hints.add("flutter");
  if (/\bstatic\s+html\b|\bwithout\s+framework\b/.test(lowerPrompt)) hints.add("static-html");

  return [...hints];
}

function inferSurfaceType(prompt = "", workspaceState = {}, concepts = []) {
  const lowerPrompt = normalizeLower(prompt);
  if (workspaceState.hasCsproj) return "dotnet";
  if (workspaceState.hasIndexPhp || workspaceState.hasLaravel) return "php";
  if (workspaceState.hasFastapi || workspaceState.hasFlask) return "python";
  if (workspaceState.hasFlutter) return "flutter";
  if (workspaceState.hasNext) return "next";
  if (workspaceState.hasReactVite) return "react-vite";
  if (workspaceState.hasNodeExpress) return "node-express";
  if (workspaceState.hasStaticHtml) return "static-html";

  if (/\bapi\b|\bbackend\b|\bserver\b|\brest\b/.test(lowerPrompt)) return "node-express";
  if (/\bphp\b/.test(lowerPrompt)) return "php";
  if (/\basp\.?net\b|\baspnet\b|\b\.net\b/.test(lowerPrompt)) return "dotnet";
  if (/\bfastapi\b|\bflask\b|\bpython\b/.test(lowerPrompt)) return "python";
  if (/\bflutter\b/.test(lowerPrompt)) return "flutter";
  if (/\bstatic\s+html\b|\bwithout\s+framework\b/.test(lowerPrompt)) return "static-html";

  if (/\bdashboard\b|\badmin\b|\bcrm\b|\berp\b|\bportal\b/.test(lowerPrompt)) return "react-vite";
  if (concepts.some(concept => /dashboard|admin|portal|crm|erp/i.test(concept))) return "react-vite";
  return "static-html";
}

function inferPrimaryConcepts(prompt = "", workspaceState = {}, uiPlan = null, componentTree = null, dependencyGraph = null) {
  const prompts = extractPromptConcepts(prompt);
  const uiConcepts = unique([
    ...(Array.isArray(uiPlan?.pages) ? uiPlan.pages.map(page => page.title || page.name || page.route || "") : []),
    ...(Array.isArray(uiPlan?.layouts) ? uiPlan.layouts.map(layout => layout.name || layout.path || "") : []),
    ...(Array.isArray(uiPlan?.widgets) ? uiPlan.widgets.map(widget => widget.name || widget.path || widget.kind || "") : []),
    ...(Array.isArray(componentTree?.components) ? componentTree.components.map(node => node.name || node.path || "") : []),
    ...(Array.isArray(dependencyGraph?.nodes) ? dependencyGraph.nodes.map(node => node.name || node.path || "") : [])
  ].map(value => pascalize(value)).filter(Boolean));

  const existingSignals = [];
  if (workspaceState?.hasReactVite) existingSignals.push("ReactApp");
  if (workspaceState?.hasNext) existingSignals.push("NextApp");
  if (workspaceState?.hasNodeExpress) existingSignals.push("ApiServer");
  if (workspaceState?.hasIndexPhp || workspaceState?.hasLaravel) existingSignals.push("PhpApp");
  if (workspaceState?.hasCsproj) existingSignals.push("DotNetApp");
  if (workspaceState?.hasStaticHtml) existingSignals.push("StaticSite");

  return unique([...prompts, ...uiConcepts, ...existingSignals]).filter(Boolean);
}

function buildRoutesFromConcepts(concepts = [], workspaceState = {}) {
  const routes = [];
  const seen = new Set();
  const pushRoute = (title, route, entryPoint = null) => {
    const key = `${route}::${entryPoint || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    routes.push({ title, route, entryPoint });
  };

  if (workspaceState.hasIndexPhp) {
    pushRoute("Home", "/", "index.php");
    for (const concept of concepts.slice(0, 4)) {
      const route = `/${slugify(concept)}`;
      if (route === "/") continue;
      pushRoute(concept, route, `views/${slugify(concept)}.php`);
    }
    return routes;
  }

  if (workspaceState.hasNext) {
    pushRoute("Home", "/", "app/page.tsx");
    for (const concept of concepts.slice(0, 4)) {
      const route = `/${slugify(concept)}`;
      if (route === "/") continue;
      pushRoute(concept, route, `app/${slugify(concept)}/page.tsx`);
    }
    return routes;
  }

  if (workspaceState.hasReactVite || workspaceState.hasStaticHtml || concepts.length > 0) {
    const homeTitle = concepts[0] || "Home";
    pushRoute(homeTitle, "/", workspaceState.hasReactVite ? "src/App.tsx" : "index.html");
    for (const concept of concepts.slice(1, 5)) {
      const route = `/${slugify(concept)}`;
      if (route === "/") continue;
      pushRoute(concept, route, workspaceState.hasReactVite ? `src/pages/${slugify(concept)}.tsx` : `sections/${slugify(concept)}.html`);
    }
  }

  return routes;
}

function buildComponentConcepts(concepts = [], uiPlan = null, componentTree = null) {
  const fromUI = [
    ...(Array.isArray(uiPlan?.widgets) ? uiPlan.widgets.map(widget => widget.name || widget.kind || "") : []),
    ...(Array.isArray(uiPlan?.layouts) ? uiPlan.layouts.map(layout => layout.name || "") : []),
    ...(Array.isArray(componentTree?.components) ? componentTree.components.map(node => node.name || "") : [])
  ];
  return unique([...concepts, ...fromUI].map(value => pascalize(value)).filter(Boolean));
}

function buildModelConcepts(concepts = [], prompt = "") {
  const lower = normalizeLower(prompt);
  const suffixes = [];
  if (/\bapi\b|\bserver\b|\bbackend\b/.test(lower)) suffixes.push("Request", "Response", "Endpoint");
  if (/\bcrm\b|\bcustomer\b|\bcontact\b/.test(lower)) suffixes.push("Customer", "Contact", "Activity");
  if (/\berp\b|\binventory\b|\border\b|\bwarehouse\b/.test(lower)) suffixes.push("Item", "Order", "Stock");
  if (/\bblog\b|\bnews\b/.test(lower)) suffixes.push("Article", "Category", "Author");
  if (/\bsaas\b|\bdashboard\b|\badmin\b/.test(lower)) suffixes.push("User", "Workspace", "Permission");
  return unique([...concepts.slice(0, 4), ...suffixes].map(value => pascalize(value)).filter(Boolean));
}

function buildApiConcepts(concepts = [], prompt = "") {
  const lower = normalizeLower(prompt);
  const apiConcepts = [];
  if (/\bapi\b|\bserver\b|\bbackend\b/.test(lower)) apiConcepts.push("health", "status");
  for (const concept of concepts.slice(0, 4)) apiConcepts.push(slugify(concept));
  return unique(apiConcepts.filter(Boolean));
}

function buildTestConcepts(concepts = [], surfaces = []) {
  const items = [];
  for (const concept of concepts.slice(0, 6)) items.push(`renders ${concept}`);
  for (const surface of surfaces.slice(0, 4)) items.push(`supports ${surface}`);
  return unique(items);
}

export {
  buildApiConcepts,
  buildComponentConcepts,
  buildModelConcepts,
  buildRoutesFromConcepts,
  extractPromptConcepts,
  inferPrimaryConcepts,
  inferSurfaceType,
  normalize,
  normalizeLower,
  pascalize,
  slugify,
  unique
};
