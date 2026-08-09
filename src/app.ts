import { Database } from './storage/database.js';
import { migrate, currentSchemaVersion } from './storage/migrations.js';
import { MemoryRepository } from './storage/repositories/memory-repository.js';
import { MemoryEngine } from './memory/memory-engine.js';
import { RuleBasedExtractor } from './memory/extractor.js';
import { composeExtractor } from './memory/llm-extractor.js';
import { MemoSaverService } from './service/memosaver-service.js';
import { loadConfig, ensureHomeDir, type NormalizedConfig } from './util/config.js';
import { initLogger, type Logger } from './util/logger.js';

export interface AppCore {
  config: NormalizedConfig;
  logger: Logger;
  db: Database;
  service: MemoSaverService;
}

/**
 * Assemble the full application: config, logger, database, migrations,
 * memory engine and the application service shared by MCP and CLI.
 */
export function createApp(): AppCore {
  const config = loadConfig();
  ensureHomeDir(config);

  const logger = initLogger({
    level: config.logger.level,
    file: config.logger.file,
    logPath: config.logPath
  });

  const db = Database.open(config.dbPath);
  migrate(db);

  const memoryRepo = new MemoryRepository(db);
  const ruleBased = new RuleBasedExtractor({
    minImportance: config.memory.min_importance,
    maxContentLength: config.memory.max_content_length
  });
  const engine = new MemoryEngine(memoryRepo, {
    minImportance: config.memory.min_importance,
    maxContentLength: config.memory.max_content_length,
    bufferSize: config.memory.buffer_size,
    debounceMs: config.memory.debounce_ms
  }, composeExtractor(ruleBased, config.memory.llm));

  const service = new MemoSaverService(db, engine, config, logger);
  logger.info('memosaver ready', {
    db: config.dbPath,
    schemaVersion: currentSchemaVersion(db)
  });

  return { config, logger, db, service };
}