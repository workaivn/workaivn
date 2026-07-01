import { inferPrimaryConcepts, pascalize, unique } from "../../agent/projectIntelligence/inference.js";

export function planDataModels(productType, prompt = "") {
  const concepts = inferPrimaryConcepts(prompt, {}, null, null, null);
  const lower = String(prompt || "").toLowerCase();
  const inferred = [];

  if (/\bapi\b|\bserver\b|\bbackend\b/.test(lower)) inferred.push("Request", "Response", "Endpoint");
  if (/\bcrm\b|\bcustomer\b|\bcontact\b/.test(lower)) inferred.push("Customer", "Contact", "Activity");
  if (/\berp\b|\binventory\b|\border\b|\bwarehouse\b/.test(lower)) inferred.push("Inventory", "Order", "Warehouse");
  if (/\bblog\b|\bnews\b/.test(lower)) inferred.push("Article", "Category", "Author");
  if (/\bsaas\b|\bdashboard\b|\badmin\b/.test(lower)) inferred.push("User", "Workspace", "Permission");

  return unique([...concepts.slice(0, 4), ...inferred].map(value => pascalize(value)).filter(Boolean));
}
