import { describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

const PROJECT = '/tmp/memosaver-test-e2e';

describe('E2E acceptance: resume across sessions', () => {
  it('recovers the previous session context when the project is reopened', async () => {
    const app = createTestApp();

    // Day 1: open project, work on authentication, capture memories, end session.
    const day1 = app.service.startSession(PROJECT, 'claude-code');
    const projectId = day1.project.id;

    await app.engine.capture(
      projectId,
      'We decided to implement authentication with JWT and refresh-token rotation.',
      'DECISION',
      day1.session.id
    );
    await app.engine.capture(projectId, 'Fixed JWT verification: parse the HMAC signature as base64.', 'SOLUTION', day1.session.id);

    app.service.createCheckpoint(day1.session.id, {
      goal: 'implement authentication',
      completed: 'login, register, JWT issuance + refresh rotation',
      pending: 'logout endpoint and token invalidation',
      blockers: 'logout endpoint verification',
      next_action: 'implement logout endpoint and invalidate the token'
    });

    app.service.endSession(day1.session.id, { summary: 'auth complete, logout pending' });

    // Verify Day 1 state persisted.
    expect(app.service.getSession(day1.session.id)!.status).toBe('completed');
    expect(app.service.listMemories({ project_id: projectId }).length).toBeGreaterThan(0);

    // Day 7: the same database, new session -> must build a resume context.
    const day7 = app.service.startSession(PROJECT, 'opencode');
    expect(day7.resume.resume_available).toBe(true);
    expect(day7.resume.context).toContain('authentication');
    expect(day7.resume.context.toLowerCase()).toContain('logout');
    expect(day7.resume.context.toLowerCase()).toContain('next');
  });

  it('returns resume_available false for brand new projects', () => {
    const app = createTestApp();
    const started = app.service.startSession('/tmp/memosaver-test-brand-new', 'a');
    expect(started.resume.resume_available).toBe(false);
  });

  it('resume respects project isolation: two projects never leak memory', () => {
    const app = createTestApp();
    const a = app.service.startSession('/tmp/memosaver-project-alpha', 'a');
    app.engine.save({ projectId: a.project.id, content: 'alpha private decision', importance: 0.9 });
    app.service.createCheckpoint(a.session.id, { next_action: 'alpha next step' });
    app.service.endSession(a.session.id);

    const b = app.service.startSession('/tmp/memosaver-project-beta', 'a');
    const betaResume = app.service.buildResumeContext(b.project.id);
    expect(b.created_project).toBe(true);
    expect(betaResume.context).not.toContain('alpha');
    expect(b.project.id).not.toBe(a.project.id);
  });
});