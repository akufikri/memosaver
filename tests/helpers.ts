import { Database } from '../src/storage/database.js';
import { migrate } from '../src/storage/migrations.js';
import { MemoryRepository } from '../src/storage/repositories/memory-repository.js';
import { MemoryEngine } from '../src/memory/memory-engine.js';
import { MemoSaverService } from '../src/service/memosaver-service.js';
import { defaultConfig } from '../src/util/config.js';
import { Logger } from '../src/util/logger.js';

export interface TestApp {
  db: Database;
  service: MemoSaverService;
  engine: MemoryEngine;
  logger: Logger;
  config: ReturnType<typeof defaultConfig>;
}

/** Build an isolated in-memory app with a temp project dir. */
export function createTestApp(overrides?: { minImportance?: number; maxTokens?: number }): TestApp {
  const db = Database.memory();
  migrate(db);
  const config = defaultConfig();
  const logger = new Logger({ file: false, level: 'error' });
  const memoryRepo = new MemoryRepository(db);
  const engine = new MemoryEngine(memoryRepo, {
    minImportance: overrides?.minImportance ?? config.memory.min_importance,
    maxContentLength: config.memory.max_content_length,
    bufferSize: config.memory.buffer_size
  });
  const service = new MemoSaverService(db, engine, config, logger);
  return { db, service, engine, logger, config };
}

/** Temp project directory unique per call. */
export function tempProjectPath(label: string): string {
  return `/tmp/memosaver-test-${label}-${Date.now()}`;
}

export function contentOf(result: { content?: { type: string; text?: string }[] } | undefined): unknown {
  const text = result?.content?.[0]?.text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}