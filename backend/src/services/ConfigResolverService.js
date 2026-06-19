/**
 * ConfigResolverService
 * Priority: DB → process.env → defaultValue
 */
import SystemSetting from "../models/SystemSetting.js";

let _cache = null;
let _cacheAt = 0;
const CACHE_TTL = 60_000; // 1 minute

async function loadAll() {
  const now = Date.now();
  if (_cache && now - _cacheAt < CACHE_TTL) return _cache;

  try {
    const rows = await SystemSetting.find({});
    _cache = {};
    for (const row of rows) {
      _cache[row.key] = row.value;
    }
    _cacheAt = now;
  } catch {
    _cache = _cache || {};
  }

  return _cache;
}

export function invalidateCache() {
  _cache = null;
  _cacheAt = 0;
}

export async function get(key, fallback = "") {
  const map = await loadAll();
  if (map[key] !== undefined && map[key] !== "") return map[key];
  if (process.env[key] !== undefined) return process.env[key];
  return fallback;
}

export async function getBool(key, fallback = false) {
  const v = await get(key, String(fallback));
  return v === "true" || v === "1" || v === true;
}

export async function getNumber(key, fallback = 0) {
  const v = await get(key, String(fallback));
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

export default { get, getBool, getNumber, invalidateCache };
