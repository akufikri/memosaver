import { Database } from '../database.js';
import type { SQLInputValue } from 'node:sqlite';
import type { Memory, MemoryType } from '../../types.js';

function toMemory(row: Record<string, unknown>): Memory {
  let metadata: Record<string, unknown> = {};
  if (row.metadata != null && typeof row.metadata === 'string') {
    try {
      metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    } catch {
      metadata = {};
    }
  }
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    session_id: row.session_id != null ? String(row.session_id) : null,
    type: row.type as MemoryType,
    content: String(row.content),
    importance: Number(row.importance),
    metadata,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at)
  };
}

export interface MemoryRow {
  id: string;
  project_id: string;
  session_id: string | null;
  type: MemoryType;
  content: string;
  importance: number;
  metadata: Record<string, unknown>;
  created_at: number;
  updated_at: number;
}

export interface MemorySearchOptions {
  project_id?: string;
  session_id?: string;
  type?: MemoryType;
  min_importance?: number;
  limit?: number;
}

export interface MemorySearchResult {
  memory: Memory;
  score: number;
}

export class MemoryRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  insert(memory: MemoryRow): Memory {
    this.db.raw
      .prepare(
        `INSERT INTO memories (id, project_id, session_id, type, content, importance, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        memory.id,
        memory.project_id,
        memory.session_id,
        memory.type,
        memory.content,
        memory.importance,
        JSON.stringify(memory.metadata),
        memory.created_at,
        memory.updated_at
      );
    return memory as Memory;
  }

  get(id: string): Memory | null {
    const row = this.db.raw
      .prepare('SELECT * FROM memories WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? toMemory(row) : null;
  }

  delete(id: string): boolean {
    const result = this.db.raw.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return Number(result.changes) > 0;
  }

  update(
    id: string,
    patch: { content?: string; type?: MemoryType; importance?: number; metadata?: Record<string, unknown> }
  ): Memory | null {
    const existing = this.get(id);
    if (!existing) return null;
    const merged: Memory = {
      ...existing,
      content: patch.content ?? existing.content,
      type: patch.type ?? existing.type,
      importance: patch.importance ?? existing.importance,
      metadata: patch.metadata ?? existing.metadata,
      updated_at: Date.now()
    };
    this.db.raw
      .prepare('UPDATE memories SET content = ?, type = ?, importance = ?, metadata = ?, updated_at = ? WHERE id = ?')
      .run(merged.content, merged.type, merged.importance, JSON.stringify(merged.metadata), merged.updated_at, id);
    return merged;
  }

  list(options: MemorySearchOptions = {}): Memory[] {
    const clauses: string[] = [];
    const params: SQLInputValue[] = [];;
    if (options.project_id) {
      clauses.push('project_id = ?');
      params.push(options.project_id);
    }
    if (options.session_id) {
      clauses.push('session_id = ?');
      params.push(options.session_id);
    }
    if (options.type) {
      clauses.push('type = ?');
      params.push(options.type);
    }
    if (options.min_importance != null) {
      clauses.push('importance >= ?');
      params.push(options.min_importance);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = options.limit ?? 50;
    params.push(limit);
    const rows = this.db.raw
      .prepare(`SELECT * FROM memories ${where} ORDER BY importance DESC, created_at DESC LIMIT ?`)
      .all(...params) as Record<string, unknown>[];
    return rows.map(toMemory);
  }

  /** Exact normalized-content check used for cheap deduplication. */
  existsNormalized(content: string, projectId: string): boolean {
    const normalized = normalizeContent(content);
    const rows = this.db.raw
      .prepare(
        'SELECT rowid FROM memories WHERE project_id = ? AND (content = ? OR lower(trim(content)) = lower(?)) LIMIT 1'
      )
      .all(projectId, normalized, normalized) as { rowid: unknown }[];
    return rows.length > 0;
  }

  /** Full-text search over content using SQLite FTS5 (BM25 rank). */
  search(query: string, options: MemorySearchOptions = {}): MemorySearchResult[] {
    const clauses: string[] = ['memories_fts MATCH ?'];
    const params: SQLInputValue[] = [query];;
    if (options.project_id) {
      clauses.push('m.project_id = ?');
      params.push(options.project_id);
    }
    if (options.session_id) {
      clauses.push('m.session_id = ?');
      params.push(options.session_id);
    }
    if (options.type) {
      clauses.push('m.type = ?');
      params.push(options.type);
    }
    const limit = options.limit ?? 20;
    params.push(limit);
    const rows = this.db.raw
      .prepare(
        `SELECT m.*, bm25(memories_fts) AS _rank
         FROM memories_fts
         JOIN memories m ON m.rowid = memories_fts.rowid
         WHERE ${clauses.join(' AND ')}
         ORDER BY _rank ASC
         LIMIT ?`
      )
      .all(...params) as (Record<string, unknown> & { _rank: number })[];
    return rows.map((row) => {
      const { _rank, ...rest } = row;
      return { memory: toMemory(rest), score: _rank };
    });
  }

  recentByProject(projectId: string, limit = 20): Memory[] {
    const rows = this.db.raw
      .prepare('SELECT * FROM memories WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(projectId, limit) as Record<string, unknown>[];
    return rows.map(toMemory);
  }

  count(): number {
    const row = this.db.raw.prepare('SELECT COUNT(*) AS c FROM memories').get() as { c: number };
    return Number(row.c);
  }
}

function normalizeContent(content: string): string {
  return content.replace(/\s+/g, ' ').trim().toLowerCase();
}