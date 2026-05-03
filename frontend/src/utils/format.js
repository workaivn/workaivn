export function formatLimit(limit){
  if (!limit || limit <= 0) return 0;

  if (limit >= 999999) {
    return "∞";
  }

  return limit;
}