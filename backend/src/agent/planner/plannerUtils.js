import crypto from 'node:crypto';

export function generateId() {
  return crypto.randomUUID();
}

export function getTimestamp() {
  return Date.now();
}
