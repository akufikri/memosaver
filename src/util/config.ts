import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import { ConfigError } from './errors.js';

const DEFAULT_DIR = '.memosaver';

const configSchema = z
  .object({
    /** absolute storage home, defaults to ~/.memosaver */
    home: z.string().optional(),
    logger: z
      .object({
        level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
        file: z.boolean().default(true)
      })
      .default({}),
    memory: z
      .object({
        /** minimum importance required to store extracted memory (0..1) */
        min_importance: z.number().min(0).max(1).default(0.3),
        /** buffer size before forced flush of activity events */
        buffer_size: z.number().int().positive().default(20),
        /** debounce window in ms */
        debounce_ms: z.number().int().nonnegative().default(8000),
        max_content_length: z.number().int().positive().default(20000),
        /** optional LLM-backed extractor. `provider` empty/absent keeps the local rule-based engine. */
        llm: z
          .object({
            provider: z.enum(['openai-compatible']).default('openai-compatible'),
            base_url: z.string().url().default('https://api.openai.com/v1'),
            model: z.string().default('gpt-4o-mini'),
            api_key: z.string().optional(),
            /** skip the LLM call when true (test/dev), always return null candidates */
            disabled: z.boolean().default(false)
          })
          .optional()
      })
      .default({}),
    resume: z
      .object({
        /** approximate max tokens for resume context */
        max_tokens: z.number().int().positive().default(4000),
        max_memories: z.number().int().positive().default(25)
      })
      .default({}),
    search: z
      .object({
        /** enable hybrid scoring (campaign after BM25) */
        hybrid: z.boolean().default(true),
        /** weight given to importance factor in hybrid ranking (0..1) */
        importance_weight: z.number().min(0).max(1).default(0.35)
      })
      .default({})
  })
  .passthrough();

export type MemoSaverConfig = z.infer<typeof configSchema>;

export interface NormalizedConfig extends MemoSaverConfig {
  homeDir: string;
  dbPath: string;
  logDir: string;
  logPath: string;
  configPath: string;
}

export function detectHomeDir(): string {
  const fromEnv = process.env['MEMOSAVER_HOME'];
  if (fromEnv) return resolve(fromEnv);
  return resolve(homedir(), DEFAULT_DIR);
}

export function defaultConfig(): MemoSaverConfig {
  return configSchema.parse({});
}

export function loadConfig(homeDir = detectHomeDir()): NormalizedConfig {
  const configPath = resolve(homeDir, 'config.json');
  let parsed: MemoSaverConfig = defaultConfig();
  if (existsSync(configPath)) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (err) {
      throw new ConfigError(`config.json is not valid JSON: ${(err as Error).message}`);
    }
    const result = configSchema.safeParse(raw);
    if (!result.success) {
      throw new ConfigError(`config.json is invalid: ${result.error.message}`);
    }
    parsed = result.data;
  }

  const normalized: NormalizedConfig = {
    ...parsed,
    homeDir,
    configPath,
    dbPath: resolve(homeDir, 'memosaver.db'),
    logDir: resolve(homeDir, 'logs'),
    logPath: resolve(homeDir, 'logs', 'memosaver.log')
  };
  return normalized;
}

export function ensureHomeDir(config: NormalizedConfig): void {
  try {
    mkdirSync(dirname(config.dbPath), { recursive: true });
    if (config.logger.file) mkdirSync(config.logDir, { recursive: true });
  } catch (err) {
    throw new ConfigError(`cannot create storage directory: ${(err as Error).message}`);
  }
}