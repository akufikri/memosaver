export class MemoSaverError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'MemoSaverError';
    this.code = code;
  }
}

export class InvalidInputError extends MemoSaverError {
  constructor(message: string) {
    super('INVALID_INPUT', message);
  }
}

export class NotFoundError extends MemoSaverError {
  constructor(message: string) {
    super('NOT_FOUND', message);
  }
}

export class DatabaseError extends MemoSaverError {
  constructor(message: string, cause?: unknown) {
    super('DATABASE_ERROR', `${message}${cause instanceof Error ? `: ${cause.message}` : ''}`);
  }
}

export class ConfigError extends MemoSaverError {
  constructor(message: string) {
    super('CONFIG_ERROR', message);
  }
}