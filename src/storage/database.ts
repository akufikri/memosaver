import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { DatabaseError } from '../util/errors.js';

/**
 * node:sqlite is loaded via createRequire so bundler/vite SSR transforms (used
 * by the test runner) treat it as a runtime builtin instead of trying to
 * resolve a bare "sqlite" package.
 */
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

export class Database {
  readonly raw: DatabaseSyncType;

  constructor(db: DatabaseSyncType) {
    this.raw = db;
  }

  static open(path: string): Database {
    try {
      const raw = new DatabaseSync(path);
      raw.exec('PRAGMA journal_mode = WAL;');
      raw.exec('PRAGMA foreign_keys = ON;');
      raw.exec('PRAGMA busy_timeout = 5000;');
      return new Database(raw);
    } catch (err) {
      throw new DatabaseError(`failed to open sqlite database at ${path}`, err);
    }
  }

  static memory(): Database {
    return Database.open(':memory:');
  }

  /** Run fn inside a transaction. Rolls back on throw; commits otherwise. */
  transaction<T>(fn: () => T): T {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.raw.exec('ROLLBACK');
      } catch {
        // connection broken; nothing to roll back
      }
      throw err;
    }
  }

  close(): void {
    try {
      this.raw.close();
    } catch {
      // already closed
    }
  }
}