import crypto from "node:crypto";

export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

export function unique(values = []) {
  return [...new Set(toArray(values).filter(Boolean))];
}

export function toPosix(value = "") {
  return String(value || "").replace(/\\/g, "/").trim();
}

export function normalizePath(value = "") {
  return toPosix(value).toLowerCase();
}

export function makeId(prefix = "task") {
  return `${prefix}:${crypto.randomUUID()}`;
}

export function collectPathLike(record = {}) {
  return toPosix(record.path || record.targetPath || record.file || record.entryPoint || record.sourcePath || record.name || "");
}

export function hasTerminalStatus(status = "") {
  return ["DONE", "FAILED", "BLOCKED", "SKIPPED"].includes(String(status || "").toUpperCase());
}

export function scoreToConfidence(score = 0) {
  if (score >= 0.9) return 0.95;
  if (score >= 0.75) return 0.85;
  if (score >= 0.5) return 0.7;
  return 0.55;
}
