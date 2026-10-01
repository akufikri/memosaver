import { describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

const PROJECT = '/tmp/memosaver-test-search';

describe('memory retrieval', () => {
  it('searches memory content with FTS5', () => {
    const app = createTestApp();
    const { project } = app.service.startSession(PROJECT, 'a');
    const pid = project.id;
    app.service.engine.save({ projectId: pid, content: 'JWT authentication flow uses refresh tokens.' });
    const results = app.service.retriever.search('JWT authentication', { project_id: pid });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.memory.content).toContain('JWT');
  });

  it('handles FTS5 operator characters in queries', () => {
    const app = createTestApp();
    const { project } = app.service.startSession(PROJECT, 'a');
    const pid = project.id;
    app.engine.save({ projectId: pid, content: 'Login failed: error: connection timeout after 30s.' });

    expect(app.service.retriever.search('error: timeout', { project_id: pid })).toHaveLength(1);
    expect(app.service.retriever.search('"unbalanced', { project_id: pid })).toHaveLength(0);
    expect(app.service.retriever.search('NOT AND OR', { project_id: pid })).toHaveLength(0);
  });

  it('recalls sorted by importance', () => {
    const app = createTestApp();
    const { project } = app.service.startSession(PROJECT, 'a');
    app.engine.save({ projectId: project.id, content: 'low value note', importance: 0.2 });
    app.engine.save({ projectId: project.id, content: 'high value decision', importance: 0.95 });
    const memories = app.service.retriever.recall(project.id);
    expect(memories[0]!.importance).toBe(0.95);
  });

  it('filters recent by project', () => {
    const app = createTestApp();
    const { project } = app.service.startSession(PROJECT, 'a');
    app.engine.save({ projectId: project.id, content: 'one', importance: 0.6 });
    const recent = app.service.retriever.recent(project.id);
    expect(recent.map((m) => m.content)).toContain('one');
  });

  it('deletes a memory', () => {
    const app = createTestApp();
    const { project } = app.service.startSession(PROJECT, 'a');
    const saved = app.engine.save({ projectId: project.id, content: 'to delete' });
    expect(app.engine.delete(saved!.id)).toBe(true);
    expect(app.engine.delete('not-there')).toBe(false);
    expect(app.service.getMemory(saved!.id)).toBeNull();
  });
});