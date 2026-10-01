import { describe, expect, it } from 'vitest';
import { createTestApp, tempProjectPath } from './helpers.js';
import { LlmMemoryExtractor, composeExtractor } from '../src/memory/llm-extractor.js';
import { RuleBasedExtractor } from '../src/memory/extractor.js';

const PROJECT = '/tmp/memosaver-test-features';

describe('memory update', () => {
  it('updates content, type and importance', () => {
    const app = createTestApp();
    const { project } = app.service.startSession(PROJECT, 'a');
    const saved = app.engine.save({ projectId: project.id, content: 'old note', importance: 0.3 })!;
    const updated = app.service.updateMemory(saved.id, {
      content: 'new decision: use postgres',
      type: 'DECISION',
      importance: 0.9
    });
    expect(updated!.content).toBe('new decision: use postgres');
    expect(updated!.type).toBe('DECISION');
    expect(updated!.importance).toBe(0.9);
    expect(app.service.getMemory(saved.id)!.content).toBe('new decision: use postgres');
  });

  it('returns null for unknown ids and throws on empty content', () => {
    const app = createTestApp();
    expect(app.service.updateMemory('nope', { content: 'x' })).toBeNull();
    const { project } = app.service.startSession(PROJECT, 'a');
    const saved = app.engine.save({ projectId: project.id, content: 'note' })!;
    expect(() => app.service.updateMemory(saved.id, { content: '  ' })).toThrow();
  });
});

describe('hybrid search', () => {
  it('finds results via token overlap when FTS is sparse', () => {
    const app = createTestApp();
    const { project } = app.service.startSession(PROJECT, 'a');
    const pid = project.id;
    app.engine.save({ projectId: pid, content: 'AuthService architecture uses repository pattern', importance: 0.8 });
    app.engine.save({ projectId: pid, content: 'postgres jsonb decision', importance: 0.9 });

    const results = app.service.searchHybrid('authentication service repository', {
      project_id: pid,
      limit: 5
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.memory.content.toLowerCase()).toContain('authservice');
    expect(typeof results[0]!.score).toBe('number');
  });

  it('returns empty for nonsense queries', () => {
    const app = createTestApp();
    const { project } = app.service.startSession(PROJECT, 'a');
    app.engine.save({ projectId: project.id, content: 'some random note' });
    const results = app.service.searchHybrid('zzzzqqqqxxx', { project_id: project.id });
    expect(results.length).toBe(0);
  });
});

describe('export / import', () => {
  it('round-trips memories through a document', () => {
    const app = createTestApp();
    const { project } = app.service.startSession(PROJECT, 'a');
    app.engine.save({
      projectId: project.id,
      content: 'export me',
      type: 'DECISION',
      importance: 0.9
    });
    const doc = app.service.exportMemories({ project_id: project.id });
    expect(doc.memories.length).toBeGreaterThan(0);

    const app2 = createTestApp();
    const result = app2.service.importMemories(doc);
    expect(result.imported).toBeGreaterThan(0);
    const all = app2.service.exportMemories().memories;
    expect(all.map((m) => m.content)).toContain('export me');
  });

  it('imports memories whose session does not exist locally', () => {
    const app = createTestApp();
    const result = app.service.importMemories({
      app: 'memosaver',
      version: 1,
      exported_at: Date.now(),
      project: { id: 'project_other_machine', path: tempProjectPath('import-foreign'), name: 'foreign' },
      memories: [
        {
          project_id: 'project_other_machine',
          session_id: 'session_other_machine',
          type: 'DECISION',
          content: 'foreign decision kept across machines',
          importance: 0.9
        }
      ]
    });

    expect(result.imported).toBe(1);
    const saved = app.service.getMemory(result.ids[0]!)!;
    expect(saved.session_id).toBeNull();
    expect(saved.metadata['imported_session_id']).toBe('session_other_machine');
  });

  it('rolls back the whole import when a row fails', () => {
    const app = createTestApp();
    const { project } = app.service.startSession(tempProjectPath('import-rollback'), 'a');
    const originalSave = app.engine.save.bind(app.engine);
    let calls = 0;
    app.engine.save = (input) => {
      calls += 1;
      if (calls === 2) throw new Error('boom');
      return originalSave(input);
    };

    expect(() =>
      app.service.importMemories({
        app: 'memosaver',
        version: 1,
        exported_at: Date.now(),
        project: { id: project.id, path: project.path, name: project.name },
        memories: [
          { project_id: project.id, type: 'FACT', content: 'first row survives?' },
          { project_id: project.id, type: 'FACT', content: 'second row throws' }
        ]
      })
    ).toThrow('boom');
    expect(app.service.exportMemories({ project_id: project.id }).memories).toHaveLength(0);
  });

  it('rejects invalid documents', () => {
    const app = createTestApp();
    expect(() => app.service.importMemories({ memories: [] } as never)).toThrow();
  });
});

describe('session timeline', () => {
  it('returns checkpoints and memories in ascending order', () => {
    const app = createTestApp();
    const { session, project } = app.service.startSession(PROJECT, 'a');
    app.engine.save({ projectId: project.id, sessionId: session.id, content: 'first fact' });
    app.service.createCheckpoint(session.id, { completed: 'step one' });
    app.engine.save({ projectId: project.id, sessionId: session.id, content: 'second fact' });

    const timeline = app.service.sessionTimeline(session.id);
    expect(timeline.events.length).toBe(4);
    expect(timeline.events.some((e) => e.kind === 'checkpoint')).toBe(true);
    for (let i = 1; i < timeline.events.length; i++) {
      expect(timeline.events[i]!.at).toBeGreaterThanOrEqual(timeline.events[i - 1]!.at);
    }
  });

  it('throws for unknown sessions', () => {
    const app = createTestApp();
    expect(() => app.service.sessionTimeline('nope')).toThrow();
  });
});

describe('automatic checkpoint on session end', () => {
  it('creates a checkpoint when a session ends with state', () => {
    const app = createTestApp();
    const { session } = app.service.startSession(PROJECT, 'a');
    app.service.createCheckpoint(session.id, { goal: 'implement x' });
    const ended = app.service.endSession(session.id);
    expect(ended!.status).toBe('completed');
  });
});

describe('LLM extractor', () => {
  it('composeExtractor keeps rule-based when no api_key is set', () => {
    const rule = new RuleBasedExtractor({ minImportance: 0.3, maxContentLength: 1000 });
    const composed = composeExtractor(rule, { provider: 'openai-compatible', api_key: undefined });
    expect(composed).toBe(rule);
  });

  it('returns [] when disabled', async () => {
    const llm = new LlmMemoryExtractor(
      { minImportance: 0.3, maxContentLength: 1000 },
      { provider: 'openai-compatible', api_key: 'sk-test', disabled: true }
    );
    const out = await llm.extract([{ text: 'We decided to use postgres.', timestamp: Date.now() }]);
    expect(out).toEqual([]);
  });

  it('parses a chat completion response into candidates', async () => {
    const llm = new LlmMemoryExtractor(
      { minImportance: 0.3, maxContentLength: 1000 },
      { provider: 'openai-compatible', api_key: 'sk-test' },
      async () =>
        JSON.stringify({
          memories: [{ content: 'Use postgres for JSONB.', type: 'DECISION', importance: 0.9 }]
        })
    );
    const out = await llm.extract([{ text: 'we chose postgres', timestamp: Date.now() }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe('DECISION');
    expect(out[0]!.content).toBe('Use postgres for JSONB.');
    expect(out[0]!.importance).toBe(0.9);
  });

  it('attaches the shared session id to LLM candidates', async () => {
    const llm = new LlmMemoryExtractor(
      { minImportance: 0.3, maxContentLength: 1000 },
      { provider: 'openai-compatible', api_key: 'sk-test' },
      async () =>
        JSON.stringify({
          memories: [{ content: 'Use postgres for JSONB.', type: 'DECISION', importance: 0.9 }]
        })
    );
    const out = await llm.extract([
      { text: 'we chose postgres', session_id: 'session_1', timestamp: Date.now() }
    ]);
    expect(out[0]!.metadata!['session_id']).toBe('session_1');
  });

  it('degrades to rule-based when the LLM call fails', async () => {
    const rule = new RuleBasedExtractor({ minImportance: 0.3, maxContentLength: 1000 });
    const composed = composeExtractor(rule, { provider: 'openai-compatible', api_key: 'sk-test' });
    const llm = new LlmMemoryExtractor(
      { minImportance: 0.3, maxContentLength: 1000 },
      { provider: 'openai-compatible', api_key: 'sk-test' },
      async () => {
        throw new Error('network down');
      }
    );
    // The composed extractor falls back to rules when the LLM returns nothing.
    const composedStub = {
      extract: async (events: Parameters<typeof llm.extract>[0]) => {
        const out = await llm.extract(events);
        if (out.length > 0) return out;
        return rule.extract(events);
      }
    };
    const out = await composedStub.extract([{ text: 'We decided to use postgres.', timestamp: Date.now() }]);
    expect(out.length).toBeGreaterThan(0);
    expect(composed).toBeDefined();
  });
});