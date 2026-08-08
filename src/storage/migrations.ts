import { Database } from './database.js';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
CREATE TABLE projects (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  path            TEXT NOT NULL UNIQUE,
  path_hash       TEXT NOT NULL UNIQUE,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  last_session_id TEXT
);

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent         TEXT NOT NULL,
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  status        TEXT NOT NULL DEFAULT 'active',
  summary       TEXT,
  goal          TEXT,
  current_task  TEXT,
  next_action   TEXT
);

CREATE INDEX idx_sessions_project ON sessions(project_id, started_at DESC);

CREATE TABLE memories (
  rowid      INTEGER PRIMARY KEY AUTOINCREMENT,
  id         TEXT UNIQUE NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  type       TEXT NOT NULL,
  content    TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0.5,
  metadata   TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_memories_project ON memories(project_id, importance DESC);
CREATE INDEX idx_memories_session ON memories(session_id, created_at);

CREATE TABLE checkpoints (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  goal          TEXT,
  current_state TEXT,
  completed     TEXT,
  pending       TEXT,
  blockers      TEXT,
  next_action   TEXT,
  created_at    INTEGER NOT NULL
);

CREATE INDEX idx_checkpoints_session ON checkpoints(session_id, created_at DESC);

CREATE VIRTUAL TABLE memories_fts USING fts5(
  content,
  content='memories',
  content_rowid='rowid',
  tokenize='porter'
);

CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;
CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
  INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;
`
  }
];

export function migrate(db: Database): void {
  db.raw.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  );`);

  const applied = new Set(
    db.raw
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((r: Record<string, unknown>) => Number(r.version ?? 0))
  );

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      db.raw.exec(migration.sql);
      db.raw
        .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, Date.now());
    });
  }
}

export function getMigrations(): Migration[] {
  return migrations;
}

export function currentSchemaVersion(db: Database): number {
  const row = db.raw
    .prepare('SELECT MAX(version) AS v FROM schema_migrations')
    .get() as { v: number | null };
  return row.v ?? 0;
}