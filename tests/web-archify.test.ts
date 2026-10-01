import { describe, expect, it } from 'vitest';
import { createTestApp, tempProjectPath, type TestApp } from './helpers.js';
import {
  buildArchifySpec,
  buildWorkspaceSpec,
  loadProjectGraph,
  loadWorkspace,
  type ArchifySpec
} from '../src/web/archify-spec.js';
import { ArchifyRenderError, renderArchifyArtifact, renderArchifyHtml } from '../src/web/archify-render.js';

function seededApp(): { app: TestApp; projectId: string; projectPath: string } {
  const app = createTestApp();
  const projectPath = tempProjectPath('archify');
  const { session, project } = app.service.startSession(projectPath, 'claude-code');
  app.engine.save({
    projectId: project.id,
    sessionId: session.id,
    content: 'We decided to use SQLite FTS5 for memory search.',
    type: 'DECISION',
    importance: 0.9
  });
  app.engine.save({
    projectId: project.id,
    sessionId: session.id,
    content: 'Login failed: error: token expired.',
    type: 'ERROR',
    importance: 0.7
  });
  app.engine.save({
    projectId: project.id,
    sessionId: session.id,
    content: 'Next step: add dedupe to memory import.',
    type: 'TASK',
    importance: 0.6
  });
  app.service.createCheckpoint(session.id, {
    goal: 'ship the visual',
    completed: 'spec builder',
    next_action: 'render the diagram'
  });
  return { app, projectId: project.id, projectPath };
}

function specOf(selector?: string): ArchifySpec {
  const { app, projectId } = seededApp();
  const snapshot = loadProjectGraph(app.db, selector ?? projectId);
  if (!snapshot) throw new Error('snapshot missing');
  return buildArchifySpec(snapshot);
}

describe('archify spec builder', () => {
  it('produces a grid spec that references only existing components', () => {
    const spec = specOf();
    const ids = spec.components.map((component) => component.id);

    expect(spec.diagram_type).toBe('architecture');
    expect(spec.components.length).toBeGreaterThanOrEqual(3);
    expect(spec.components.length).toBeLessThanOrEqual(12);
    expect(new Set(ids).size).toBe(ids.length);

    const maxCol = Math.max(...spec.components.map((component) => component.col));
    expect(spec.layout.cols).toBeGreaterThan(maxCol);
    for (const component of spec.components) {
      expect(component.size[0]).toBeGreaterThan(0);
      expect(component.size[1]).toBeGreaterThan(0);
    }

    for (const connection of spec.connections) {
      expect(ids).toContain(connection.from);
      expect(ids).toContain(connection.to);
    }
    expect(spec.boundaries[0]!.wraps.sort()).toEqual([...ids].sort());
    expect(spec.meta.title).toContain('MemoSaver Memory Graph');
  });

  it('gives vertical relationship labels an explicit position', () => {
    const spec = specOf();
    const vertical = spec.connections.filter((connection) => connection.label === 'memory');
    expect(vertical.length).toBeGreaterThan(0);
    for (const connection of vertical) {
      expect(connection.labelAt).toHaveLength(2);
    }
  });

  it('resolves a project by path or name and rejects an unknown project', () => {
    const { app, projectId, projectPath } = seededApp();
    const name = projectPath.split('/').pop()!;
    expect(loadProjectGraph(app.db, projectPath)?.project.id).toBe(projectId);
    expect(loadProjectGraph(app.db, name)?.project.id).toBe(projectId);
    expect(loadProjectGraph(app.db, '/tmp/memosaver-archify-not-a-project')).toBeNull();
  });
});

describe('workspace overview', () => {
  it('lays every project out as a node in a compact grid', () => {
    const app = createTestApp();
    const first = app.service.startSession(tempProjectPath('workspace-a'), 'claude-code');
    app.engine.save({ projectId: first.project.id, content: 'first project fact' });
    const second = app.service.startSession(tempProjectPath('workspace-b'), 'opencode');
    app.engine.save({ projectId: second.project.id, content: 'second project fact' });

    const snapshot = loadWorkspace(app.db);
    expect(snapshot.projects).toHaveLength(2);
    expect(snapshot.totals.projects).toBe(2);

    const spec = buildWorkspaceSpec(snapshot);
    const ids = spec.components.map((component) => component.id);
    expect(ids.filter((id) => id.startsWith('project_'))).toHaveLength(2);
    expect(spec.connections).toHaveLength(0);
    expect(spec.meta.title).toContain('2 project(s)');
    expect(spec.boundaries[0]!.wraps.sort()).toEqual([...ids].sort());

    // A compact grid is what keeps the diagram readable when the viewer fits it
    // to the window: many columns in one row would shrink every label.
    expect(spec.layout.cols).toBeLessThanOrEqual(6);
    expect(spec.components.every((component) => component.size[0] >= 200)).toBe(true);
  });

  it('wraps twelve projects into two readable rows', () => {
    const app = createTestApp();
    for (let index = 0; index < 12; index++) {
      const { project } = app.service.startSession(tempProjectPath(`workspace-wrap-${index}`), 'claude-code');
      app.engine.save({ projectId: project.id, content: `wrapped memory ${index}` });
    }
    const spec = buildWorkspaceSpec(loadWorkspace(app.db));
    expect(spec.components).toHaveLength(12);
    expect(spec.layout.cols).toBe(6);
    expect(Math.max(...spec.components.map((component) => component.row))).toBe(1);
  });

  it('pages through projects without losing any', () => {
    const app = createTestApp();
    for (let index = 0; index < 25; index++) {
      const { project } = app.service.startSession(tempProjectPath(`workspace-page-${index}`), 'claude-code');
      app.engine.save({ projectId: project.id, content: `memory of page test ${index}` });
    }

    const firstPage = loadWorkspace(app.db, { page: 1, limit: 12 });
    const secondPage = loadWorkspace(app.db, { page: 2, limit: 12 });
    const lastPage = loadWorkspace(app.db, { page: 3, limit: 12 });
    expect(firstPage.totals.projects).toBe(25);
    expect(firstPage.projects).toHaveLength(12);
    expect(secondPage.projects).toHaveLength(12);
    expect(lastPage.projects).toHaveLength(1);

    const ids = new Set(
      [...firstPage.projects, ...secondPage.projects, ...lastPage.projects].map((project) => project.id)
    );
    expect(ids.size).toBe(25);

    const spec = buildWorkspaceSpec(lastPage);
    expect(spec.meta.title).toContain('projects 25–25 of 25');
    expect(spec.cards[0]!.items.join(' ')).toContain('page 3/3');
  });

  it('caps the page size at what the renderer layout allows', () => {
    const app = createTestApp();
    const snapshot = loadWorkspace(app.db, { limit: 99 });
    expect(snapshot.page_size).toBe(12);
    expect(snapshot.projects).toHaveLength(0);
  });

  it('clamps an out-of-range page to the last page', () => {
    const app = createTestApp();
    for (let index = 0; index < 25; index++) {
      const { project } = app.service.startSession(tempProjectPath(`workspace-clamp-${index}`), 'claude-code');
      app.engine.save({ projectId: project.id, content: `clamped memory ${index}` });
    }
    const clamped = loadWorkspace(app.db, { page: 99, limit: 12 });
    expect(clamped.page).toBe(3);
    expect(clamped.projects).toHaveLength(1);
    expect(buildWorkspaceSpec(clamped).meta.title).toContain('projects 25–25 of 25');
  });

  it('renders a full twelve-project grid in one diagram', async () => {
    const app = createTestApp();
    for (let index = 0; index < 12; index++) {
      const { project } = app.service.startSession(tempProjectPath(`workspace-grid-${index}`), 'claude-code');
      app.engine.save({ projectId: project.id, content: `memory of grid ${index}` });
    }
    const artifact = await renderArchifyArtifact(buildWorkspaceSpec(loadWorkspace(app.db)));
    expect(artifact.variant).toBe('full');
    expect(artifact.html).toContain('MemoSaver Workspace');
  });
});

describe('archify rendering', () => {
  it('renders the full diagram, relationships included', async () => {
    const artifact = await renderArchifyArtifact(specOf());
    expect(artifact.variant).toBe('full');
    expect(artifact.html.length).toBeGreaterThan(100_000);
    expect(artifact.html.toLowerCase()).toContain('<!doctype html');
    expect(artifact.html).toContain('MemoSaver Memory Graph');
    // Relationship labels only survive in the full variant; a degraded render
    // would still return HTML, which is exactly what must not pass here.
    expect(artifact.html).toContain('session_start');
    expect(artifact.html).toContain('memory');
    expect(artifact.html).toContain('marker-end');
  });

  it('fails loudly instead of serving a broken diagram', async () => {
    const broken = specOf();
    broken.layout.cols = 1;
    broken.meta.title = 'Broken grid';

    const err = await renderArchifyHtml(broken).then(
      () => null,
      (failure: unknown) => failure
    );
    expect(err).toBeInstanceOf(ArchifyRenderError);
    if (!(err instanceof ArchifyRenderError)) throw new Error('expected ArchifyRenderError');
    expect(err.diagnostics).toContain('col');
  });
});
