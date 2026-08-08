import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { dirname } from 'node:path';
import { inspect } from 'node:util';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SECRET_PATTERNS = [
  /(api[_-]?key|secret|password|passwd|token|authorization|private[_-]?key)["'\s:=]+[^\s"',}]+/gi,
  /(sk-[A-Za-z0-9]{8,}|pk-[A-Za-z0-9]{8,}|gsk_[A-Za-z0-9]{8,})/g
];

export function redact(text: string): string {
  return text
    .replace(SECRET_PATTERNS[0]!, (_, key) => `${key}="[REDACTED]"`)
    .replace(SECRET_PATTERNS[1]!, '[REDACTED]');
}

interface LogRecord {
  ts: string;
  level: LogLevel;
  msg: string;
}

export class Logger {
  private readonly level: LogLevel;
  private readonly toFile: boolean;
  private stream: WriteStream | null = null;

  constructor(options: { level?: LogLevel; file?: boolean; logPath?: string } = {}) {
    this.level = options.level ?? 'info';
    this.toFile = options.file ?? true;
    if (this.toFile && options.logPath) {
      try {
        mkdirSync(dirname(options.logPath), { recursive: true });
        this.stream = createWriteStream(options.logPath, { flags: 'a' });
      } catch {
        this.stream = null;
      }
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.level];
  }

  private write(level: LogLevel, msg: string): void {
    if (!this.shouldLog(level)) return;
    const safe = redact(msg);
    const record: LogRecord = { ts: new Date().toISOString(), level, msg: safe };
    const line = JSON.stringify(record);
    // Logs go to stderr so stdout stays clean for CLI output and MCP JSON-RPC.
    process.stderr.write(`${line}\n`);
    if (this.stream) this.stream.write(`${line}\n`);
  }

  debug(msg: string, fields?: Record<string, unknown>): void {
    this.write('debug', fields ? `${msg} ${inspect(fields, { depth: 3 })}` : msg);
  }

  info(msg: string, fields?: Record<string, unknown>): void {
    this.write('info', fields ? `${msg} ${inspect(fields, { depth: 3 })}` : msg);
  }

  warn(msg: string, fields?: Record<string, unknown>): void {
    this.write('warn', fields ? `${msg} ${inspect(fields, { depth: 3 })}` : msg);
  }

  error(msg: string, fields?: Record<string, unknown>): void {
    this.write('error', fields ? `${msg} ${inspect(fields, { depth: 3 })}` : msg);
  }

  close(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }
}

let globalLogger: Logger | undefined;

export function initLogger(options: { level?: LogLevel; file?: boolean; logPath?: string } = {}): Logger {
  globalLogger = new Logger(options);
  return globalLogger;
}

export function getLogger(): Logger {
  if (!globalLogger) globalLogger = new Logger({ file: false });
  return globalLogger;
}