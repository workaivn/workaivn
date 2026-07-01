import { inferPrimaryConcepts, slugify, unique } from "../../agent/projectIntelligence/inference.js";

export function planApis(productType, dataModels = [], prompt = "") {
  const concepts = inferPrimaryConcepts(prompt, {}, null, null, null);
  const lower = String(prompt || "").toLowerCase();
  const routes = [];

  if (/\bapi\b|\bserver\b|\bbackend\b/.test(lower)) {
    routes.push("GET /health", "GET /status");
  }

  for (const concept of concepts.slice(0, 5)) {
    const route = `GET /${slugify(concept)}`;
    routes.push(route);
  }

  if (dataModels.length > 0) {
    routes.push(`CRUD /${slugify(dataModels[0])}`);
  }

  return unique(routes);
}
