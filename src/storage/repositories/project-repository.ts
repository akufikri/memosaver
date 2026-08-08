import { Database } from '../database.js';
import type { Project } from '../../types.js';

function toProject(row: Record<string, unknown>): Project {
  return {
    id: String(row.id),
    name: String(row.name),
    path: String(row.path),
    path_hash: String(row.path_hash),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    last_session_id: row.last_session_id ? String(row.last_session_id) : null
  };
}

export class ProjectRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  findByHash(pathHash: string): Project | null {
    const row = this.db.raw
      .prepare('SELECT * FROM projects WHERE path_hash = ?')
      .get(pathHash) as Record<string, unknown> | undefined;
    return row ? toProject(row) : null;
  }

  get(id: string): Project | null {
    const row = this.db.raw
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? toProject(row) : null;
  }

  create(project: Project): Project {
    this.db.raw
      .prepare(
        `INSERT INTO projects (id, name, path, path_hash, created_at, updated_at, last_session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        project.id,
        project.name,
        project.path,
        project.path_hash,
        project.created_at,
        project.updated_at,
        project.last_session_id
      );
    return project;
  }

  upsert(project: Project): Project {
    const existing = this.findByHash(project.path_hash);
    if (!existing) return this.create(project);
    this.db.raw
      .prepare('UPDATE projects SET name = ?, path = ?, updated_at = ? WHERE id = ?')
      .run(project.name, project.path, project.updated_at, existing.id);
    return { ...existing, name: project.name, path: project.path, updated_at: project.updated_at };
  }

  setLastSession(id: string, sessionId: string | null): void {
    this.db.raw
      .prepare('UPDATE projects SET last_session_id = ?, updated_at = ? WHERE id = ?')
      .run(sessionId, Date.now(), id);
  }

  touch(id: string): void {
    this.db.raw.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(Date.now(), id);
  }

  list(): Project[] {
    const rows = this.db.raw.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as Record<
      string,
      unknown
    >[];
    return rows.map(toProject);
  }
}