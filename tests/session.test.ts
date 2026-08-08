import { describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

const PROJECT = '/tmp/memosaver-test-session';

describe('session lifecycle', () => {
  it('starts a session and registers the project', () => {
    const app = createTestApp();
    const result = app.service.startSession(PROJECT, 'claude-code');
    expect(result.created_project).toBe(true);
    expect(result.session.status).toBe('active');
    const project = app.service.getProject(result.project.id);
    expect(project).not.toBeNull();

    const seen = app.service.getProjectByPath(PROJECT);
    expect(seen?.id).toBe(result.project.id);
  });

  it('does not duplicate projects on repeated starts', () => {
    const app = createTestApp();
    app.service.startSession(PROJECT, 'claude-code');
    const second = app.service.startSession(PROJECT, 'opencode');
    expect(second.created_project).toBe(false);
    expect(app.service.listProjects()).toHaveLength(1);
  });

  it('closes previous active sessions as interrupted', () => {
    const app = createTestApp();
    const first = app.service.startSession(PROJECT, 'a');
    const second = app.service.startSession(PROJECT, 'b');
    const closed = app.service.getSession(first.session.id);
    expect(closed?.status).toBe('interrupted');
    expect(closed?.ended_at).not.toBeNull();
    expect(second.session.status).toBe('active');
  });

  it('ends sessions as completed', () => {
    const app = createTestApp();
    const { session } = app.service.startSession(PROJECT, 'a');
    const ended = app.service.endSession(session.id, { summary: 'auth done' });
    expect(ended?.status).toBe('completed');
    expect(ended?.ended_at).not.toBeNull();
    expect(ended?.summary).toBe('auth done');
  });

  it('returns null for unknown session ids', () => {
    const app = createTestApp();
    expect(app.service.getSession('nope')).toBeNull();
    expect(app.service.endSession('nope')).toBeNull();
  });

  it('creates a checkpoint and persists session state', async () => {
    const app = createTestApp();
    const { session } = app.service.startSession(PROJECT, 'a');
    const cp = app.service.createCheckpoint(session.id, {
      goal: 'implement auth',
      completed: 'login, register, JWT',
      pending: 'logout, refresh rotation',
      next_action: 'implement logout',
      blockers: 'refresh token invalidation'
    });
    expect(cp.id).toMatch(/^checkpoint_/);

    await app.engine.flushBuffer(PROJECT);

    const sessionAfter = app.service.getSession(session.id);
    expect(sessionAfter?.goal).toBe('implement auth');
    expect(sessionAfter?.next_action).toBe('implement logout');
  });

  it('rejects checkpoint for unknown session', () => {
    const app = createTestApp();
    expect(() => app.service.createCheckpoint('nope', {})).toThrow();
  });
});