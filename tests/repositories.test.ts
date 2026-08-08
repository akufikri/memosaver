import { describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

describe('repositories and database transactions', () => {
  it('runs migrations and stores projects/sessions/memories/checkpoints', () => {
    const app = createTestApp();
    const { project, session } = app.service.startSession('/tmp/memosaver-test-repo', 'a');
    const cp = app.service.createCheckpoint(session.id, { pending: 'x', next_action: 'y' });
    const mem = app.engine.save({ projectId: project.id, content: 'repo memory' });

    const projectRow = app.service.getProject(project.id);
    expect(projectRow).not.toBeNull();
    expect(projectRow!.last_session_id).toBe(session.id);

    const sessionRow = app.service.getSession(session.id);
    expect(sessionRow!.status).toBe('active');

    const memoryRow = app.service.getMemory(mem!.id);
    expect(memoryRow!.content).toBe('repo memory');

    const cpRow = app.service.getCheckpoint(cp.id);
    expect(cpRow!.session_id).toBe(session.id);
  });

  it('transaction rollback leaves no partial data', () => {
    const app = createTestApp();
    expect(() => {
      app.db.transaction(() => {
        app.service.startSession('/tmp/memosaver-test-rollback', 'a');
        app.service.startSession('/tmp/memosaver-test-rollback', 'a');
        throw new Error('boom');
      });
    }).toThrow('boom');
    const sessions = app.service.listSessions();
    const rollbackProject = app.service.listProjects().find((p) => p.path === '/tmp/memosaver-test-rollback');
    expect(rollbackProject).toBeUndefined();
    expect(sessions).toHaveLength(0);
  });
});