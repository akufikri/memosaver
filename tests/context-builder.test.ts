import { describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';
import { estimateTokens } from '../src/context/context-builder.js';

const PROJECT = '/tmp/memosaver-test-context';

function seed(app: ReturnType<typeof createTestApp>): string {
  const { session } = app.service.startSession(PROJECT, 'a');
  app.service.createCheckpoint(session.id, {
    goal: 'implement authentication',
    completed: 'login, register, JWT issuance',
    pending: 'logout and refresh rotation',
    blockers: 'refresh token invalidation failing',
    next_action: 'debug refresh-token rotation'
  });
  app.engine.save({ projectId: app.service.getProjectByPath(PROJECT)!.id, type: 'DECISION', importance: 0.95, content: 'PostgreSQL chosen for JSONB support.' });
  app.service.endSession(session.id, { summary: 'auth partly done' });
  return session.id;
}

describe('context builder / resume', () => {
  it('builds a concise resume context', () => {
    const app = createTestApp();
    seed(app);
    const projectId = app.service.getProjectByPath(PROJECT)!.id;
    const resume = app.service.buildResumeContext(projectId);
    expect(resume.resume_available).toBe(true);
    expect(resume.context).toContain('PROJECT CONTEXT');
    expect(resume.context).toContain('implement auth');
    expect(resume.context).toContain('refresh token');
    expect(resume.sections.length).toBeGreaterThan(0);
  });

  it('respects the token budget for the resume context', () => {
    const app = createTestApp();
    const first = app.service.startSession(PROJECT, 'a');
    for (let i = 0; i < 40; i++) {
      app.engine.save({
        projectId: first.project.id,
        content: `fact number ${i} about the long payment gateway callback behaviour and invoice webhook transactions.`,
        type: 'FACT',
        importance: 0.9 - i / 100
      });
    }
    app.service.endSession(first.session.id);
    const second = app.service.startSession(PROJECT, 'b');
    const resume = app.service.buildResumeContext(second.project.id);
    expect(estimateTokens(resume.context)).toBeLessThanOrEqual(6000);
  });
});