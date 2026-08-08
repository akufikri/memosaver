import { createHash, randomUUID } from 'node:crypto';

/** Deterministic hex hash of a normalized absolute path. */
export function hashPath(path: string): string {
  return createHash('sha256').update(path).digest('hex');
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function now(): number {
  return Date.now();
}