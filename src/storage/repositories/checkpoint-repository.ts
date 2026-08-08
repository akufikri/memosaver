import { Database } from '../database.js';
import type { Checkpoint } from '../../types.js';

function toCheckpoint(row: Record<string, unknown>): Checkpoint {
  return {
    id: String(row.id),
    session_id: String(row.session_id),
    goal: row.goal != null ? String(row.goal) : null,
    current_state: row.current_state != null ? String(row.current_state) : null,
    completed: row.completed != null ? String(row.completed) : null,
    pending: row.pending != null ? String(row.pending) : null,
    blockers: row.blockers != null ? String(row.blockers) : null,
    next_action: row.next_action != null ? String(row.next_action) : null,
    created_at: Number(row.created_at)
  };
}

export interface CheckpointInput {
  goal?: string | null;
  current_state?: string | null;
  completed?: string | null;
  pending?: string | null;
  blockers?: string | null;
  next_action?: string | null;
}

export class CheckpointRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  create(id: string, sessionId: string, input: CheckpointInput): Checkpoint {
    const checkpoint: Checkpoint = {
      id,
      session_id: sessionId,
      goal: input.goal ?? null,
      current_state: input.current_state ?? null,
      completed: input.completed ?? null,
      pending: input.pending ?? null,
      blockers: input.blockers ?? null,
      next_action: input.next_action ?? null,
      created_at: Date.now()
    };
    this.db.raw
      .prepare(
        `INSERT INTO checkpoints (id, session_id, goal, current_state, completed, pending, blockers, next_action, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        checkpoint.id,
        checkpoint.session_id,
        checkpoint.goal,
        checkpoint.current_state,
        checkpoint.completed,
        checkpoint.pending,
        checkpoint.blockers,
        checkpoint.next_action,
        checkpoint.created_at
      );
    return checkpoint;
  }

  get(id: string): Checkpoint | null {
    const row = this.db.raw
      .prepare('SELECT * FROM checkpoints WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? toCheckpoint(row) : null;
  }

  latestForSession(sessionId: string): Checkpoint | null {
    const row = this.db.raw
      .prepare('SELECT * FROM checkpoints WHERE session_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(sessionId) as Record<string, unknown> | undefined;
    return row ? toCheckpoint(row) : null;
  }

  lastForProject(projectId: string): Checkpoint | null {
    const row = this.db.raw
      .prepare(
        `SELECT c.* FROM checkpoints c
         JOIN sessions s ON s.id = c.session_id
         WHERE s.project_id = ?
         ORDER BY c.created_at DESC LIMIT 1`
      )
      .get(projectId) as Record<string, unknown> | undefined;
    return row ? toCheckpoint(row) : null;
  }

  listBySession(sessionId: string, limit = 20): Checkpoint[] {
    const rows = this.db.raw
      .prepare('SELECT * FROM checkpoints WHERE session_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(sessionId, limit) as Record<string, unknown>[];
    return rows.map(toCheckpoint);
  }
}