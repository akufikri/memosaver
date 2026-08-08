import { Database } from '../database.js';
import type { SQLInputValue } from 'node:sqlite';
import type { Session, SessionStatus } from '../../types.js';

function toSession(row: Record<string, unknown>): Session {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    agent: String(row.agent),
    started_at: Number(row.started_at),
    ended_at: row.ended_at != null ? Number(row.ended_at) : null,
    status: row.status as SessionStatus,
    summary: row.summary != null ? String(row.summary) : null,
    goal: row.goal != null ? String(row.goal) : null,
    current_task: row.current_task != null ? String(row.current_task) : null,
    next_action: row.next_action != null ? String(row.next_action) : null
  };
}

export interface SessionUpdate {
  status?: SessionStatus;
  ended_at?: number;
  summary?: string | null;
  goal?: string | null;
  current_task?: string | null;
  next_action?: string | null;
}

export class SessionRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  create(session: Session): Session {
    this.db.raw
      .prepare(
        `INSERT INTO sessions (id, project_id, agent, started_at, ended_at, status, summary, goal, current_task, next_action)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        session.id,
        session.project_id,
        session.agent,
        session.started_at,
        session.ended_at,
        session.status,
        session.summary,
        session.goal,
        session.current_task,
        session.next_action
      );
    return session;
  }

  get(id: string): Session | null {
    const row = this.db.raw
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? toSession(row) : null;
  }

  update(id: string, patch: SessionUpdate): Session | null {
    const existing = this.get(id);
    if (!existing) return null;
    const merged: Session = { ...existing, ...patch };
    this.db.raw
      .prepare(
        `UPDATE sessions SET status = ?, ended_at = ?, summary = ?, goal = ?, current_task = ?, next_action = ?
         WHERE id = ?`
      )
      .run(
        merged.status,
        merged.ended_at,
        merged.summary,
        merged.goal,
        merged.current_task,
        merged.next_action,
        id
      );
    return merged;
  }

  latestForProject(projectId: string, excludeActive = false): Session | null {
    const where = excludeActive ? 'status != ?' : '1=1';
    const params: SQLInputValue[] = excludeActive ? ['active'] : [];;
    const row = this.db.raw
      .prepare(
        `SELECT * FROM sessions WHERE project_id = ? AND ${where} ORDER BY started_at DESC LIMIT 1`
      )
      .get(projectId, ...params) as Record<string, unknown> | undefined;
    return row ? toSession(row) : null;
  }

  activeForProject(projectId: string): Session[] {
    const rows = this.db.raw
      .prepare(`SELECT * FROM sessions WHERE project_id = ? AND status = 'active' ORDER BY started_at DESC`)
      .all(projectId) as Record<string, unknown>[];
    return rows.map(toSession);
  }

  listByProject(projectId: string, limit = 50): Session[] {
    const rows = this.db.raw
      .prepare(`SELECT * FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT ?`)
      .all(projectId, limit) as Record<string, unknown>[];
    return rows.map(toSession);
  }

  list(limit = 50, projectId?: string): Session[] {
    const sql = projectId
      ? `SELECT * FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT ?`
      : `SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?`;
    const rows = (projectId
      ? this.db.raw.prepare(sql).all(projectId, limit)
      : this.db.raw.prepare(sql).all(limit)) as Record<string, unknown>[];
    return rows.map(toSession);
  }

  activeCount(): number {
    const row = this.db.raw.prepare(`SELECT COUNT(*) AS c FROM sessions WHERE status = 'active'`).get() as {
      c: number;
    };
    return Number(row.c);
  }

  closeActiveForProject(projectId: string, status: SessionStatus = 'interrupted'): number {
    const result = this.db.raw
      .prepare(`UPDATE sessions SET status = ?, ended_at = ? WHERE project_id = ? AND status = 'active'`)
      .run(status, Date.now(), projectId);
    return Number(result.changes);
  }
}