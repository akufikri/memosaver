import { describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

const PROJECT = '/tmp/memosaver-test-memory';

describe('memory engine', () => {
  it('stores a memory with classification and importance', () => {
    const app = createTestApp();
    const { project } = app.service.startSession(PROJECT, 'tester');
    const memory = app.engine.save({
      projectId: project.id,
      content: 'We decided to use PostgreSQL because JSONB is required.',
      type: 'DECISION',
      importance: 0.95
    });
    expect(memory).not.toBeNull();
    expect(memory!.project_id).toBe(project.id);
    expect(memory!.type).toBe('DECISION');
    expect(memory!.importance).toBe(0.95);
  });

  it('rejects empty content and invalid types', () => {
    const app = createTestApp();
    const { project } = app.service.startSession(PROJECT, 'tester');
    expect(() =>
      app.engine.save({ projectId: project.id, content: '   ' })
    ).toThrow();
    expect(() =>
      app.engine.save({ projectId: project.id, content: 'valid', type: 'NOT_A_TYPE' as 'FACT' })
    ).toThrow();
  });

  it('deduplicates identical normalized content within a project', () => {
    const app = createTestApp();
    const { project } = app.service.startSession(PROJECT, 'tester');
    const first = app.engine.save({
      projectId: project.id,
      content: 'The build   step   runs   migrations first.',
      dedupe: true
    });
    const second = app.engine.save({
      projectId: project.id,
      content: 'The build step runs migrations first.',
      dedupe: true
    });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('captures high-value events and ignores low-value noise', async () => {
    const app = createTestApp({ minImportance: 0.3 });
    const { project } = app.service.startSession(PROJECT, 'tester');
    const result = await app.engine.processEvents(project.id, [
      { text: "We decided to split the API into two modules.", timestamp: Date.now() },
      { text: "I'll inspect the file.", timestamp: Date.now() },
      { text: "Fixed the webhook signature validation.", timestamp: Date.now() }
    ]);
    expect(result.captured).toBeGreaterThan(0);
    const capturedContent = result.memories.map((m) => m.content);
    expect(capturedContent).toContain('We decided to split the API into two modules.');
    expect(capturedContent.find((c) => c.includes('inspect the file'))).toBeUndefined();
  });

  it('deduplicates identical memories inside one extraction batch', async () => {
    const app = createTestApp({ minImportance: 0.3 });
    const { project } = app.service.startSession(PROJECT, 'tester');
    const result = await app.engine.processEvents(project.id, [
      { text: 'The auth module uses refresh tokens.', timestamp: Date.now() },
      { text: 'The auth module uses refresh tokens.', timestamp: Date.now() }
    ]);
    expect(result.captured).toBe(1);
  });

  it('keeps the session id on captured and buffered activity', async () => {
    const app = createTestApp({ minImportance: 0.3 });
    const { project, session } = app.service.startSession(PROJECT, 'tester');

    const captured = await app.engine.capture(
      project.id,
      'We decided to store refresh tokens in the session table.',
      undefined,
      session.id
    );
    expect(captured.memories[0]!.session_id).toBe(session.id);

    app.engine.bufferEvent(project.id, {
      text: 'The build pipeline runs migrations first.',
      session_id: session.id,
      timestamp: Date.now()
    });
    const flushed = await app.engine.flushBuffer(project.id);
    expect(flushed.memories[0]!.session_id).toBe(session.id);

    const scoped = app.service.listMemories({ project_id: project.id, session_id: session.id });
    expect(scoped.length).toBe(2);
  });

  it('buffers events until flush', async () => {
    const app = createTestApp();
    const { project } = app.service.startSession(PROJECT, 'tester');
    app.engine.bufferEvent(project.id, { text: 'next step: migrate db', timestamp: Date.now() });
    expect(app.engine.bufferedCount(project.id)).toBe(1);
    const result = await app.engine.flushBuffer(project.id);
    expect(result.captured + result.ignored).toBeGreaterThan(0);
    expect(app.engine.bufferedCount(project.id)).toBe(0);
  });
});