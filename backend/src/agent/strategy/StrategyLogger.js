export function logStrategy(eventName, payload = {}) {
  console.log(`[${eventName}]`, payload);
}
